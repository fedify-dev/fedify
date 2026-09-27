import {
  canonicalizePortableUri,
  formatIri,
  fromCompatibleEf61Id,
  getFe34Origin,
  parseIri,
} from "@fedify/vocab-runtime";
import type { PortableRequest } from "./context.ts";

/**
 * The media type that FEP-ef61 gateways must use for portable objects.
 */
export const PORTABLE_OBJECT_CONTENT_TYPE =
  'application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

const GATEWAY_OBJECT_PATH_PATTERN = /^\/\.well-known\/apgateway\/did(?::|%3A)/i;
const BARE_DID_PATTERN = /^did:[a-z0-9]+:[^/?#]+$/i;

/**
 * The result of {@link parsePortableGatewayRequest}.
 */
export type PortableGatewayRequest =
  | {
    readonly type: "object";
    /** The request information exposed to object dispatchers. */
    readonly portableRequest: PortableRequest;
    /** The canonical form of the requested portable ID. */
    readonly canonicalId: string;
    /** The object path to route, e.g., `/notes/123`. */
    readonly path: `/${string}`;
  }
  | {
    readonly type: "malformed";
    readonly error: TypeError;
  };

/**
 * Recognizes an FEP-ef61 gateway request for a portable object, e.g.,
 * `GET /.well-known/apgateway/did:key:z6Mk.../notes/123`.
 *
 * The query is not part of the portable ID, so it is ignored here.  It is not
 * removed from the request itself, which HTTP Signatures may cover.
 *
 * @param url The request URL.
 * @returns The parsed request, or `null` if the URL is not a gateway request
 *          for a portable object, e.g., the gateway discovery endpoint or
 *          a hashlink media URL.
 */
export function parsePortableGatewayRequest(
  url: URL,
): PortableGatewayRequest | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!GATEWAY_OBJECT_PATH_PATTERN.test(url.pathname)) return null;
  let id: URL | null;
  let canonicalId: string;
  try {
    id = fromCompatibleEf61Id(url.origin + url.pathname);
    if (id == null) return null;
    canonicalId = canonicalizePortableUri(formatIri(id));
  } catch (error) {
    if (error instanceof TypeError) return { type: "malformed", error };
    throw error;
  }
  const authority = getFe34Origin(id);
  const href = id.href;
  const portableRequest: PortableRequest = Object.freeze({
    authority,
    get id() {
      return new URL(href);
    },
  });
  return {
    type: "object",
    portableRequest,
    canonicalId,
    path: id.pathname as `/${string}`,
  };
}

/**
 * Builds a portable ID from a DID authority and an object path.
 * @param authority The bare DID, e.g., `did:key:z6Mk...`.
 * @param path The object path, e.g., `/notes/123`.
 * @returns The portable ID.
 * @throws {TypeError} If the authority is not a bare DID.
 */
export function buildPortableUri(authority: unknown, path: string): URL {
  if (typeof authority !== "string" || !BARE_DID_PATTERN.test(authority)) {
    throw new TypeError(
      "The authority of a portable ID must be a DID without a path, query, " +
        "or fragment.",
    );
  }
  // Validates the DID syntax:
  getFe34Origin(authority);
  return parseIri(`ap+ef61://${authority}${path}`);
}
