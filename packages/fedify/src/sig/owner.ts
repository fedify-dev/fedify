import {
  type Activity,
  type Actor,
  CryptographicKey,
  isActor,
  Object as ASObject,
} from "@fedify/vocab";
import { type DocumentLoader, getDocumentLoader } from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import {
  SpanKind,
  SpanStatusCode,
  trace,
  type TracerProvider,
} from "@opentelemetry/api";
import metadata from "../../deno.json" with { type: "json" };
import { exportJwk, fetchActorDocument, verifyKeyOwnership } from "./key.ts";
export { exportJwk, generateCryptoKeyPair, importJwk } from "./key.ts";

const logger = getLogger(["fedify", "sig", "owner"]);

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
 *
 * Ownership is never taken from what the activity or the key say about
 * themselves, as both are written by whoever sent the activity.  It is
 * established from a document that the owner itself serves: either the key's
 * claimed owner links back to the key, or the actor the activity claims lists
 * the key as its own.
 *
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
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  return await tracer.startActiveSpan(
    "activitypub.verify_key_ownership",
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "activitypub.actor.id": activity.actorId?.href ?? "",
        "activitypub.key.id": key.id?.href ?? "",
      },
    },
    async (span) => {
      try {
        const actorId = activity.actorId;
        if (actorId == null) {
          span.setAttribute("activitypub.key_ownership.verified", false);
          span.setAttribute("activitypub.key_ownership.method", "none");
          return false;
        }
        // The `owner` a key declares about itself is written by the host that
        // served the key, so comparing it to the activity's actor compares
        // two values the sender controls.  Resolve the claimed owner and let
        // its own document confirm the key.  See GHSA-q9f8-5hc7-898f.
        if (key.ownerId != null) {
          const owner = await verifyKeyOwnership(key, options);
          if (owner?.id != null && owner.id.href === actorId.href) {
            span.setAttribute("activitypub.key_ownership.verified", true);
            span.setAttribute(
              "activitypub.key_ownership.method",
              "key_owner",
            );
            return true;
          }
        }
        // A key that claims no owner—or whose claim its owner did not
        // confirm—can still be authenticated from the other direction, by
        // the claimed actor listing the key among its own.
        // Deliberately not activity.getActor(): an actor embedded in the
        // activity is written by whoever sent it, so the `publicKey` list
        // inside it authenticates nothing.
        const actor = await fetchActorDocument(actorId, options);
        if (actor != null && await doesActorListKey(actor, key, options)) {
          span.setAttribute("activitypub.key_ownership.verified", true);
          span.setAttribute(
            "activitypub.key_ownership.method",
            "actor_fetch",
          );
          return true;
        }
        logger.debug(
          "The actor {actorId} does not own key {keyId}: neither the owner " +
            "the key claims nor the actor's own document links the two to " +
            "each other.",
          { actorId: actorId.href, keyId: key.id?.href },
        );
        span.setAttribute("activitypub.key_ownership.verified", false);
        span.setAttribute("activitypub.key_ownership.method", "actor_fetch");
        return false;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Determines whether the given actor's own document lists the given key among
 * its public keys.
 *
 * Keys are matched by id, which is what an actor document links to.  A key
 * document may leave its id implicit, though, and then there is no id for the
 * actor to link to; the key material itself is the only thing the two can
 * have in common, so that is what gets compared.
 */
async function doesActorListKey(
  actor: Actor,
  key: CryptographicKey,
  options: DoesActorOwnKeyOptions,
): Promise<boolean> {
  if (key.id != null) {
    for (const publicKeyId of actor.publicKeyIds) {
      if (publicKeyId.href === key.id.href) return true;
    }
    return false;
  }
  if (key.publicKey == null) return false;
  const publicKeys = actor.getPublicKeys({
    ...options,
    // A malformed key among the actor's own is not this decision's business.
    suppressError: true,
  });
  for await (const publicKey of publicKeys) {
    if (publicKey.publicKey == null) continue;
    if (await isSamePublicKey(publicKey.publicKey, key.publicKey)) return true;
  }
  return false;
}

/**
 * Compares two public keys by their key material, ignoring the metadata that
 * surrounds it.
 */
async function isSamePublicKey(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  const [x, y] = await Promise.all([exportJwk(a), exportJwk(b)]);
  return x.kty === y.kty && x.crv === y.crv && x.n === y.n && x.e === y.e &&
    x.x === y.x && x.y === y.y;
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
 * The owner is only returned when the key and the owner link to each other:
 * a document that merely claims to own a key is not enough, as the claim and
 * the key can come from the same host.
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
  const fetchOptions = { documentLoader, contextLoader, tracerProvider };
  if (keyId instanceof CryptographicKey) {
    return await verifyKeyOwnership(keyId, fetchOptions);
  }
  let keyDoc: unknown;
  let documentUrl: URL = keyId;
  try {
    const remoteDocument = await documentLoader(keyId.href);
    keyDoc = remoteDocument.document;
    documentUrl = new URL(remoteDocument.documentUrl ?? "", keyId);
  } catch (_) {
    return null;
  }
  let object: ASObject | CryptographicKey;
  try {
    object = await ASObject.fromJsonLd(keyDoc, {
      ...fetchOptions,
      baseUrl: documentUrl,
    });
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    try {
      object = await CryptographicKey.fromJsonLd(keyDoc, fetchOptions);
    } catch (e) {
      if (e instanceof TypeError) return null;
      throw e;
    }
  }
  if (object instanceof CryptographicKey) {
    // A key document that claims an id other than the URL it was served from
    // is describing somebody else's key; its `owner` claim is not about this
    // key at all.
    if (object.id != null && object.id.href !== keyId.href) return null;
    return await verifyKeyOwnership(
      object.id == null ? object.clone({ id: keyId }) : object,
      fetchOptions,
    );
  }
  if (!isActor(object)) return null;
  // The key id dereferenced to the owner's own document, so this single fetch
  // already proves the link—as long as the host that served the document is
  // authoritative for the actor id it claims.
  if (object.id == null || object.id.origin !== documentUrl.origin) {
    logger.debug(
      "The document served at {documentUrl} claims to be the actor " +
        "{actorId}, which belongs to another origin; refusing to treat it " +
        "as the owner of key {keyId}.",
      {
        documentUrl: documentUrl.href,
        actorId: object.id?.href,
        keyId: keyId.href,
      },
    );
    return null;
  }
  for (const kid of object.publicKeyIds) {
    if (kid.href === keyId.href) return object;
  }
  return null;
}
