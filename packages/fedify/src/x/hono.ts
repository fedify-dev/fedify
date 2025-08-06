/**
 * Fedify with Hono
 * ================
 *
 * This module provides a [Hono] middleware to integrate with the Fedify.
 *
 * [Hono]: https://hono.dev/
 *
 * @module
 * @since 0.6.0
 */
import type {
  Federation,
  FederationFetchOptions,
} from "../federation/federation.ts";

interface HonoRequest {
  raw: Request;
}

interface HonoContext {
  req: HonoRequest;
  res: Response;
}

type HonoMiddleware<THonoContext extends HonoContext> = (
  ctx: THonoContext,
  next: () => Promise<void>,
) => Promise<Response | void>;

/**
 * A factory function to create a context data for the {@link Federation}
 * object.
 *
 * @template TContextData A type of the context data for the {@link Federation}
 *                         object.
 * @template THonoContext A type of the Hono context.
 * @param context A Hono context object.
 * @returns A context data for the {@link Federation} object.
 */
export type ContextDataFactory<TContextData, THonoContext> = (
  context: THonoContext,
) => TContextData | Promise<TContextData>;

/**
 * Create a Hono middleware to integrate with the {@link Federation} object.
 *
 * @template TContextData A type of the context data for the {@link Federation}
 *                         object.
 * @template THonoContext A type of the Hono context.
 * @param federation A {@link Federation} object to integrate with Hono.
 * @param contextDataFactory A function to create a context data for the
 *                           {@link Federation} object.
 * @returns A Hono middleware.
 */
export function federation<TContextData, THonoContext extends HonoContext>(
  federation: Federation<TContextData>,
  contextDataFactory: ContextDataFactory<TContextData, THonoContext>,
): HonoMiddleware<THonoContext> {
  return async (ctx, next) => {
    let contextData = contextDataFactory(ctx);
    if (contextData instanceof Promise) contextData = await contextData;
    return await federation.fetch(ctx.req.raw, {
      contextData,
      ...integrateFetchOptions(ctx, next),
    });
  };
}

function integrateFetchOptions<THonoContext extends HonoContext>(
  ctx: THonoContext,
  next: () => Promise<void>,
): Omit<FederationFetchOptions<void>, "contextData"> {
  return {
    // If the `federation` object finds a request not responsible for it
    // (i.e., not a federation-related request), it will call the `next`
    // provided by the Hono framework to continue the request handling
    // by the Hono:
    async onNotFound(_req: Request): Promise<Response> {
      await next();
      return ctx.res;
    },

    // Similar to `onNotFound`, but slightly more tricky one.
    // When the `federation` object finds a request not acceptable type-wise
    // (i.e., a user-agent doesn't want JSON-LD), it will call the `next`
    // provided by the Hono framework so that it renders HTML if there's some
    // page.  Otherwise, it will simply return a 406 Not Acceptable response.
    // This kind of trick enables the Fedify and Hono to share the same routes
    // and they do content negotiation depending on `Accept` header:
    async onNotAcceptable(_req: Request): Promise<Response> {
      await next();
      if (ctx.res.status !== 404) return ctx.res;
      return new Response("Not acceptable", {
        status: 406,
        headers: {
          "Content-Type": "text/plain",
          Vary: "Accept",
        },
      });
    },
  };
}
