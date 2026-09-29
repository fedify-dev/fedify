import { type Activity, type Actor, isActor } from "@fedify/vocab";
import {
  canonicalizePortableUri,
  formatIri,
  fromCompatibleEf61Id,
  getFe34Origin,
  toCompatibleEf61Id,
} from "@fedify/vocab-runtime";
import { isCompatibleEf61Iri } from "@fedify/vocab-runtime/internal/portable-dereference";

const COMPATIBLE_KEY_ID_PATH_PATTERN =
  /^\/\.well-known\/apgateway\/did(?::|%3A)/i;

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
