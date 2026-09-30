import {
  type Actor,
  CryptographicKey,
  Object as ASObject,
} from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import type { TracerProvider } from "@opentelemetry/api";
import {
  getCanonicalPortableId,
  getRawCanonicalPortableId,
  isPortableActorDocument,
} from "./portable-key-id.ts";

/**
 * How long a key of an [FEP-ef61] portable actor is trusted after its actor's
 * signed document vouched for it, however long the proof of the document is
 * valid.  The actor can drop the key or the gateway from its document at any
 * time, so the key is looked up again at least this often.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @internal
 */
export const MAX_PORTABLE_KEY_TTL = Temporal.Duration.from({ hours: 1 });

/**
 * What the verified document of an [FEP-ef61] portable actor told about one
 * of its keys, i.e., a gateway key or a key of the actor itself.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @internal
 */
export interface KeyOwnerEvidence {
  /** The ID of the key, as it was when the key was resolved. */
  readonly keyId: string;
  /** The key's owner, as it was when the key was resolved. */
  readonly keyOwner: string;
  /** The key material that the actor's document vouched for. */
  readonly publicKey: CryptoKey;
  /** The canonical portable ID of the actor. */
  readonly ownerId: string;
  /**
   * The expanded root node of the actor's document whose proof was verified.
   */
  readonly document: Record<string, unknown>;
  /** When the evidence must not be used anymore. */
  readonly expires: Temporal.Instant;
}

// Evidence of keys that were resolved, but that have not verified any
// signature yet:
const candidates = new WeakMap<CryptographicKey, KeyOwnerEvidence>();

// Evidence of keys that HTTP Signature verification returned.  Keyed by
// the key objects themselves, so that no other object, not even a clone,
// is trusted, however alike it looks:
const verified = new WeakMap<CryptographicKey, KeyOwnerEvidence>();

/**
 * Attaches to a key that was just resolved the evidence of the portable actor
 * that owns it.  The evidence is not used until the key verifies
 * a signature; see {@link promoteKeyOwnerEvidence}.
 *
 * Nothing is attached unless the document, the key's owner, and the actor
 * the key ID belongs to agree on the actor's canonical portable ID.
 * @param key The key, whose owner the document vouched for.
 * @param document The expanded root node of the actor's verified document.
 * @param expires When the evidence must not be used anymore.
 * @returns Whether the evidence was attached.
 * @internal
 */
export function attachKeyOwnerEvidence(
  key: CryptographicKey,
  document: unknown,
  expires: Temporal.Instant,
): boolean {
  if (
    !(key instanceof CryptographicKey) || key.id == null ||
    key.ownerId == null || key.publicKey == null ||
    document == null || typeof document !== "object" ||
    Array.isArray(document)
  ) {
    return false;
  }
  const rawId = (document as Record<string, unknown>)["@id"];
  if (typeof rawId !== "string") return false;
  const keyBase = new URL(key.id.href);
  keyBase.hash = "";
  const ownerId = getCanonicalPortableId(key.ownerId);
  if (
    ownerId == null ||
    getRawCanonicalPortableId(rawId) !== ownerId ||
    getCanonicalPortableId(keyBase) !== ownerId
  ) {
    return false;
  }
  candidates.set(key, {
    keyId: key.id.href,
    keyOwner: key.ownerId.href,
    publicKey: key.publicKey,
    ownerId,
    // The caller may keep the document, so it is copied:
    document: structuredClone(document as Record<string, unknown>),
    expires,
  });
  return true;
}

/**
 * Makes the evidence attached to a key usable, as the key has just verified
 * an HTTP Signature.  Nothing happens if the key has no evidence.
 * @param key The key that verified a signature.
 * @internal
 */
export function promoteKeyOwnerEvidence(key: CryptographicKey): void {
  const evidence = candidates.get(key);
  if (evidence == null) return;
  candidates.delete(key);
  verified.set(key, evidence);
}

/**
 * Gets the evidence of the portable actor that owns a key HTTP Signature
 * verification returned.
 * @param key The key.
 * @param now The current time.
 * @returns The evidence, or `undefined` if the key was not returned by HTTP
 *          Signature verification, if it has no evidence, if the evidence
 *          expired, or if the key has been changed since.
 * @internal
 */
export function getVerifiedKeyOwnerEvidence(
  key: CryptographicKey,
  now: Temporal.Instant = Temporal.Now.instant(),
): KeyOwnerEvidence | undefined {
  const evidence = verified.get(key);
  if (evidence == null) return undefined;
  if (Temporal.Instant.compare(now, evidence.expires) >= 0) {
    verified.delete(key);
    return undefined;
  }
  // The URLs a key holds are mutable, and so is anything shared with its
  // clones, so the key has to be the one the evidence was taken from:
  if (
    key.id?.href !== evidence.keyId ||
    key.ownerId?.href !== evidence.keyOwner ||
    key.publicKey !== evidence.publicKey
  ) {
    return undefined;
  }
  return evidence;
}

/**
 * Options for {@link parseKeyOwnerEvidence}.
 * @internal
 */
export interface ParseKeyOwnerEvidenceOptions {
  readonly contextLoader?: DocumentLoader;
  readonly tracerProvider?: TracerProvider;
}

/**
 * Parses the actor from the evidence, i.e., from the expansion of its
 * document whose proof was verified.  Every call returns a new object.
 * @param evidence The evidence.
 * @param options Options for parsing the document.
 * @returns The actor, or `null` if the document is not the actor that
 *          the evidence is about, or the evidence expired meanwhile.
 * @internal
 */
export async function parseKeyOwnerEvidence(
  evidence: KeyOwnerEvidence,
  options: ParseKeyOwnerEvidenceOptions = {},
): Promise<Actor | null> {
  // Only what the verified document embeds is covered by its proof:
  const refuse: DocumentLoader = (url) =>
    Promise.reject(new Error(`Refusing to fetch ${url}.`));
  let actor: unknown;
  try {
    actor = await ASObject.fromJsonLd(structuredClone(evidence.document), {
      documentLoader: refuse,
      contextLoader: options.contextLoader,
      tracerProvider: options.tracerProvider,
    });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return null;
  }
  if (
    !isPortableActorDocument(actor) ||
    getCanonicalPortableId(actor.id!) !== evidence.ownerId ||
    Temporal.Instant.compare(Temporal.Now.instant(), evidence.expires) >= 0
  ) {
    return null;
  }
  return actor;
}
