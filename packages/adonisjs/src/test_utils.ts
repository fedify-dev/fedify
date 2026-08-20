/**
 * Test helpers for the `@fedify/adonisjs` test suite.
 *
 * They boot a real AdonisJS HTTP server — real server middleware stack, real
 * router, real exception handler — on an ephemeral port, with the Fedify
 * middleware installed.  Testing against the real pipeline rather than a mock
 * matters here: the whole design rests on two behaviours of that pipeline
 * (`ctx.route` being assigned only on a match, and `await next()` resolving
 * even when nothing matches), and a mock would happily reproduce whatever the
 * implementation assumed.
 *
 * This file is only ever imported by `*.test.ts` files and is excluded from the
 * published package.
 *
 * @module
 */
import { createServer, type Server as NodeHttpServer } from "node:http";
import { type AddressInfo, connect } from "node:net";

import { AppFactory } from "@adonisjs/core/factories/app";
import { ServerFactory } from "@adonisjs/core/factories/http";
import type { HttpContext } from "@adonisjs/core/http";
import type { Router } from "@adonisjs/core/http";
import type { MiddlewareAsClass, NextFn } from "@adonisjs/core/types/http";
import {
  createFederation,
  type Federation,
  MemoryKvStore,
} from "@fedify/fedify";
import { Endpoints, Person } from "@fedify/vocab";

import {
  fedifyMiddleware,
  type FedifyMiddlewareHandler,
} from "./middleware.ts";
import type { ContextDataFactory } from "./types.ts";

/**
 * A minimal federation used by the tests: one actor, `alice`, plus an inbox so
 * that the actor document is complete enough for Fedify to serve it.
 */
export function createTestFederation(): Federation<null> {
  const federation = createFederation<null>({
    kv: new MemoryKvStore(),
    // The tests never make outbound requests, but Fedify's SSRF guard would
    // otherwise reject the loopback addresses used by the harness.
    allowPrivateAddress: true,
  });

  federation
    .setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
      if (identifier !== "alice") return null;
      return new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        name: "Alice",
        inbox: ctx.getInboxUri(identifier),
        endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
      });
    })
    .setKeyPairsDispatcher(() => []);

  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");

  return federation;
}

/**
 * A running test server.
 */
export interface TestServer {
  /** The base URL, for example `http://127.0.0.1:34567`. */
  url: string;
  /** `fetch()` bound to {@link url}, so tests can pass bare paths. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export interface TestServerOptions<TContextData> {
  federation: Federation<TContextData>;
  /** Omit it to exercise the default that `fedifyMiddleware` supplies. */
  contextDataFactory?: ContextDataFactory<TContextData>;
  ignoreRoutePrefixes?: string[];
  /** Registers the AdonisJS routes that the Fedify middleware falls through to. */
  defineRoutes?: (router: Router) => void;
  /**
   * A server middleware registered *after* the Fedify one, standing in for
   * something like `@adonisjs/cors` that answers a request itself without the
   * router ever running.
   */
  afterFedify?: FedifyMiddlewareHandler | {
    handle(ctx: HttpContext): Promise<void> | void;
  };
}

/**
 * A server middleware the tests register *after* the Fedify one.
 *
 * `next` is part of the signature but a stub that answers the request itself may
 * omit it: a function of fewer parameters is assignable to one of more.
 */
interface DownstreamMiddleware {
  handle(ctx: HttpContext, next: NextFn): Promise<void> | void;
}

/**
 * Wraps a plain middleware object in the class shape that `server.use()`
 * expects.
 */
function asMiddlewareClass(
  middleware: DownstreamMiddleware,
): MiddlewareAsClass {
  return class TestMiddleware {
    handle = middleware.handle.bind(middleware);
  };
}

/**
 * An exception handler for the harness, behaviourally identical to the one
 * `@adonisjs/http-server` falls back to but returning promises.
 *
 * Registering it works around an upstream bug rather than a behaviour this
 * package needs.  The server invokes the error handler through
 * `tracingChannel.tracePromise`, but the built-in fallback's `handle` is
 * synchronous, so Node prints
 *
 * > tracePromise was called with the function 'handle', which returned a
 * > non-thenable
 *
 * on every request that reaches it.  The fall-through tests reach it by design
 * — an unmatched route raises `E_ROUTE_NOT_FOUND` — so without this the warning
 * appears several times in an otherwise green run.  A real application never
 * sees it: `node ace configure` scaffolds *app/exceptions/handler.ts* extending
 * `ExceptionHandler`, whose `handle` is async.
 */
class TestExceptionHandler {
  report(): Promise<void> {
    return Promise.resolve();
  }

  handle(
    error: { status?: number; message?: string },
    ctx: HttpContext,
  ): Promise<void> {
    ctx.response
      .status(error.status ?? 500)
      .send(error.message ?? "Internal server error");
    return Promise.resolve();
  }
}

export async function startTestServer<TContextData>(
  options: TestServerOptions<TContextData>,
): Promise<TestServer> {
  const app = new AppFactory().create(
    new URL("../", import.meta.url),
    () => import("node:util"),
  );
  await app.init();

  const middleware = fedifyMiddleware(
    options.federation,
    options.contextDataFactory,
    {
      ignoreRoutePrefixes: options.ignoreRoutePrefixes,
    },
  );

  const server = new ServerFactory().merge({ app }).create();
  server.errorHandler(() => Promise.resolve({ default: TestExceptionHandler }));

  // `fedifyMiddleware` already returns the class `server.use()` constructs.
  const stack: (() => Promise<{ default: MiddlewareAsClass }>)[] = [
    () => Promise.resolve({ default: middleware }),
  ];
  if (options.afterFedify) {
    const downstream = options.afterFedify;
    stack.push(() =>
      Promise.resolve({ default: asMiddlewareClass(downstream) })
    );
  }

  server.use(stack);

  options.defineRoutes?.(server.getRouter());

  await server.boot();

  const httpServer: NodeHttpServer = createServer(server.handle.bind(server));
  // Without the `error` listener a failed bind never settles the promise, and
  // the run stalls until the test timeout with nothing said about the cause.
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  const { port } = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    fetch(path, init) {
      return fetch(new URL(path, url), init);
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
        // `close()` stops new connections but waits for the open ones to end,
        // and `fetch()` keeps its sockets alive, so the callback would only
        // fire once undici's idle timeout expired.
        httpServer.closeIdleConnections();
      });
      await app.terminate();
    },
  };
}

/**
 * Sends a verbatim request line, which `fetch()` cannot: it rejects forbidden
 * methods such as `TRACE`, and never sends an absolute-form target.
 *
 * The response is returned unparsed apart from its status code, which keeps the
 * helper out of body-framing concerns.
 */
export function fetchRaw(
  server: TestServer,
  target: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; raw: string }> {
  const { hostname, port } = new URL(server.url);

  return new Promise((resolve, reject) => {
    const socket = connect({ host: hostname, port: Number(port) });
    socket.setEncoding("utf8");

    const chunks: string[] = [];
    socket.on("error", reject);
    socket.on("data", (chunk: string) => chunks.push(chunk));
    // `Connection: close` makes the server end the socket after replying, so
    // this fires once the whole response has arrived.
    socket.on("close", () => {
      const raw = chunks.join("");
      resolve({ status: Number(raw.split(" ")[1]), raw });
    });
    socket.on("connect", () => {
      socket.end(
        [
          `${init.method ?? "GET"} ${target} HTTP/1.1`,
          `Host: ${hostname}:${port}`,
          "Connection: close",
          ...Object.entries(init.headers ?? {}).map(
            ([key, value]) => `${key}: ${value}`,
          ),
          "",
          "",
        ].join("\r\n"),
      );
    });
  });
}

/**
 * The `Accept` header a fediverse server sends when dereferencing an object.
 */
export const ACTIVITY_PUB_ACCEPT =
  'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

/**
 * The `Accept` header a browser sends.
 */
export const BROWSER_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

export type { HttpContext };
