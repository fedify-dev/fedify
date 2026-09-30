/**
 * Fedify with Next.js
 * ===================
 *
 * This module provides a [Next.js] middleware to integrate with the Fedify.
 * You can see the example in `examples/next-integration` of the [Fedify repository].
 *
 * [Next.js]: https://nextjs.org/
 * [Fedify repository]: https://github.com/fedify-dev/fedify/
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
 * // This config makes the middleware run only for requests that may be
 * // federation requests: requests whose "Accept" or "Content-Type" header
 * // has a federation media type, NodeInfo requests, and FEP-ef61 gateway
 * // requests such as hashlink media, which clients fetch with, e.g.,
 * // "Accept: image/*".  fedifyWith() then decides which of them Fedify
 * // handles.
 * // More details: https://nextjs.org/docs/app/api-reference/file-conventions/middleware#config-object-optional.
 * export const config = {
 *   runtime: "nodejs",
 *   matcher: [
 *     {
 *       source: "/:path*",
 *       has: [
 *         {
 *           type: "header",
 *           key: "Accept",
 *           value: ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
 *         },
 *       ],
 *     },
 *     {
 *       source: "/:path*",
 *       has: [
 *         {
 *           type: "header",
 *           key: "content-type",
 *           value: ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
 *         },
 *       ],
 *     },
 *     { source: "/.well-known/nodeinfo" },
 *     { source: "/.well-known/x-nodeinfo2" },
 *     { source: "/.well-known/apgateway/:path*" },
 *   ],
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
  if (isFederationRequest(request)) {
    return await integrateFederation(
      federation,
      contextDataFactory,
      errorHandlers,
    )(request);
  }
  return await middleware(request);
};

/**
 * Check if the request should be handled by the {@link Federation} object.
 * A request is considered a federation request if any of the following
 * conditions is met:
 *
 * - Its `Accept` or `Content-Type` header has an ActivityPub, JSON-LD, JRD,
 *   or XRD media type.
 * - It is a NodeInfo request (see {@link isNodeInfoRequest}).
 * - It is an FEP-ef61 hashlink media request
 *   (see {@link isHashlinkMediaRequest}).
 * @param request The request to check.
 * @returns `true` if the request is a federation request, `false` otherwise.
 */
export const isFederationRequest = (request: Request): boolean =>
  [
    hasFederationHeader("accept"),
    hasFederationHeader("content-type"),
    isNodeInfoRequest,
    isHashlinkMediaRequest,
  ].some((f) => f(request));

/**
 * Check if the request has the header matching the federation
 * accept regex.
 * @param key The header key to check.
 * @param request The request to check.
 * @returns `true` if the request has the header matching
 *                    the federation accept regex, `false` otherwise.
 */
export const hasFederationHeader =
  (key: string) => (request: Request): boolean => {
    const value = request.headers.get(key);
    return value ? FEDERATION_ACCEPT_REGEX.test(value) : false;
  };

export const isNodeInfoRequest = (request: Request): boolean => {
  const url = new URL(request.url);
  return NODEINFO_PATHS.some((path) => url.pathname.startsWith(path));
};

const NODEINFO_PATHS = [
  "/.well-known/nodeinfo",
  "/.well-known/x-nodeinfo2",
];

/**
 * Check if the request is an [FEP-ef61] gateway request for a resource
 * addressed by a hashlink, e.g.,
 * `GET /.well-known/apgateway/hl:zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n`.
 *
 * Such requests need not carry a federation media type in their `Accept`
 * header, as clients fetch media with, e.g., `Accept: image/*`, so they are
 * recognized by their path alone.  This only checks whether the path looks
 * like a hashlink request; it does not check whether the hashlink is valid
 * nor whether a hashlink media dispatcher is registered, which
 * {@link Federation.fetch} takes care of.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @param request The request to check.
 * @returns `true` if the request is a hashlink media request,
 *          `false` otherwise.
 * @since 2.4.0
 */
export const isHashlinkMediaRequest = (request: Request): boolean => {
  const { pathname } = new URL(request.url);
  return pathname.startsWith(GATEWAY_PATH_PREFIX) &&
    HASHLINK_SCHEME_PATTERN.test(pathname.slice(GATEWAY_PATH_PREFIX.length));
};

// These follow how Federation.fetch() recognizes hashlink media requests:
const GATEWAY_PATH_PREFIX = "/.well-known/apgateway/";
const HASHLINK_SCHEME_PATTERN = /^hl(?::|%3A)/i;

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
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> =>
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
