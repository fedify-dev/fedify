import {
  canonicalizePortableUri,
  decodeMultibase,
  formatIri,
  fromCompatibleEf61Id,
  getFe34Origin,
  parseDigestMultibase,
  parseHashlink,
  parseIri,
} from "@fedify/vocab-runtime";
import type { HashlinkMediaRequest } from "./callback.ts";
import type { PortableRequest } from "./context.ts";

/**
 * The media type that FEP-ef61 gateways must use for portable objects.
 */
export const PORTABLE_OBJECT_CONTENT_TYPE =
  'application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

const GATEWAY_OBJECT_PATH_PATTERN = /^\/\.well-known\/apgateway\/did(?::|%3A)/i;
const BARE_DID_PATTERN = /^did:[a-z0-9]+:[^/?#]+$/i;
const DID_KEY_PREFIX = "did:key:";
const BASE58BTC_MULTIBASE_PATTERN = /^z[1-9A-HJ-NP-Za-km-z]+$/;
const GATEWAY_PATH_PREFIX = "/.well-known/apgateway/";
const HASHLINK_SCHEME_PATTERN = /^hl(?::|%3A)/i;

/**
 * The route template of hashlink media requests, used for metrics and traces.
 */
export const HASHLINK_MEDIA_ROUTE_TEMPLATE =
  "/.well-known/apgateway/hl:{digestMultibase}";

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
  try {
    // Rejects DIDs that the portable ID helpers would refuse to build IDs
    // with, as RequestContext uses this authority as their default:
    assertBase58BtcDidKey(authority);
  } catch (error) {
    if (error instanceof TypeError) return { type: "malformed", error };
    throw error;
  }
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
 * @throws {TypeError} If the authority is not a bare DID, or it is
 *                     a `did:key` DID that is not encoded in base58-btc.
 */
export function buildPortableUri(authority: unknown, path: string): URL {
  if (typeof authority !== "string" || !BARE_DID_PATTERN.test(authority)) {
    throw new TypeError(
      "The authority of a portable ID must be a DID without a path, query, " +
        "or fragment.",
    );
  }
  // Validates the DID syntax, and normalizes its scheme, method, and
  // percent-encoding:
  const did = getFe34Origin(authority);
  assertBase58BtcDidKey(did);
  return parseIri(`ap+ef61://${did}${path}`);
}

/**
 * Checks that a normalized DID, if it is a `did:key` DID, is encoded in
 * base58-btc, as FEP-ef61 requires so that the same key does not yield two
 * portable IDs.  This only checks the encoding, not whether the DID is
 * a valid key.
 * @param did The DID normalized by `getFe34Origin()`.
 * @throws {TypeError} If the DID is a `did:key` DID that is not encoded in
 *                     base58-btc.
 */
function assertBase58BtcDidKey(did: string): void {
  if (
    did.startsWith(DID_KEY_PREFIX) &&
    !BASE58BTC_MULTIBASE_PATTERN.test(did.slice(DID_KEY_PREFIX.length))
  ) {
    throw new TypeError(
      "The did:key authority of a portable ID must be encoded in base58-btc, " +
        "i.e., start with z.",
    );
  }
}

/**
 * The result of {@link parseHashlinkGatewayRequest}.
 */
export type HashlinkGatewayRequest =
  | {
    readonly type: "media";
    /** The request information passed to the hashlink media dispatcher. */
    readonly media: HashlinkMediaRequest;
  }
  | {
    readonly type: "malformed";
    readonly error: TypeError;
  };

/**
 * Recognizes an FEP-ef61 gateway request for a resource addressed by
 * a hashlink, e.g.,
 * `GET /.well-known/apgateway/hl:zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n`.
 *
 * The rest of the path, including any slashes, is taken as the hashlink, as
 * a digest in a multibase encoding like base64 may contain slashes.  The query
 * is not part of the hashlink, so it is ignored here.
 *
 * @param url The request URL.
 * @returns The parsed request, or `null` if the URL is not a gateway request
 *          for a hashlink, e.g., a request for a portable object.
 */
export function parseHashlinkGatewayRequest(
  url: URL,
): HashlinkGatewayRequest | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.pathname.startsWith(GATEWAY_PATH_PREFIX)) return null;
  const encoded = url.pathname.slice(GATEWAY_PATH_PREFIX.length);
  if (!HASHLINK_SCHEME_PATTERN.test(encoded)) return null;
  let digestMultibase: string;
  let digest: Uint8Array;
  let multihash: Uint8Array;
  try {
    let hashlink: string;
    try {
      hashlink = decodeURIComponent(encoded);
    } catch (error) {
      throw new TypeError("Invalid percent-encoding in the hashlink.", {
        cause: error,
      });
    }
    ({ digestMultibase } = parseHashlink(hashlink));
    ({ digest } = parseDigestMultibase(digestMultibase));
    multihash = decodeMultibase(digestMultibase);
  } catch (error) {
    if (error instanceof TypeError) return { type: "malformed", error };
    throw error;
  }
  const media: HashlinkMediaRequest = Object.freeze({
    hashlink: `hl:${digestMultibase}` as const,
    digestMultibase,
    algorithm: "sha2-256" as const,
    digest,
    multihash,
  });
  return { type: "media", media };
}
