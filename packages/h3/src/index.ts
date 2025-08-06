import type { Federation } from "@fedify/fedify";
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
 * `Federation` instance.
 * @template TContextData The type of the context data that will be passed to
 *                         the `Federation` instance.
 * @param event The event that triggered the handler.
 * @param request The request that triggered the handler.
 * @returns The context data that will be passed to the `Federation` instance.
 *          This can be a promise that resolves to the context data.
 */
export type ContextDataFactory<TContextData> = (
  event: H3Event<EventHandlerRequest>,
  request: Request,
) => Promise<TContextData> | TContextData;

/**
 * Integrates a `Federation` instance with an H3 handler.
 * @param federation
 * @param contextDataFactory
 * @returns
 */
export function integrateFederation<TContextData>(
  federation: Federation<TContextData>,
  contextDataFactory: ContextDataFactory<TContextData>,
): EventHandler<EventHandlerRequest, EventHandlerResponse> {
  return defineEventHandler({
    async handler(event) {
      const request = toWebRequest(event);
      const response = await federation.fetch(request, {
        contextData: await contextDataFactory(event, request),
      });
      // If the response is 404 Not Found, then we delegate the handling to
      // the next handler in the chain.  This is because the handler might
      // have an endpoint that Fedify does not have, and we want to give the
      // handler a chance to respond to the request:
      if (response.status === 404) return;
      // See also onBeforeResponse() above:
      if (response.status === 406) {
        event.context["__fedify_response__"] = response;
        return;
      }
      await event.respondWith(response);
    },
  });
}

/**
 * An error handler that responds with a 406 Not Acceptable if Fedify
 * responded with a 406 Not Acceptable and the actual handler responded with
 * a 404 Not Found.
 * @param error The error that occurred.
 * @param event The event that triggered the handler.
 */
export async function onError(
  error: H3Error<unknown>,
  event: H3Event<EventHandlerResponse>,
): Promise<void> {
  // If Fedify responded with a 406 Not Acceptable and later on the actual
  // handler responded with a 404 Not Found, then we consider it failed
  // to negotiate a response.  For example, if Fedify has an endpoint /foo
  // that supports only application/activity+json and the handler has no
  // endpoint /foo at all, then when a client requests /foo with
  // Accept: text/html, it should respond with 406 Not Acceptable:
  if (
    "__fedify_response__" in event.context &&
    event.context["__fedify_response__"].status === 406 &&
    error.statusCode === 404
  ) {
    await event.respondWith(event.context["__fedify_response__"]);
  }
}
