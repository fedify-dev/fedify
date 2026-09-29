import { type Activity, type Actor, isActor } from "@fedify/vocab";
import {
  canonicalizePortableUri,
  formatIri,
  fromCompatibleEf61Id,
  getFe34Origin,
  parseIri,
  toCompatibleEf61Id,
} from "@fedify/vocab-runtime";
import { isCompatibleEf61Iri } from "@fedify/vocab-runtime/internal/portable-dereference";

const COMPATIBLE_KEY_ID_PATH_PATTERN =
  /^\/\.well-known\/apgateway\/did(?::|%3A)/i;
const RAW_PORTABLE_URI_PATTERN = /^ap(?:\+ef61)?:\/\//i;
const RAW_COMPATIBLE_ID_PREFIX_PATTERN =
  /^https?:\/\/[^/?#]*\/\.well-known\/apgateway\/(?=did(?::|%3A))/i;

/**
 * Checks whether the URL is an `ap:` or `ap+ef61:` URI.
 * @internal
 */
export function isPortableUri(url: URL): boolean {
  return url.protocol === "ap:" || url.protocol === "ap+ef61:";
}

/**
 * Checks whether an ID identifies an [FEP-ef61] portable object, i.e., it is
 * an `ap:` or `ap+ef61:` URI, or looks like a compatible identifier.
 * A malformed compatible identifier counts too, so that it is rejected as
 * a portable object that no proof can match, rather than trusted by its web
 * origin.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @internal
 */
export function isPortableId(id: URL | string): boolean {
  if (typeof id === "string") {
    if (/^ap(?:\+ef61)?:\/\//i.test(id)) return true;
  } else if (isPortableUri(id)) return true;
  return isCompatibleEf61Iri(id);
}

/**
 * Gets the DID, i.e., the FEP-fe34 cryptographic origin, of an `ap:` or
 * `ap+ef61:` URI, a DID URL, or a compatible identifier.
 * @returns The DID, or `null` if the ID is none of them, or is malformed.
 * @internal
 */
export function getPortableDid(id: URL | string): string | null {
  try {
    const raw = typeof id === "string" ? id : id.href;
    if (/^(?:did:|ap(?:\+ef61)?:\/\/)/i.test(raw)) return getFe34Origin(id);
    const portable = fromCompatibleEf61Id(id);
    return portable == null ? null : getFe34Origin(portable);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

/**
 * Checks whether an activity is performed by an FEP-ef61 portable actor,
 * i.e., any of its actors has an `ap:` or `ap+ef61:` ID, or a compatible
 * identifier.
 * @internal
 */
export function hasPortableActor(activity: Activity): boolean {
  return activity.actorIds.some((id) => isPortableId(id));
}

/**
 * Checks whether a key ID looks like an [FEP-ef61] compatible identifier,
 * i.e., an HTTP(S) URL under a gateway's `/.well-known/apgateway/did:` path.
 * Such a key ID may name a key that a gateway holds for a portable actor,
 * which only HTTP Signatures accept, so what it resolves to is cached apart
 * for each purpose, never under the key ID itself.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @internal
 */
export function isCompatibleKeyId(keyId: URL): boolean {
  return (keyId.protocol === "http:" || keyId.protocol === "https:") &&
    COMPATIBLE_KEY_ID_PATH_PATTERN.test(keyId.pathname);
}

/**
 * Checks whether a key ID may name a key that is valid only for HTTP
 * Signatures: a gateway key at an [FEP-ef61] compatible identifier, or a key
 * of a portable actor at an `ap:` or `ap+ef61:` URI.  Neither ever makes or
 * verifies an Object Integrity Proof or a Linked Data Signature: a portable
 * object's proof is made by its DID, and a proof made with a gateway key
 * would claim that the gateway authored the object.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @internal
 */
export function isPortableKeyId(keyId: URL): boolean {
  return isPortableUri(keyId) || isCompatibleKeyId(keyId);
}

/**
 * Gets the canonical portable ID of an actor ID that is either an `ap:` or
 * `ap+ef61:` URI or a compatible identifier.
 * @returns The canonical portable ID, or `null` if the ID is neither, or is
 *          malformed.
 * @internal
 */
export function getCanonicalPortableId(id: URL): string | null {
  try {
    if (isPortableUri(id)) return canonicalizePortableUri(formatIri(id));
    const portable = fromCompatibleEf61Id(id);
    if (portable == null) return null;
    return canonicalizePortableUri(formatIri(portable));
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

/**
 * Gets the canonical portable ID of an `ap:` or `ap+ef61:` URI or
 * a compatible identifier as it is written, before any URL parsing.
 * Parsing an ID into a `URL` resolves dot segments in its path, which would
 * make it identify another portable object, e.g.,
 * `ap://did:key:z6Mk…/x/../actor` would become `ap://did:key:z6Mk…/actor`.
 * Such an ID has no canonical portable ID here.
 * @param raw The ID as it is written.
 * @returns The canonical portable ID, fragment included, or `null` if the ID
 *          is neither an `ap:` or `ap+ef61:` URI nor a compatible identifier,
 *          is malformed, or would identify another object once parsed.
 * @internal
 */
export function getRawCanonicalPortableId(raw: string): string | null {
  let canonical: string;
  let parsed: string | null;
  try {
    if (RAW_PORTABLE_URI_PATTERN.test(raw)) {
      canonical = canonicalizePortableUri(raw);
      parsed = canonicalizePortableUri(formatIri(parseIri(raw)));
    } else {
      const prefix = raw.match(RAW_COMPATIBLE_ID_PREFIX_PATTERN);
      if (prefix == null || !URL.canParse(raw)) return null;
      canonical = canonicalizePortableUri(
        "ap://" + raw.slice(prefix[0].length),
      );
      parsed = getCanonicalPortableId(new URL(raw));
    }
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
  return canonical === parsed ? canonical : null;
}

/**
 * Parses a key ID, e.g., the `keyId` of an HTTP Signature, into a `URL`.
 * An `ap:` or `ap+ef61:` key ID is parsed into the internal `URL` form of
 * portable URIs.  A portable or compatible key ID that is malformed, or
 * whose identity URL parsing would change, e.g., by resolving dot segments in
 * its path, is refused, so that it can never be taken for, or looked up in
 * the key cache as, the key of another object.
 * @param raw The key ID as it is written.
 * @returns The parsed key ID, or `null` if it is invalid.
 * @internal
 */
export function parseKeyIdString(raw: string): URL | null {
  if (RAW_PORTABLE_URI_PATTERN.test(raw)) {
    return getRawCanonicalPortableId(raw) == null ? null : parseIri(raw);
  }
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  // URL parsing strips leading and trailing spaces and control characters,
  // and removes tabs and newlines anywhere, so an ID that is portable only
  // once parsed is not written as one:
  if (isPortableUri(url)) return null;
  // Likewise, an ID that is a compatible identifier only once parsed is not
  // written as one, and one written as a compatible identifier has to stay
  // the same one, rather than, e.g., escaping the gateway path through dot
  // segments:
  if (!RAW_COMPATIBLE_ID_PREFIX_PATTERN.test(raw)) {
    return isCompatibleKeyId(url) ? null : url;
  }
  return getRawCanonicalPortableId(raw) == null ? null : url;
}

/**
 * Builds the base of the key IDs of a gateway's keys for a portable actor:
 * the actor's compatible identifier on the gateway.
 * @param actorId The portable actor's ID, either an `ap:` or `ap+ef61:` URI
 *                or a compatible identifier.  It must not have a fragment.
 * @param gateway The gateway's origin, e.g., `https://example.com`.
 * @returns The compatible identifier without query and fragment.
 * @throws {TypeError} If the actor ID is not a portable ID, or has
 *                     a fragment.
 * @internal
 */
export function getGatewayKeyBase(actorId: URL, gateway: string): URL {
  let portable: URL | null;
  if (isPortableUri(actorId)) portable = actorId;
  else {
    try {
      portable = fromCompatibleEf61Id(actorId);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      portable = null;
    }
  }
  if (portable == null) {
    throw new TypeError(
      `The portable actor ID ${actorId.href} must be an ap: or ap+ef61: URI, ` +
        "or an FEP-ef61 compatible identifier.",
    );
  }
  if (portable.hash !== "") {
    throw new TypeError(
      `The portable actor ID ${actorId.href} must not have a fragment.`,
    );
  }
  const base = toCompatibleEf61Id(portable, gateway);
  base.search = "";
  base.hash = "";
  return base;
}

/**
 * Tells whether a parsed document is a portable actor, i.e., an actor whose
 * ID is an `ap:` or `ap+ef61:` URI or a compatible identifier.  Such an actor
 * is never authenticated by the web origin that served it; at a compatible
 * key ID, it makes the key a gateway key that only
 * {@link verifyPortableGatewayKeyDocument} can vouch for.
 * @internal
 */
export function isPortableActorDocument(object: unknown): object is Actor {
  return isActor(object) && object.id != null && isPortableId(object.id);
}

/**
 * Compares two public keys by their key material.
 * @internal
 */
export async function isSamePublicKey(
  a: CryptoKey,
  b: CryptoKey,
): Promise<boolean> {
  if (a.algorithm.name !== b.algorithm.name) return false;
  const [x, y] = await Promise.all([
    crypto.subtle.exportKey("jwk", a),
    crypto.subtle.exportKey("jwk", b),
  ]);
  return x.kty === y.kty && x.crv === y.crv && x.n === y.n && x.e === y.e &&
    x.x === y.x && x.y === y.y;
}
