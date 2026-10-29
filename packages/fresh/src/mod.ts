/**
 * Integrates Fedify with [Fresh](https://fresh.deno.dev/) 2.x.
 *
 * @deprecated Fedify keeps supporting this integration throughout the 2.x
 *             series, but Fresh is not recommended for new projects.  Deno's
 *             team will end its own development of the Deno runtime, and this
 *             integration targets Fresh 2.x, which runs on Deno.  The
 *             integration is tentatively planned for removal in Fedify 3.0.0,
 *             and that plan may be reconsidered if Fresh gains stable support
 *             for runtimes other than Deno.  See
 *             {@link https://github.com/fedify-dev/fedify/issues/1326} for
 *             details.
 * @module
 */

import type { Federation, FederationFetchOptions } from "@fedify/fedify";
import type { Context, Middleware } from "fresh";
import { warnFreshDeprecated } from "./deprecation.ts";

/**
 * Creates federation fetch options for a Fresh context, which configures how
 * `federation.fetch` delegates to Fresh's routing system.
 *
 * @deprecated Fedify keeps supporting this function throughout the 2.x series,
 *             but Fresh is not recommended for new projects.  See
 *             {@link integrateHandler} and
 *             {@link https://github.com/fedify-dev/fedify/issues/1326} for
 *             the tentative removal plan.
 */
export function integrateFetchOptions<TState>(
  ctx: Context<TState>,
): Omit<FederationFetchOptions<void>, "contextData"> {
  warnFreshDeprecated();
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
 * @deprecated Fedify keeps supporting this function throughout the 2.x series,
 *             but Fresh is not recommended for new projects.  Deno's team will
 *             end its own development of the Deno runtime, and this
 *             integration targets Fresh 2.x, which runs on Deno.  The
 *             integration is tentatively planned for removal in Fedify 3.0.0,
 *             and that plan may be reconsidered if Fresh gains stable support
 *             for runtimes other than Deno.  See
 *             {@link https://github.com/fedify-dev/fedify/issues/1326} for
 *             details.
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
  warnFreshDeprecated();
  return async (ctx: Context<TState>): Promise<Response> => {
    const contextData = await createContextData(ctx);
    return await federation.fetch(ctx.req, {
      contextData,
      ...integrateFetchOptions(ctx),
    });
  };
}
