/**
 * Fedify with Hono
 * ================
 *
 * This package provides a [Hono] middleware to integrate with the Fedify.
 *
 * [Hono]: https://hono.dev/
 *
 * @module
 * @since 1.9.0
 */
import type {
  Federation,
  FederationFetchOptions,
} from "@fedify/fedify/federation";

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
 * @since 1.9.0
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
 * @since 1.9.0
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
      const matchedRoutes = (ctx.req as HonoRequest & {
        matchedRoutes?: { method: string; path: string }[];
      }).matchedRoutes;
      // Public route metadata cannot distinguish an intentional default-text
      // 404 from terminal handling after a matched route calls next(). Keep
      // ownership with application routes, including wildcard endpoints and
      // concrete ALL routes. Only generic ALL middleware permits a fallback.
      if (
        matchedRoutes?.some((route) =>
          route.method !== "ALL" || !route.path.endsWith("*")
        )
      ) {
        await next();
        return ctx.res;
      }
      // Hono calls its private not-found handler directly. Observe the
      // default text response and res assignments without reading any body or
      // mutating application headers. Body identity is not stable on Bun.
      const context = ctx as unknown as {
        text?: (...args: unknown[]) => Response;
      };
      const text = context.text;
      const ownRes = Object.getOwnPropertyDescriptor(ctx, "res");
      let owner: object | null = ctx;
      let res = ownRes;
      while (res == null && (owner = Object.getPrototypeOf(owner)) != null) {
        res = Object.getOwnPropertyDescriptor(owner, "res");
      }
      let defaultResponse: Response | undefined;
      let defaultNotFound = false;
      const wrappedText = (...args: unknown[]): Response => {
        const response = text!.apply(ctx, args);
        if (args[0] === "404 Not Found" && args[1] === 404) {
          defaultResponse = response;
        }
        return response;
      };
      const setRes = (response: Response): void => {
        res!.set!.call(ctx, response);
        // A later assignment from application middleware owns its response,
        // even when Hono copies headers from the previous default 404.
        defaultNotFound = response === defaultResponse;
      };
      const observing = res?.get != null && res.set != null &&
        ownRes?.configurable !== false && text != null;
      if (observing) {
        context.text = wrappedText;
        Object.defineProperty(ctx, "res", {
          configurable: true,
          enumerable: res!.enumerable,
          get: () => res!.get!.call(ctx),
          set: setRes,
        });
      }
      try {
        await next();
      } finally {
        if (context.text === wrappedText) context.text = text;
        if (Object.getOwnPropertyDescriptor(ctx, "res")?.set === setRes) {
          if (ownRes == null) delete (ctx as Partial<HonoContext>).res;
          else Object.defineProperty(ctx, "res", ownRes);
        }
      }
      if (ctx.res.status !== 404 || !defaultNotFound) return ctx.res;
      const vary = ctx.res.headers.get("Vary");
      // Hono ignores middleware return values once downstream finalized ctx.
      // Its response setter also copies old headers onto the new response.
      ctx.res = new Response("Not acceptable", { status: 406 });
      for (
        const header of [
          "Content-Encoding",
          "Content-Language",
          "Content-Range",
          "ETag",
          "Last-Modified",
          "Transfer-Encoding",
          "Content-Length",
        ]
      ) ctx.res.headers.delete(header);
      ctx.res.headers.set("Content-Type", "text/plain; charset=utf-8");
      const fields = vary?.split(",").map((field) => field.trim()) ?? [];
      if (
        !fields.some((field) =>
          field === "*" || field.toLowerCase() === "accept"
        )
      ) {
        fields.push("Accept");
      }
      ctx.res.headers.set("Vary", fields.join(", "));
      return ctx.res;
    },
  };
}
