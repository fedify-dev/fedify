/**
 * Fedify with Next.js
 * ===================
 *
 * This module provides a [Next.js] middleware to integrate with the Fedify.
 *
 * [Next.js]: https://nextjs.org/
 *
 * @module
 * @since 1.9.0
 */
import type { Federation, FederationFetchOptions } from "@fedify/fedify";
import { NextResponse } from "next/server";

interface ContextDataFactory<TContextData> {
  (request: Request):
    | TContextData
    | Promise<TContextData>;
}
type ErrorHandlers = Omit<FederationFetchOptions<unknown>, "contextData">;

/**
 * Wrapper function for Next.js middleware to integrate with the
 * {@link Federation} object.
 *
 * @template TContextData A type of the context data for the
 *                         {@link Federation} object.
 * @param federation A {@link Federation} object to integrate with Next.js.
 * @param contextDataFactory A function to create a context data for the
 *                         {@link Federation} object.
 * @param errorHandlers A set of error handlers to handle errors during
 *                      the federation fetch.
 * @returns A Next.js middleware function to integrate with the
 *          {@link Federation} object.
 *
 * @example
 * ```ts ignore
 * import { fedifyWith } from "@fedify/next";
 * import { federation } from "./federation";
 *
 * export default fedifyWith(federation)(
 *   function (request: Request) {
 *     // You can add custom logic here for other requests
 *     // except federation requests.  If there is no custom logic,
 *     // you can omit this function.
 *   }
 * )
 *
 * // This config makes middleware process only requests with the
 * // "Accept" header matching the federation accept regex.
 * // More details: https://nextjs.org/docs/app/api-reference/file-conventions/middleware#config-object-optional.
 * export const config = {
 *   runtime: "nodejs",
 *   matcher: [{
 *     source: "/:path*",
 *     has: [
 *       {
 *         type: "header",
 *         key: "Accept",
 *         value: ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
 *       },
 *     ],
 *   }],
 * };
 * ```
 */
export const fedifyWith = <TContextData>(
  federation: Federation<TContextData>,
  contextDataFactory?: ContextDataFactory<TContextData>,
  errorHandlers?: Partial<ErrorHandlers>,
) =>
(
  middleware: (request: Request) => unknown =
    ((_: Request) => NextResponse.next()),
): (request: Request) => unknown =>
async (request: Request) => {
  if (hasFederationAcceptHeader(request)) {
    return await integrateFederation(
      federation,
      contextDataFactory,
      errorHandlers,
    )(request);
  }
  return await middleware(request);
};

/**
 * Check if the request has the "Accept" header matching the federation
 * accept regex.
 *
 * @param request The request to check.
 * @returns `true` if the request has the "Accept" header matching
 *                    the federation accept regex, `false` otherwise.
 */
export const hasFederationAcceptHeader = (request: Request): boolean => {
  const acceptHeader = request.headers.get("Accept");
  // Check if the Accept header matches the federation accept regex.
  // If the header is not present, return false.
  return acceptHeader ? FEDERATION_ACCEPT_REGEX.test(acceptHeader) : false;
};
const FEDERATION_ACCEPT_REGEX =
  /.*application\/((jrd|activity|ld)\+json|xrd\+xml).*/;

/**
 * Create a Next.js handler to integrate with the {@link Federation} object.
 *
 * @template TContextData A type of the context data for the
 *                        {@link Federation} object.
 * @param federation A {@link Federation} object to integrate with Next.js.
 * @param contextDataFactory A function to create a context data for the
 *                           {@link Federation} object.
 * @param errorHandlers A set of error handlers to handle errors during
 *                      the federation fetch.
 * @returns A Next.js handler.
 */
export function integrateFederation<TContextData>(
  federation: Federation<TContextData>,
  contextDataFactory: ContextDataFactory<TContextData> = () =>
    undefined as TContextData,
  errorHandlers?: Partial<ErrorHandlers>,
) {
  return async (request: Request) =>
    await federation.fetch(
      request,
      {
        contextData: await contextDataFactory(request),
        onNotFound,
        onNotAcceptable,
        ...errorHandlers,
      },
    );
}
const onNotFound = () => new Response("Not found", { status: 404 });
const onNotAcceptable = () =>
  new Response("Not acceptable", {
    status: 406,
    headers: { "Content-Type": "text/plain", Vary: "Accept" },
  });
