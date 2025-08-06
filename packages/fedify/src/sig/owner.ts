import { trace, type TracerProvider } from "@opentelemetry/api";
import {
  type DocumentLoader,
  getDocumentLoader,
} from "../runtime/docloader.ts";
import { type Actor, isActor } from "../vocab/actor.ts";
import {
  type Activity,
  CryptographicKey,
  Object as ASObject,
} from "../vocab/vocab.ts";
export { exportJwk, generateCryptoKeyPair, importJwk } from "./key.ts";

/**
 * Options for {@link doesActorOwnKey}.
 * @since 0.8.0
 */
export interface DoesActorOwnKeyOptions {
  /**
   * The document loader to use for fetching the actor.
   */
  documentLoader?: DocumentLoader;

  /**
   * The context loader to use for JSON-LD context retrieval.
   */
  contextLoader?: DocumentLoader;

  /**
   * The OpenTelemetry tracer provider to use for tracing.  If omitted,
   * the global tracer provider is used.
   * @since 1.3.0
   */
  tracerProvider?: TracerProvider;
}

/**
 * Checks if the actor of the given activity owns the specified key.
 * @param activity The activity to check.
 * @param key The public key to check.
 * @param options Options for checking the key ownership.
 * @returns Whether the actor is the owner of the key.
 */
export async function doesActorOwnKey(
  activity: Activity,
  key: CryptographicKey,
  options: DoesActorOwnKeyOptions,
): Promise<boolean> {
  if (key.ownerId != null) {
    return key.ownerId.href === activity.actorId?.href;
  }
  const actor = await activity.getActor(options);
  if (actor == null || !isActor(actor)) return false;
  for (const publicKeyId of actor.publicKeyIds) {
    if (key.id != null && publicKeyId.href === key.id.href) return true;
  }
  return false;
}

/**
 * Options for {@link getKeyOwner}.
 * @since 0.8.0
 */
export interface GetKeyOwnerOptions {
  /**
   * The document loader to use for fetching the key and its owner.
   */
  documentLoader?: DocumentLoader;

  /**
   * The context loader to use for JSON-LD context retrieval.
   */
  contextLoader?: DocumentLoader;

  /**
   * The OpenTelemetry tracer provider to use for tracing.  If omitted,
   * the global tracer provider is used.
   * @since 1.3.0
   */
  tracerProvider?: TracerProvider;
}

/**
 * Gets the actor that owns the specified key.  Returns `null` if the key has no
 * known owner.
 *
 * @param keyId The ID of the key to check, or the key itself.
 * @param options Options for getting the key owner.
 * @returns The actor that owns the key, or `null` if the key has no known
 *          owner.
 * @since 0.7.0
 */
export async function getKeyOwner(
  keyId: URL | CryptographicKey,
  options: GetKeyOwnerOptions,
): Promise<Actor | null> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const documentLoader = options.documentLoader ?? getDocumentLoader();
  const contextLoader = options.contextLoader ?? getDocumentLoader();
  let object: ASObject | CryptographicKey;
  if (keyId instanceof CryptographicKey) {
    object = keyId;
    if (object.id == null) return null;
    keyId = object.id;
  } else {
    let keyDoc: unknown;
    try {
      const { document } = await documentLoader(keyId.href);
      keyDoc = document;
    } catch (_) {
      return null;
    }
    try {
      object = await ASObject.fromJsonLd(keyDoc, {
        documentLoader,
        contextLoader,
        tracerProvider,
      });
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      try {
        object = await CryptographicKey.fromJsonLd(keyDoc, {
          documentLoader,
          contextLoader,
          tracerProvider,
        });
      } catch (e) {
        if (e instanceof TypeError) return null;
        throw e;
      }
    }
  }
  let owner: Actor | null = null;
  if (object instanceof CryptographicKey) {
    if (object.ownerId == null) return null;
    owner = await object.getOwner({
      documentLoader,
      contextLoader,
      tracerProvider,
    });
  } else if (isActor(object)) {
    owner = object;
  } else {
    return null;
  }
  if (owner == null) return null;
  for (const kid of owner.publicKeyIds) {
    if (kid.href === keyId.href) return owner;
  }
  return null;
}
