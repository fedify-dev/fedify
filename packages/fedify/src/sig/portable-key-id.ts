import { type Activity, type Actor, isActor } from "@fedify/vocab";
import {
  canonicalizePortableUri,
  formatIri,
  fromCompatibleEf61Id,
  toCompatibleEf61Id,
} from "@fedify/vocab-runtime";

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
 * Checks whether an activity is performed by an FEP-ef61 portable actor,
 * i.e., any of its actors has an `ap:` or `ap+ef61:` ID.
 * @internal
 */
export function hasPortableActor(activity: Activity): boolean {
  return activity.actorIds.some(isPortableUri);
}

/**
 * Checks whether a key ID looks like an [FEP-ef61] compatible identifier,
 * i.e., an HTTP(S) URL under a gateway's `/.well-known/apgateway/did:` path.
 * Such a key ID names a key that a gateway holds for a portable actor, so it
 * is resolved only as a gateway key, and never cached in a key cache.
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
 * Tells whether a parsed document at a compatible key ID is a portable actor,
 * which makes the key a gateway key that only
 * {@link verifyPortableGatewayKeyDocument} can vouch for.
 * @internal
 */
export function isPortableActorDocument(object: unknown): object is Actor {
  return isActor(object) && object.id != null && isPortableUri(object.id);
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
