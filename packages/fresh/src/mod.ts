import type { Federation, FederationFetchOptions } from "@fedify/fedify";
import type { Context, Middleware } from "fresh";

/**
 * Creates federation fetch options for a Fresh context, which configures how
 * `federation.fetch` delegates to Fresh's routing system.
 */
export function integrateFetchOptions<TState>(
  ctx: Context<TState>,
): Omit<FederationFetchOptions<void>, "contextData"> {
  return {
    onNotFound: ctx.next.bind(ctx),
    async onNotAcceptable(_request: Request) {
      const response = await ctx.next();
      if (response.status !== 404) return response;
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

/**
 * Integrates Fedify federation with Fresh 2.0 middleware.
 *
 * @param federation - The Fedify federation instance
 * @param createContextData - Function to create context data from Fresh context
 * @returns A Fresh middleware function
 */
export function integrateHandler<TContextData, TState>(
  federation: Federation<TContextData>,
  createContextData: (
    ctx: Context<TState>,
  ) => TContextData | Promise<TContextData>,
): Middleware<TState> {
  return async (ctx: Context<TState>): Promise<Response> => {
    const contextData = await createContextData(ctx);
    return await federation.fetch(ctx.req, {
      contextData,
      ...integrateFetchOptions(ctx),
    });
  };
}
