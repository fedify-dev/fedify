/**
 * Fedify with Koa
 * ===============
 *
 * This package provides a [Koa] middleware to integrate with Fedify.
 *
 * [Koa]: https://koajs.com/
 *
 * @module
 * @since 1.9.0
 */
import type { Federation } from "@fedify/fedify/federation";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

/**
 * A factory function to create context data for the {@link Federation} object.
 *
 * @template TContextData A type of the context data for the {@link Federation}
 *                        object.
 * @template TKoaContext A type of the Koa context.
 * @param context A Koa context object.
 * @returns A context data for the {@link Federation} object.
 * @since 1.9.0
 */
// deno-lint-ignore no-explicit-any
export type ContextDataFactory<TContextData, TKoaContext = any> = (
  context: TKoaContext,
) => TContextData | Promise<TContextData>;

/**
 * Create a Koa middleware to integrate with the {@link Federation} object.
 *
 * @template TContextData A type of the context data for the {@link Federation}
 *                        object.
 * @template TKoaContext A type of the Koa context.
 * @param federation A {@link Federation} object to integrate with Koa.
 * @param contextDataFactory A function to create a context data for the
 *                           {@link Federation} object.
 * @returns A Koa middleware.
 * @since 1.9.0
 */
// deno-lint-ignore no-explicit-any
export function createMiddleware<TContextData, TKoaContext = any>(
  federation: Federation<TContextData>,
  contextDataFactory: ContextDataFactory<TContextData, TKoaContext>,
): (ctx: TKoaContext, next: () => Promise<void>) => Promise<void> {
  return async (ctx: TKoaContext, next: () => Promise<void>) => {
    const { request, body } = toRequest(ctx);
    const contextData = await contextDataFactory(ctx);

    let notFound = false;
    let notAcceptable = false;

    const response = await federation.fetch(request, {
      contextData,
      onNotFound: async () => {
        // If the `federation` object finds a request not responsible for it
        // (i.e., not a federation-related request), it will call the `next`
        // function provided by the Koa framework to continue the request
        // handling by Koa:
        notFound = true;
        body?.restore();
        await next();
        return new Response("Not found", { status: 404 }); // unused
      },
      onNotAcceptable: async () => {
        // Similar to `onNotFound`, but slightly more tricky.
        // When the `federation` object finds a request not acceptable
        // type-wise (i.e., a user-agent doesn't want JSON-LD), it will call
        // the `next` function provided by the Koa framework to continue
        // if any route is matched, and otherwise, it will return a 406 Not
        // Acceptable response:
        notAcceptable = true;
        body?.restore();
        await next();
        return new Response("Not acceptable", {
          status: 406,
          headers: {
            "Content-Type": "text/plain",
            Vary: "Accept",
          },
        });
      },
    });

    if (!notFound && !notAcceptable) {
      setResponse(ctx, response);
    }
  };
}

// deno-lint-ignore no-explicit-any
function toRequest(ctx: any): { request: Request; body?: RequestBody } {
  const url = `${ctx.protocol}://${ctx.host}${ctx.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(ctx.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (typeof value === "string") {
      headers.append(key, value);
    }
  }
  const body = ctx.method === "GET" || ctx.method === "HEAD"
    ? undefined
    : createRequestBody(ctx.req);
  const request = new Request(url, {
    method: ctx.method,
    headers,
    // @ts-expect-error: duplex is not supported in Deno, but it is in Node.js
    duplex: "half",
    body: body?.stream,
  });
  return { request, body };
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

// deno-lint-ignore no-explicit-any
function setResponse(ctx: any, response: Response): void {
  ctx.status = response.status;
  response.headers.forEach((value, key) => ctx.set(key, value));
  if (response.body == null) return;
  const body = response.body;
  const reader = body.getReader();
  ctx.body = new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done) {
        this.push(null);
        reader.releaseLock();
      } else {
        this.push(value);
      }
    },
  });
}
