/**
 * Fedify with Fastify
 * ===================
 *
 * This module provides integration between Fedify and Fastify.
 */
import type { Federation, FederationFetchOptions } from "@fedify/fedify";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyPluginOptions,
  FastifyRequest,
} from "fastify";
import fp from "fastify-plugin";

import { Buffer } from "node:buffer";
import type { Readable } from "node:stream";

type ErrorHandlers = Omit<FederationFetchOptions<unknown>, "contextData">;

/**
 * A factory function that creates context data for the Federation instance.
 */
export type ContextDataFactory<TContextData> = (
  request: FastifyRequest,
) => TContextData | Promise<TContextData>;

/**
 * Plugin options for Fedify integration.
 */
export interface FedifyPluginOptions<TContextData>
  extends FastifyPluginOptions {
  federation: Federation<TContextData>;
  contextDataFactory?: ContextDataFactory<TContextData>;
  errorHandlers?: Partial<ErrorHandlers>;
}

/**
 * Fastify plugin that integrates with a Federation instance.
 *
 * @example
 * ```typescript
 * import { createFederation, MemoryKvStore } from "@fedify/fedify";
 * import { Person } from "@fedify/vocab";
 * import fedifyPlugin from "@fedify/fastify";
 * import Fastify from "fastify";
 *
 * const fastify = Fastify();
 *
 * const federation = createFederation({ kv: new MemoryKvStore() });
 *
 * // Add federation routes
 * federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
 *   return new Person({
 *     id: ctx.getActorUri(identifier),
 *     preferredUsername: identifier,
 *   });
 * });
 *
 * // Register the plugin
 * await fastify.register(fedifyPlugin, {
 *   federation,
 *   contextDataFactory: () => undefined,
 *   errorHandlers: { onNotFound: () => new Response("Not Found", { status: 404 }) },
 * });
 * ```
 */
const fedifyPluginCore: FastifyPluginAsync<FedifyPluginOptions<unknown>> = (
  fastify: FastifyInstance,
  options: FedifyPluginOptions<unknown>,
) => {
  const { federation, contextDataFactory = () => undefined, errorHandlers } =
    options;
  fastify.addHook("onRequest", async (request, reply) => {
    const { request: webRequest, body } = toWebRequest(request);
    const contextData = await contextDataFactory(request);

    const response = await federation.fetch(webRequest, {
      contextData,
      onNotAcceptable: createDefaultNotAcceptableResponse,
      onNotFound: () => dummyNotFoundResponse,
      ...errorHandlers,
    });

    // Delegate to Fastify if the response is a dummy not found response.
    if (response === dummyNotFoundResponse) {
      body?.restore();
      return;
    }

    await reply.send(response);
  });
  return Promise.resolve();
};

// Wrap with fastify-plugin to bypass encapsulation
const fedifyPlugin: FastifyPluginAsync<FedifyPluginOptions<unknown>> = fp(
  fedifyPluginCore,
  {
    name: "fedify-plugin",
    fastify: "5.x",
  },
);

const dummyNotFoundResponse = new Response("", { status: 404 });
const createDefaultNotAcceptableResponse = () =>
  new Response("Not Acceptable", {
    status: 406,
    headers: { "Content-Type": "text/plain", Vary: "Accept" },
  });

/**
 * Convert Fastify request to Web API Request.
 */
function toWebRequest(
  fastifyReq: FastifyRequest,
): { request: Request; body?: RequestBody } {
  const protocol = fastifyReq.protocol;
  const host = fastifyReq.headers.host ?? fastifyReq.hostname;
  const url = `${protocol}://${host}${fastifyReq.url}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(fastifyReq.raw.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value !== undefined) {
      headers.set(key, String(value));
    }
  }

  let body: string | ReadableStream<Uint8Array> | undefined;
  let rawBody: RequestBody | undefined;
  if (fastifyReq.method === "GET" || fastifyReq.method === "HEAD") {
    body = undefined;
  } else if (fastifyReq.body !== undefined) {
    body = typeof fastifyReq.body === "string"
      ? fastifyReq.body
      : JSON.stringify(fastifyReq.body);
  } else {
    rawBody = createRequestBody(fastifyReq.raw);
    body = rawBody.stream;
  }

  const request = new Request(url, {
    method: fastifyReq.method,
    headers,
    body,
    // @ts-ignore: duplex is not supported in Deno, but it is in Node.js
    duplex: "half",
  });
  return { request, body: rawBody };
}

/**
 * The body of a request handed to Fedify, which can be given back to the
 * framework if Fedify declines the request.
 */
interface RequestBody {
  /** The stream to use as the body of the `Request` passed to Fedify. */
  readonly stream: ReadableStream<Uint8Array>;
  /**
   * Puts every chunk Fedify has read back into the raw request, so that the
   * framework's own body parsers see the whole body.  Call this before handing
   * a declined request to the next middleware.
   */
  restore(): void;
}

/**
 * Wraps the raw `IncomingMessage` in a `ReadableStream` that stays inert until
 * first read, and that keeps the chunks it reads so that they can be put back.
 *
 * The `Request` is built before Fedify decides whether it handles the request.
 * Laziness alone is not enough: `Request.clone()` tees the body, and a tee pulls
 * a chunk right away, so a dispatcher calling `ctx.getSignedKey()` starts
 * reading the body even if Fedify then declines the request.  Reading in paused
 * mode, rather than through `Readable.toWeb()`, lets `restore()` unshift those
 * chunks back.
 */
function createRequestBody(message: Readable): RequestBody {
  const consumed: Uint8Array[] = [];
  const restoring = new AbortController();
  let started = false;
  let restored = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        started = true;
        while (!restored) {
          const size = message.readableLength;
          // Reading the exact buffered size, unlike read() without an argument,
          // never makes the stream emit "end", after which unshift() would
          // throw:
          const chunk: Uint8Array | string | null = size > 0
            ? message.read(size)
            : null;
          if (chunk != null) {
            const bytes = typeof chunk === "string"
              ? Buffer.from(chunk)
              : chunk;
            consumed.push(bytes);
            controller.enqueue(bytes);
            return;
          }
          if (isEnded(message)) break;
          if (message.destroyed) {
            throw new Error("The request was closed before its body ended.");
          }
          await waitForReadable(message, restoring.signal);
        }
        controller.close();
      },
      cancel(reason) {
        if (started && !restored) {
          message.destroy(reason instanceof Error ? reason : undefined);
        }
      },
    },
    { highWaterMark: 0 },
  );
  return {
    stream,
    restore() {
      restored = true;
      // Detaches a pending "readable" listener, which would otherwise keep the
      // stream from flowing into the framework's "data" listeners:
      restoring.abort();
      for (let i = consumed.length - 1; i >= 0; i--) {
        message.unshift(consumed[i]);
      }
      consumed.length = 0;
    },
  };
}

/**
 * Tells whether the stream has received all of its data, even if it has not
 * emitted `"end"` yet.  No public API exposes this, so it reads the internal
 * state, which Node.js, Deno, and Bun all provide, and falls back to
 * `readableEnded` elsewhere.
 */
function isEnded(message: Readable): boolean {
  const state = (message as Readable & {
    _readableState?: { ended?: boolean };
  })._readableState;
  return state?.ended ?? message.readableEnded;
}

function waitForReadable(
  message: Readable,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve();
    const cleanup = () => {
      message.off("readable", onReady);
      message.off("end", onReady);
      message.off("close", onReady);
      message.off("error", onError);
      signal.removeEventListener("abort", onReady);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (error: unknown) => {
      cleanup();
      reject(error);
    };
    message.on("readable", onReady);
    message.on("end", onReady);
    message.on("close", onReady);
    message.on("error", onError);
    signal.addEventListener("abort", onReady);
  });
}

export default fedifyPlugin;

export { fedifyPlugin };
