/**
 * Fedify with Fresh
 * =================
 *
 * This module contains some utilities for integrating Fedify with [Fresh],
 * a web framework for Deno.
 *
 * [Fresh]: https://fresh.deno.dev/
 *
 * @module
 * @since 0.4.0
 */
import type {
  Federation,
  FederationFetchOptions,
} from "../federation/federation.ts";

interface FreshContext {
  next(): Promise<Response>;
}

/**
 * Create options for the {@link Federation.fetch} method to integrate with
 * Fresh.
 *
 * @example _middleware.ts
 * ``` typescript
 * import { integrateFetchOptions } from "@fedify/fedify/x/fresh";
 * import { FreshContext } from "$fresh/server.ts";
 * import { federation } from "./federation.ts"; // Import the `Federation` object
 *
 * export async function handler(request: Request, context: FreshContext) {
 *   return await federation.fetch(request, {
 *     contextData: undefined,
 *     ...integrateHandlerOptions(context),
 *   })
 * }
 * ```
 *
 * @param context A Fresh context.
 * @returns Options for the {@link Federation.fetch} method.
 * @since 0.6.0
 */
export function integrateFetchOptions(
  context: FreshContext,
): Omit<FederationFetchOptions<void>, "contextData"> {
  return {
    // If the `federation` object finds a request not responsible for it
    // (i.e., not a federation-related request), it will call the `next`
    // provided by the Fresh framework to continue the request handling
    // by the Fresh:
    onNotFound: context.next.bind(context),

    // Similar to `onNotFound`, but slightly more tricky one.
    // When the `federation` object finds a request not acceptable type-wise
    // (i.e., a user-agent doesn't want JSON-LD), it will call the `next`
    // provided by the Fresh framework so that it renders HTML if there's some
    // page.  Otherwise, it will simply return a 406 Not Acceptable response.
    // This kind of trick enables the Fedify and Fresh to share the same routes
    // and they do content negotiation depending on `Accept` header:
    async onNotAcceptable(_request: Request) {
      const response = await context.next();
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
 * Create a Fresh middleware handler to integrate with the {@link Federation}
 * object.
 *
 * @example _middleware.ts
 * ``` typescript
 * import { integrateHandler } from "@fedify/fedify/x/fresh";
 * import { federation } from "./federation.ts"; // Import the `Federation` object
 *
 * export const handler = integrateHandler(federation, () => undefined);
 * ```
 *
 * @template TContextData A type of the context data for the {@link Federation}
 *                         object.
 * @template TFreshContext A type of the Fresh context.
 * @param federation A {@link Federation} object to integrate with Fresh.
 * @param createContextData A function to create a context data for the
 *                          {@link Federation} object.
 * @returns A Fresh middleware handler.
 * @since 0.4.0
 */
export function integrateHandler<
  TContextData,
  TFreshContext extends FreshContext,
>(
  federation: Federation<TContextData>,
  createContextData: (
    req: Request,
    ctx: TFreshContext,
  ) => TContextData | Promise<TContextData>,
): (req: Request, ctx: TFreshContext) => Promise<Response> {
  return async (
    request: Request,
    context: TFreshContext,
  ): Promise<Response> => {
    const contextData = await createContextData(request, context);
    return await federation.fetch(request, {
      contextData,
      ...integrateFetchOptions(context),
    });
  };
}
