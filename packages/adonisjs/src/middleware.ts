/**
 * The framework-agnostic core of the AdonisJS ↔ Fedify bridge.
 *
 * Everything in this module works with a plain `Federation` instance and an
 * `HttpContext`.  It knows nothing about the IoC container, `config/fedify.ts`,
 * or the service provider, which makes it directly usable by applications that
 * would rather wire Fedify up by hand (see {@link fedifyMiddleware}) and
 * makes it testable without booting a full AdonisJS application.
 *
 * The Adonis-native layer in `fedify_middleware.ts` is a thin wrapper that
 * resolves the arguments from the container and delegates here.
 *
 * @module
 */
import { Readable } from "node:stream";

import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import type { Federation, RequestContext } from "@fedify/fedify";

import { E_FEDIFY_CONTEXT_UNAVAILABLE } from "./errors.ts";
import type { ContextDataFactory } from "./types.ts";

/**
 * Options accepted by {@link fedifyMiddleware}.
 */
export interface FedifyMiddlewareOptions {
  /**
   * URL path prefixes to bypass entirely.  See
   * {@link import('./types.js').FedifyConfig.ignoreRoutePrefixes}.
   *
   * @default `[]`
   */
  ignoreRoutePrefixes?: string[];
}

/**
 * An instance of the middleware {@link fedifyMiddleware} builds.
 */
export interface FedifyMiddlewareHandler {
  handle(ctx: HttpContext, next: NextFn): Promise<void>;
}

/**
 * What {@link fedifyMiddleware} returns: a middleware **class**.
 *
 * AdonisJS's `server.use()` resolves each entry through the IoC container and
 * constructs it, so a plain object is rejected at runtime with `Cannot
 * construct value`.  Returning the class means the result can be handed to
 * `server.use()` as-is.
 */
export type FedifyMiddlewareClass = new () => FedifyMiddlewareHandler;

/**
 * Methods `new Request()` refuses to construct.  Node rejects `TRACK` itself
 * and never emits `request` for `CONNECT`, so only `TRACE` arrives here.
 */
const FORBIDDEN_METHODS = new Set(["CONNECT", "TRACE", "TRACK"]);

/**
 * Wraps the raw `IncomingMessage` in a `ReadableStream` that stays completely
 * inert until somebody actually reads from it.
 *
 * This laziness is load-bearing, not an optimisation.  Fedify only reads the
 * body of requests it handles — an inbox `POST`, essentially — but the `Request`
 * has to be constructed *before* Fedify decides, so on every other `POST` the
 * body is handed over and then abandoned.
 *
 * Calling `Readable.toWeb()` eagerly would be fatal there.  Node's adapter
 * attaches its own `data` listener to the `IncomingMessage` immediately and
 * starts filling an internal queue; once that queue passes its high-water mark
 * (~128 KiB) with nobody reading, it calls `pause()` on the socket and never
 * resumes.  A downstream reader in flowing mode — which is exactly what
 * `@adonisjs/core/bodyparser_middleware` uses — would then receive the first
 * chunks and nothing more, and the request would hang until the client gave up.
 *
 * With `highWaterMark: 0` the underlying source is not even created until the
 * first `pull()`, so a request Fedify declines reaches the AdonisJS body parser
 * with its stream untouched.
 */
function lazyRequestBody(
  message: HttpContext["request"]["request"],
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        reader ??= (Readable.toWeb(message) as ReadableStream<Uint8Array>)
          .getReader();

        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) {
        return reader?.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

/**
 * Builds the URL Fedify sees from the raw request target.
 *
 * `completeUrl()` would `decodeURI()` the path, but Fedify's URI templates
 * percent-encode sub-delims, so `/actors/alice%21` has to reach it encoded.
 * The raw target also keeps the bytes a peer signed, and resolving it against
 * an origin normalises the absolute-form target RFC 9112 permits
 * (`GET http://host/inbox HTTP/1.1`).
 */
function toRequestUrl(request: HttpContext["request"]): URL {
  // Fedify rewrites the origin to `FederationOptions.origin`, so this only has
  // to be well-formed.
  const authority = request.host() ?? request.hostname() ?? "localhost";
  return new URL(
    request.request.url ?? "/",
    `${request.protocol()}://${authority}`,
  );
}

/**
 * Converts an AdonisJS request into a WHATWG `Request` that Fedify can consume.
 *
 * A few details matter here:
 *
 * - The URL comes from {@link toRequestUrl}, which builds it from the raw
 *   request target.
 * - `intended()`, not `method()`.  `method()` honours AdonisJS's `_method` form
 *   spoofing, which is a convenience for HTML forms and must never reach a
 *   protocol bridge: `POST /inbox?_method=GET` would otherwise arrive at Fedify
 *   as a bodyless `GET` and bypass inbox handling entirely.
 * - Header values can be arrays (Node collapses most duplicates, but not all),
 *   so each element is appended rather than set.
 * - `duplex: 'half'` is required by Node whenever a `Request` is constructed
 *   with a streaming body.
 */
function toFetchRequest(ctx: HttpContext): Request {
  const request = ctx.request;
  const method = request.intended().toUpperCase();

  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers())) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (typeof value === "string") {
      headers.append(key, value);
    }
  }

  const url = toRequestUrl(request);

  const hasBody = method !== "GET" && method !== "HEAD";

  return new Request(url, {
    method,
    headers,
    body: hasBody ? lazyRequestBody(request.request) : undefined,
    // `duplex` is not part of the DOM lib's `RequestInit`, but Node requires it
    // for streaming bodies.
    ...{ duplex: "half" },
  });
}

/**
 * Copies a WHATWG `Response` produced by Fedify onto the AdonisJS response.
 *
 * Notable cases:
 *
 * - `Set-Cookie` must be read through `getSetCookie()`.  Iterating `Headers`
 *   folds repeated headers into a single comma-joined value, which is valid for
 *   most headers but corrupts cookies.
 * - Responses that carry no body (`204`, `304`, and any reply to a `HEAD`
 *   request) must not be streamed.  AdonisJS finalises such a response by
 *   flushing the status line and headers, which is exactly what is wanted.
 * - The body is a web `ReadableStream`; `response.stream()` accepts one
 *   directly since `@adonisjs/http-server` v9 and takes care of backpressure
 *   and cleanup.  The error callback keeps a mid-stream failure from hanging
 *   the socket.
 */
function writeFedifyResponse(response: Response, ctx: HttpContext): void {
  ctx.response.status(response.status);

  for (const [key, value] of response.headers) {
    if (key.toLowerCase() === "set-cookie") continue;
    ctx.response.header(key, value);
  }

  for (const cookie of response.headers.getSetCookie()) {
    ctx.response.append("set-cookie", cookie);
  }

  const bodyless = response.body === null ||
    response.status === 204 ||
    response.status === 304 ||
    // `intended()` rather than `method()`: a spoofed `_method=HEAD` must not
    // suppress the body of a response the client is expecting in full.
    ctx.request.intended().toUpperCase() === "HEAD";

  if (bodyless) {
    // Discard the body so the underlying stream is not left dangling when
    // Fedify produced one anyway (a HEAD request being the usual case).
    void response.body?.cancel();
    return;
  }

  ctx.response.stream(response.body!, (error) => {
    ctx.logger.error({ err: error }, "Failed to stream the Fedify response");
    return ["Internal server error", 500];
  });
}

/**
 * Installs the lazy `ctx.federation` accessor.
 *
 * The property is declared as non-optional on `HttpContext`, so it must be
 * present on every request the middleware touches — including the ones Fedify
 * declines to handle, because a controller serving the HTML half of a shared
 * URL is precisely where `ctx.federation` is most useful.
 *
 * Creating a `RequestContext` eagerly would mean doing that work on every
 * single request, including the ones that never look at it.  A getter defers it
 * to first access and memoises the result.
 */
function defineFederationContext<TContextData>(
  ctx: HttpContext,
  create: () => RequestContext<TContextData>,
): void {
  let cached: RequestContext<TContextData> | undefined;
  let created = false;

  Object.defineProperty(ctx, "federation", {
    configurable: true,
    enumerable: false,
    get() {
      if (!created) {
        cached = create();
        created = true;
      }
      return cached;
    },
  });
}

/**
 * Creates the middleware that mounts a `Federation` instance inside an AdonisJS
 * application.
 *
 * This is the main integration function of the package, and the counterpart of
 * `integrateFederation()` in `@fedify/express` and `federation()` in
 * `@fedify/hono`.  It is named `fedifyMiddleware` and exported as the default
 * export because AdonisJS's own documentation calls these things middleware,
 * which is the naming convention Fedify's integration guide asks for.
 *
 * Register the returned object in the **server** middleware stack, not the
 * router stack.  Fedify serves paths that the AdonisJS router knows nothing
 * about (`/.well-known/webfinger`, `/.well-known/nodeinfo`, actor and inbox
 * endpoints), so the middleware has to run before route matching.  Running in
 * the server stack also means the request body stream is still intact, which
 * inbox signature verification depends on.
 *
 * Most applications never call this directly: `node ace configure` registers
 * `@fedify/adonisjs/middleware`, which resolves the federation and the
 * configuration from the IoC container and delegates here.  Reach for it when
 * you would rather build the `Federation` object yourself.
 *
 * @example
 * ```ts
 * // start/kernel.ts
 * import fedifyMiddleware from '@fedify/adonisjs'
 * import federation from '#federation/main'
 *
 * server.use([async () => ({ default: fedifyMiddleware(federation) })])
 * ```
 *
 * @returns A middleware class, which is what `server.use()` constructs.
 *
 * @param federation The federation instance to mount.
 * @param contextDataFactory Produces the per-request context data.  Defaults to
 *   producing `undefined`, which is what a federation whose `TContextData` is
 *   `void` wants; the AdonisJS-native layer passes the factory resolved from
 *   `config/fedify.ts` instead.
 * @param options Additional behaviour toggles.
 */
export function fedifyMiddleware<TContextData>(
  federation: Federation<TContextData>,
  contextDataFactory: ContextDataFactory<TContextData> = () =>
    void 0 as TContextData,
  options: FedifyMiddlewareOptions = {},
): FedifyMiddlewareClass {
  const ignoreRoutePrefixes = options.ignoreRoutePrefixes ?? [];

  const handler: FedifyMiddlewareHandler = {
    async handle(ctx: HttpContext, next: NextFn): Promise<void> {
      // This check and Fedify have to read the same path, so both derive it
      // through `toRequestUrl()` rather than from `ctx.request.url()`.
      const path = toRequestUrl(ctx.request).pathname;

      if (
        ignoreRoutePrefixes.some((prefix) => path.startsWith(prefix)) ||
        FORBIDDEN_METHODS.has(ctx.request.intended().toUpperCase())
      ) {
        // Opted out, or impossible to represent as a `Request`.  Touching
        // `ctx.federation` is then a programming error, but it is declared
        // non-optional, so it still has to exist and say so.
        defineFederationContext(ctx, () => {
          throw new E_FEDIFY_CONTEXT_UNAVAILABLE(path);
        });
        return next();
      }

      const request = toFetchRequest(ctx);
      const contextData = await contextDataFactory(ctx);

      defineFederationContext(
        ctx,
        () => federation.createContext(request, contextData),
      );

      /**
       * What happened while Fedify was deciding.  Held in an object rather than
       * two `let` bindings so that TypeScript does not narrow the values based
       * on their initialisers — the callbacks below are the only writers, and
       * the compiler cannot see that they run.
       *
       * - `delegated` records which of Fedify's fall-through callbacks fired,
       *   if any.  Fedify calls at most one of them per request, and only when
       *   it has decided not to serve the request itself.
       * - `routeMatched` records whether the AdonisJS router matched a route
       *   once control was handed to it.  `ctx.route` is assigned by the router
       *   immediately before a matched route's handler runs, so after
       *   `await next()` it is set if and only if something matched.  This is
       *   the AdonisJS analogue of the `req.route` check `@fedify/express`
       *   uses, and it is strictly more reliable than inspecting the response
       *   body: a matched route may legitimately answer with a redirect, a
       *   stream, or an empty `204`, none of which leave "content" behind.
       * - `status` records what AdonisJS ended up answering, so that a
       *   deliberate downstream response is never mistaken for "nothing here".
       */
      const outcome: {
        delegated: "none" | "notFound" | "notAcceptable";
        routeMatched: boolean;
        status: number;
      } = { delegated: "none", routeMatched: false, status: 0 };

      const response = await federation.fetch(request, {
        contextData,

        /**
         * Fedify has no route for this path: hand the request to AdonisJS.
         *
         * `await next()` runs the remainder of the server middleware stack and
         * then the router.  It resolves even when nothing matches, because the
         * server's middleware runner routes `E_ROUTE_NOT_FOUND` through the
         * application's exception handler, which renders a 404 into
         * `ctx.response`.  Either way AdonisJS has now produced the response,
         * so the value returned here is discarded.
         */
        onNotFound: async () => {
          outcome.delegated = "notFound";
          await next();
          outcome.routeMatched = ctx.route !== undefined;
          return new Response("Not found", { status: 404 });
        },

        /**
         * Fedify has a route for this path but cannot satisfy the `Accept`
         * header — the classic case being a browser asking for HTML at an actor
         * URL that Fedify serves as JSON-LD.
         *
         * Per the Fedify integration specification, the correct behaviour is
         * *not* to answer 406 straight away.  The framework gets a chance to
         * serve its own representation first, and 406 is only the answer if the
         * framework has nothing either.  That is what makes a single URL able to
         * serve an HTML profile page to browsers and an ActivityPub actor
         * document to servers.
         *
         * `Vary: Accept` is set before delegating so that whatever AdonisJS
         * returns is cached per `Accept` header rather than shared across
         * content types.
         */
        onNotAcceptable: async () => {
          outcome.delegated = "notAcceptable";
          ctx.response.header("Vary", "Accept");
          await next();
          outcome.routeMatched = ctx.route !== undefined;
          outcome.status = ctx.response.getStatus();

          // The 406 is produced below, on the `delegated === "notAcceptable"`
          // path, never here.  The callback's return value can only ever be
          // used when `delegated === "none"`, which is unreachable here — so
          // this is a type-satisfying placeholder, not the real response.
          return new Response("Not acceptable", { status: 406 });
        },
      });

      /**
       * Only replace what AdonisJS produced when it really produced nothing.
       *
       * "No route matched" alone is not enough evidence.  A server middleware
       * registered after this one can answer a request without the router ever
       * running — `@adonisjs/cors` replying `204` to a preflight is the common
       * case, and its own configure hook appends it after this middleware — and
       * a downstream failure can render a 5xx the same way.  Overwriting either
       * with a 406 would be wrong.  Requiring the status to still be the
       * framework's own 404 keeps the specification behaviour while leaving any
       * deliberate downstream response alone.
       */
      if (
        outcome.delegated === "notAcceptable" &&
        !outcome.routeMatched &&
        outcome.status === 404
      ) {
        // Downstream middleware may have replaced `Vary`, and a 406 cached
        // without `Accept` could be served to an ActivityPub client.
        const vary = String(ctx.response.getHeader("Vary") ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value !== "");
        if (!vary.some((v) => v === "*" || v.toLowerCase() === "accept")) {
          vary.push("Accept");
        }

        ctx.response
          .status(406)
          .header("Vary", vary.join(", "))
          .type("text/plain")
          .send("Not acceptable");
        return;
      }

      if (outcome.delegated !== "none") {
        // AdonisJS produced the response — either from a matched route, or as
        // its own 404 page.  Leave it alone.
        return;
      }

      writeFedifyResponse(response, ctx);
    },
  };

  return class FedifyMiddleware {
    handle = handler.handle;
  };
}

/**
 * The main integration function, also available as the default export.
 *
 * `@fedify/fastify` does the same for `fedifyPlugin`: the default export is
 * what Fedify's integration guide asks for, and the named one keeps
 * `import { fedifyMiddleware }` working for anyone who prefers it.
 */
export default fedifyMiddleware;
