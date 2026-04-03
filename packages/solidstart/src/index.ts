/**
 * Fedify with SolidStart
 * ======================
 *
 * This package provides a [SolidStart] middleware to integrate with the Fedify.
 *
 * [SolidStart]: https://start.solidjs.com/
 *
 * @module
 * @since 2.2.0
 */

import type { Federation } from "@fedify/fedify/federation";
import { createMiddleware } from "@solidjs/start/middleware";
import type { FetchEvent } from "@solidjs/start/server";

/**
 * A factory function that creates the context data for the
 * {@link Federation} object.
 *
 * @template TContextData The type of the context data.
 * @param event The SolidStart {@link FetchEvent} for the current request.
 * @returns The context data, or a promise resolving to the context data.
 * @since 2.2.0
 */
export type ContextDataFactory<TContextData> = (
  event: FetchEvent,
) => TContextData | Promise<TContextData>;

// Internal storage for 406 Not Acceptable responses across the
// onRequest -> onBeforeResponse lifecycle, keyed by Request object.
const notAcceptableResponses: WeakMap<Request, Response> = new WeakMap();

/**
 * Create a SolidStart middleware to integrate with the {@link Federation}
 * object.
 *
 * @example src/middleware/index.ts
 * ``` typescript
 * import { fedifyMiddleware } from "@fedify/solidstart";
 * import federation from "../lib/federation";
 *
 * export default fedifyMiddleware(federation);
 * ```
 *
 * @template TContextData A type of the context data for the
 *                         {@link Federation} object.
 * @param federation A {@link Federation} object to integrate with SolidStart.
 * @param createContextData A function to create context data for the
 *                          {@link Federation} object.
 * @returns A SolidStart middleware object.
 * @since 2.2.0
 */
export function fedifyMiddleware<TContextData>(
  federation: Federation<TContextData>,
  createContextData: ContextDataFactory<TContextData> = () =>
    undefined as TContextData,
): ReturnType<typeof createMiddleware> {
  return createMiddleware({
    onRequest: async (event: FetchEvent) => {
      const response = await federation.fetch(event.request, {
        contextData: await createContextData(event),
        onNotFound: () => new Response("Not Found", { status: 404 }),
        onNotAcceptable: () =>
          new Response("Not Acceptable", {
            status: 406,
            headers: { "Content-Type": "text/plain", Vary: "Accept" },
          }),
      });

      // If Fedify does not handle this route, let SolidStart handle it:
      if (response.status === 404) return;

      // If content negotiation failed (client does not want JSON-LD),
      // store the 406 response and let SolidStart try to serve HTML.
      // If SolidStart also cannot handle it, onBeforeResponse will
      // return the 406:
      if (response.status === 406) {
        notAcceptableResponses.set(event.request, response);
        return;
      }

      // Fedify handled the request successfully:
      return response;
    },

    // Similar to onRequest, but slightly more tricky one.
    // When the federation object finds a request not acceptable type-wise
    // (i.e., a user-agent does not want JSON-LD), onRequest stores the 406
    // response and lets SolidStart try to render HTML.  If SolidStart also
    // has no page for this route (404), we return the stored 406 instead.
    // This enables Fedify and SolidStart to share the same routes and do
    // content negotiation depending on the Accept header:
    onBeforeResponse: (event: FetchEvent) => {
      const stored = notAcceptableResponses.get(event.request);
      if (stored != null) {
        notAcceptableResponses.delete(event.request);
        const status = event.response.status ?? 200;
        if (status === 404) return stored;
      }
    },
  });
}
