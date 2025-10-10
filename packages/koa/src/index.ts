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
    const request = toRequest(ctx);
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
function toRequest(ctx: any): Request {
  const url = `${ctx.protocol}://${ctx.host}${ctx.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(ctx.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (typeof value === "string") {
      headers.append(key, value);
    }
  }
  return new Request(url, {
    method: ctx.method,
    headers,
    // @ts-expect-error: duplex is not supported in Deno, but it is in Node.js
    duplex: "half",
    body: ctx.method === "GET" || ctx.method === "HEAD"
      ? undefined
      : Readable.toWeb(ctx.req),
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
