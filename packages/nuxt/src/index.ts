/**
 * Fedify with Nuxt
 * ================
 *
 * This package provides a [Nuxt] server handler to integrate with Fedify.
 *
 * [Nuxt]: https://nuxt.com/
 *
 * @module
 * @since 2.2.0
 */

import type { Federation } from "@fedify/fedify/federation";
import {
  defineEventHandler,
  type EventHandler,
  type EventHandlerRequest,
  type EventHandlerResponse,
  type H3Error,
  type H3Event,
  toWebRequest,
} from "h3";

/**
 * A factory function that creates the context data that will be passed to the
 * {@link Federation} instance.
 *
 * @template TContextData The type of the context data.
 * @param event The Nuxt/Nitro event for the current request.
 * @param request The Web API request converted from the event.
 * @returns The context data, or a promise resolving to the context data.
 * @since 2.2.0
 */
export type ContextDataFactory<TContextData> = (
  event: H3Event<EventHandlerRequest>,
  request: Request,
) => Promise<TContextData> | TContextData;

/**
 * Create a Nuxt server handler to integrate with the {@link Federation}
 * object.
 *
 * This handler is intended to be used from a file under
 * *server/middleware/*.  When Fedify does not own the route, it delegates to
 * the rest of the Nuxt request pipeline.  When content negotiation fails, it
 * stores the 406 response so that {@link fedifyErrorHandler} can return it if
 * Nuxt later resolves the same request to a 404.
 *
 * @example server/middleware/federation.ts
 * ``` typescript
 * import federation from "../federation";
 * import { fedifyHandler } from "@fedify/nuxt";
 *
 * export default fedifyHandler(federation);
 * ```
 *
 * @template TContextData A type of the context data for the
 *                        {@link Federation} object.
 * @param federation A {@link Federation} object to integrate with Nuxt.
 * @param contextDataFactory A function to create context data for the
 *                           {@link Federation} object.
 * @returns A Nuxt-compatible event handler.
 * @since 2.2.0
 */
export function fedifyHandler<TContextData>(
  federation: Federation<TContextData> | Promise<Federation<TContextData>>,
  contextDataFactory: ContextDataFactory<TContextData> = () =>
    undefined as TContextData,
): EventHandler<EventHandlerRequest, EventHandlerResponse> {
  return defineEventHandler({
    async handler(event) {
      const resolvedFederation = await federation;
      const request = toWebRequest(event);
      const response = await resolvedFederation.fetch(request, {
        contextData: await contextDataFactory(event, request),
      });
      if (response.status === 404) return;
      if (response.status === 406) {
        event.context[NOT_ACCEPTABLE_RESPONSE_KEY] = response;
        return;
      }
      await event.respondWith(response);
    },
  });
}

/**
 * A Nitro error handler that finalizes Fedify content negotiation for Nuxt.
 *
 * Configure this as `nitro.errorHandler` in *nuxt.config.ts*.  If
 * {@link fedifyHandler} stored a 406 response and Nuxt later resolves the same
 * request to a 404, this handler returns the stored 406 instead.
 *
 * @example server/error.ts
 * ``` typescript
 * import { fedifyErrorHandler } from "@fedify/nuxt";
 *
 * export default fedifyErrorHandler;
 * ```
 *
 * @param error The H3 error raised by Nitro.
 * @param event The H3 event for the request.
 * @returns Nothing.  The response is written directly to the event when
 *          needed.
 * @since 2.2.0
 */
export async function fedifyErrorHandler(
  error: H3Error<unknown>,
  event: H3Event<EventHandlerResponse>,
): Promise<void> {
  if (
    NOT_ACCEPTABLE_RESPONSE_KEY in event.context &&
    event.context[NOT_ACCEPTABLE_RESPONSE_KEY] instanceof Response &&
    error.statusCode === 404
  ) {
    await event.respondWith(event.context[NOT_ACCEPTABLE_RESPONSE_KEY]);
  }
}

const NOT_ACCEPTABLE_RESPONSE_KEY = "__fedify_response__";
