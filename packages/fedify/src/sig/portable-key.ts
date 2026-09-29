import {
  type Actor,
  CryptographicKey,
  Multikey,
  Object as ASObject,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  FetchError,
  formatIri,
  getDocumentLoader,
  isGatewayUrl,
  parseIri,
  type RemoteDocument,
  toCompatibleEf61Id,
} from "@fedify/vocab-runtime";
import { getPortableGatewayCandidates } from "@fedify/vocab-runtime/internal/portable-dereference";
import { getLogger } from "@logtape/logtape";
import type { MeterProvider, TracerProvider } from "@opentelemetry/api";
import type { KeyCache } from "./key.ts";
import {
  getCanonicalPortableId,
  getRawCanonicalPortableId,
  isPortableActorDocument,
  isPortableUri,
  isSamePublicKey,
} from "./portable-key-id.ts";
import { verifyPortableObjectProofWithRoot } from "./proof.ts";

const logger = getLogger(["fedify", "sig", "key"]);

const SEC = "https://w3id.org/security#";

/**
 * The result of resolving a gateway key of a portable actor.
 * @internal
 */
export type PortableGatewayKeyResolution =
  | {
    /**
     * The document at the key ID is not a portable actor, so the key is
     * resolved as usual.
     */
    readonly type: "legacy";
  }
  | {
    /** The document is a portable actor, but it does not vouch for the key. */
    readonly type: "rejected";
    readonly reason: string;
  }
  | {
    /** The portable actor's signed document vouches for the key. */
    readonly type: "verified";
    readonly actor: Actor;
    readonly key: CryptographicKey & { publicKey: CryptoKey };
    /**
     * When the proof of the actor's document expires, if it does.  The
     * document does not vouch for the key after that.
     */
    readonly expires?: Temporal.Instant;
  };

/**
 * Options for resolving a gateway key of a portable actor.
 * @internal
 */
export interface PortableGatewayKeyOptions {
  readonly documentLoader?: DocumentLoader;
  readonly contextLoader?: DocumentLoader;
  readonly keyCache?: KeyCache;
  readonly tracerProvider?: TracerProvider;
  readonly meterProvider?: MeterProvider;
}

/**
 * Verifies that the signed document of a portable actor vouches for
 * the gateway key with the given ID.
 *
 * A gateway key is accepted only if:
 *
 *  -  the document is an actor whose portable ID, i.e., its `ap:` ID or
 *     the canonical portable ID of its compatible identifier, is the one
 *     the key ID is the compatible identifier of;
 *  -  the document has a valid [FEP-8b32] Object Integrity Proof made by
 *     the DID of its ID, i.e., it satisfies the [FEP-ef61] proof policy;
 *  -  the document embeds a `Multikey` with that ID in its `assertionMethod`,
 *     whose `controller` is the actor, as [FEP-521a] requires, and a key
 *     embedded in its `publicKey` with the same ID agrees with it; or, if
 *     no `assertionMethod` entry has that ID, the document embeds
 *     a `CryptographicKey` with that ID in its `publicKey`, whose `owner` is
 *     the actor, as some publishers, e.g., tootik, list their RSA keys only
 *     there;
 *  -  no more than one entry of either property has that ID; and
 *  -  the key ID's origin is one of the actor's `gateways`.
 *
 * An entry has the key's ID if its ID is the key ID, or any compatible
 * identifier on the same gateway, or the `ap:` or `ap+ef61:` URI, with the
 * same canonical portable ID.  Some publishers, e.g., Mitra, list the keys
 * of portable actors under `ap:` URIs, but sign requests with compatible key
 * IDs on their own gateways.  IDs are compared as they are written in
 * the signed document, so an ID that URL parsing would turn into another,
 * e.g., by resolving dot segments, has no match.
 *
 * [FEP-8b32]: https://w3id.org/fep/8b32
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * [FEP-521a]: https://w3id.org/fep/521a
 *
 * @param document The raw JSON-LD document served at the key ID.
 * @param actor The parsed document, which must be a portable actor.
 * @param keyId The key ID, which must be a compatible key ID.
 * @param options Loaders and telemetry providers.
 * @returns The verification result, which is never `legacy`.
 * @internal
 */
export function verifyPortableGatewayKeyDocument(
  document: unknown,
  actor: Actor,
  keyId: URL,
  options: PortableGatewayKeyOptions = {},
): Promise<PortableGatewayKeyResolution> {
  return verifyPortableKeyDocument(document, actor, keyId, true, options);
}

/**
 * Verifies that the signed document of a portable actor vouches for the key
 * with the given ID, either a gateway key at a compatible key ID, or a key of
 * the actor itself at an `ap:` or `ap+ef61:` key ID.  See
 * {@link verifyPortableGatewayKeyDocument} for the rules; a key of the actor
 * itself names no gateway, so instead of the key ID's origin being one of
 * the actor's `gateways`, the actor only has to have a valid gateway, as
 * FEP-ef61 requires of every portable actor.
 */
async function verifyPortableKeyDocument(
  document: unknown,
  actor: Actor,
  keyId: URL,
  isGatewayKey: boolean,
  options: PortableGatewayKeyOptions,
): Promise<PortableGatewayKeyResolution> {
  const reject = (reason: string): PortableGatewayKeyResolution => {
    logger.debug(
      "Failed to verify key {keyId} of the portable actor {actorId}: " +
        "{reason}",
      { keyId: formatIri(keyId), actorId: actor.id?.href, reason },
    );
    return { type: "rejected", reason };
  };
  const keyBase = new URL(keyId.href);
  keyBase.hash = "";
  const claimedActorId = getCanonicalPortableId(keyBase);
  const claimedKeyId = getCanonicalPortableId(keyId);
  const actorId = actor.id == null ? null : getCanonicalPortableId(actor.id);
  if (claimedActorId == null || claimedKeyId == null || actorId == null) {
    return reject("The key ID or the actor ID is not a valid portable ID.");
  }
  if (claimedActorId !== actorId) {
    return reject(
      "The key ID is not a compatible identifier of the actor it " +
        "dereferences to.",
    );
  }
  let verification: Awaited<
    ReturnType<typeof verifyPortableObjectProofWithRoot>
  >;
  try {
    verification = await verifyPortableObjectProofWithRoot(document, {
      documentLoader: options.documentLoader,
      contextLoader: options.contextLoader,
      keyCache: options.keyCache,
      tracerProvider: options.tracerProvider,
      meterProvider: options.meterProvider,
    });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return reject(`The actor document is malformed: ${error.message}`);
  }
  const { result, root, expires } = verification;
  if (!result.verified) {
    return reject(
      "The actor document does not satisfy the FEP-ef61 proof policy: " +
        result.reason.type,
    );
  }
  if (root == null) return reject("The actor document could not be expanded.");
  // Only keys embedded in the signed document are covered by its proof;
  // a key referred to by URL would be whatever its host serves.
  const refuse: DocumentLoader = (url) =>
    Promise.reject(new Error(`Refusing to fetch ${url}.`));
  const parseEmbeddedPublicKey = async (
    node: Record<string, unknown>,
  ): Promise<(CryptographicKey & { publicKey: CryptoKey }) | null> => {
    if (isReference(node)) return null;
    let key: CryptographicKey;
    try {
      key = await CryptographicKey.fromJsonLd(node, {
        documentLoader: refuse,
        contextLoader: options.contextLoader,
        tracerProvider: options.tracerProvider,
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return null;
    }
    return key.publicKey == null
      ? null
      : key as CryptographicKey & { publicKey: CryptoKey };
  };
  // The given actor was parsed with its own load of the document's contexts,
  // which a remote context can make differ from the expansion the proof
  // policy just checked.  Take everything from that verified expansion
  // instead, so that the DID which signed the document is the one whose actor
  // gets the key:
  let verifiedActor: unknown;
  try {
    verifiedActor = await ASObject.fromJsonLd(root, {
      documentLoader: refuse,
      contextLoader: options.contextLoader,
      tracerProvider: options.tracerProvider,
    });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return reject("The verified actor document is malformed.");
  }
  // Parsing the ID into a URL may have resolved dot segments in its path,
  // so the ID as it is written in the signed document has to match as well:
  const rootId = root["@id"];
  if (
    !isPortableActorDocument(verifiedActor) ||
    getCanonicalPortableId(verifiedActor.id!) !== claimedActorId ||
    typeof rootId !== "string" ||
    getRawCanonicalPortableId(rootId) !== claimedActorId
  ) {
    return reject(
      "The key ID is not a compatible identifier of the actor whose " +
        "document is signed.",
    );
  }
  actor = verifiedActor;
  const findKeyNodes = (values: unknown) =>
    findNodes(values, claimedKeyId, isGatewayKey ? keyId.origin : null);
  const assertionNodes = findKeyNodes(root[`${SEC}assertionMethod`]);
  const publicKeyNodes = findKeyNodes(root[`${SEC}publicKey`]);
  if (assertionNodes.length > 1 || publicKeyNodes.length > 1) {
    return reject("The actor document has more than one key with the ID.");
  }
  let publicKey: CryptoKey;
  if (assertionNodes.length > 0) {
    if (isReference(assertionNodes[0])) {
      return reject(
        "The actor document does not embed the key in its assertionMethod.",
      );
    }
    let multikey: Multikey;
    try {
      multikey = await Multikey.fromJsonLd(assertionNodes[0], {
        documentLoader: refuse,
        contextLoader: options.contextLoader,
        tracerProvider: options.tracerProvider,
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return reject("The key in the assertionMethod is malformed.");
    }
    if (multikey.publicKey == null) {
      return reject("The key in the assertionMethod has no public key.");
    }
    if (
      multikey.controllerId == null ||
      getCanonicalPortableId(multikey.controllerId) !== actorId
    ) {
      return reject("The controller of the key is not the actor.");
    }
    publicKey = multikey.publicKey;
    // A bare reference in publicKey names the node embedded in
    // assertionMethod, so only an embedded entry can disagree with it:
    if (publicKeyNodes.length > 0 && !isReference(publicKeyNodes[0])) {
      const embedded = await parseEmbeddedPublicKey(publicKeyNodes[0]);
      if (
        embedded == null ||
        !await isSamePublicKey(embedded.publicKey, publicKey) ||
        embedded.ownerId != null &&
          getCanonicalPortableId(embedded.ownerId) !== actorId
      ) {
        return reject(
          "The key in the publicKey does not agree with the one in " +
            "the assertionMethod.",
        );
      }
    }
  } else {
    // FEP-ef61 asks publishers to put gateway keys in assertionMethod, but
    // some, e.g., tootik, list their RSA keys only in publicKey.  The DID's
    // proof covers the whole document, so an embedded publicKey entry that
    // names the actor as its owner is vouched for just as well:
    if (publicKeyNodes.length < 1) {
      return reject(
        "The actor document embeds the key in neither its assertionMethod " +
          "nor its publicKey.",
      );
    }
    const embedded = await parseEmbeddedPublicKey(publicKeyNodes[0]);
    if (embedded == null) {
      return reject("The key in the publicKey is not embedded or malformed.");
    }
    if (
      embedded.ownerId == null ||
      getCanonicalPortableId(embedded.ownerId) !== actorId
    ) {
      return reject("The owner of the key is not the actor.");
    }
    publicKey = embedded.publicKey;
  }
  if (isGatewayKey) {
    const listed = actor.gateways.some((gateway) =>
      isGatewayUrl(gateway) && gateway.origin === keyId.origin
    );
    if (!listed) {
      return reject(
        `The gateway ${keyId.origin} is not listed in the actor's gateways.`,
      );
    }
  } else if (!actor.gateways.some(isGatewayUrl)) {
    return reject("The actor has no valid gateways.");
  }
  const key = new CryptographicKey({
    id: keyId,
    owner: actor.id,
    publicKey,
  }) as CryptographicKey & { publicKey: CryptoKey };
  return {
    type: "verified",
    actor,
    key,
    ...(expires == null ? {} : { expires }),
  };
}

/**
 * Fetches the document at a compatible key ID, and resolves the key as
 * a gateway key if the document is a portable actor.
 *
 * @param keyId The key ID, which must be a compatible key ID.
 * @param options Loaders and telemetry providers.
 * @returns `legacy` if the document cannot be fetched or is not a portable
 *          actor, which leaves the key to the usual resolution; otherwise,
 *          the result of {@link verifyPortableGatewayKeyDocument}.
 * @internal
 */
export async function fetchPortableGatewayKey(
  keyId: URL,
  options: PortableGatewayKeyOptions = {},
): Promise<PortableGatewayKeyResolution> {
  const documentLoader = options.documentLoader ?? getDocumentLoader();
  const contextLoader = options.contextLoader ?? getDocumentLoader();
  let remoteDocument: RemoteDocument;
  try {
    remoteDocument = await documentLoader(keyId.href);
  } catch (error) {
    logger.debug("Failed to fetch key {keyId}: {error}", {
      keyId: keyId.href,
      error,
    });
    return { type: "legacy" };
  }
  let object: unknown;
  try {
    object = await ASObject.fromJsonLd(remoteDocument.document, {
      documentLoader,
      contextLoader,
      tracerProvider: options.tracerProvider,
    });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return { type: "legacy" };
  }
  if (!isPortableActorDocument(object)) return { type: "legacy" };
  return await verifyPortableGatewayKeyDocument(
    remoteDocument.document,
    object,
    keyId,
    { ...options, documentLoader, contextLoader },
  );
}

/**
 * The result of resolving a key of a portable actor at an `ap:` or
 * `ap+ef61:` key ID.
 * @internal
 */
export type PortableActorKeyResolution =
  | Exclude<PortableGatewayKeyResolution, { readonly type: "legacy" }>
  | {
    /**
     * Whether the actor's document vouches for the key could not be
     * determined, e.g., because no gateway could be reached.
     */
    readonly type: "unavailable";
    readonly error: unknown;
    /**
     * Whether the failure can be cached as a failure to fetch the key, i.e.,
     * every gateway failed to serve the actor's document at all.  A failure
     * that is not cacheable comes with an error that has no HTTP status,
     * since none of the statuses describes the lookup as a whole.
     */
    readonly cacheable: boolean;
  };

type PortableActorKeyAttempt =
  | { readonly type: "rejected"; readonly reason: string }
  | { readonly type: "retrievalFailed"; readonly error: unknown }
  | { readonly type: "indeterminate"; readonly error: unknown };

/**
 * Resolves a key of a portable actor at an `ap:` or `ap+ef61:` key ID, e.g.,
 * `ap://did:key:z6Mk…/actor#main-key`.  Such a key ID names no gateway, so
 * the actor's document, i.e., the key ID without its fragment, is fetched
 * through the gateways in its `@gateway` location hints, one after another,
 * until one of them serves a document that vouches for the key.  Without
 * location hints, the document loader is asked for the `ap:` URI itself,
 * which only a custom document loader can resolve.  The hints are chosen by
 * whoever made the signature, but that does not matter: only a document with
 * a valid proof by the DID of the key ID vouches for the key.
 *
 * The key is taken as a key of the actor itself, not of a gateway, so it is
 * accepted by the rules of {@link verifyPortableGatewayKeyDocument}, except
 * that it is listed under the `ap:` or `ap+ef61:` URI with the same canonical
 * ID as the key ID, and that the actor only has to have a valid gateway.
 * The key ID must have a fragment; a key served as a standalone document is
 * not supported.
 *
 * If no gateway serves a document that vouches for the key, the result is
 * `rejected` only if every gateway served a document that definitely does not
 * vouch for it.  If every gateway failed to serve a document at all, the
 * result is a cacheable `unavailable`, with the error of the first gateway if
 * every gateway responded with the same HTTP status, so that the status
 * describes the whole lookup.  Otherwise, e.g., if one gateway was
 * unreachable and another served an invalid document, nothing tells what the
 * unreachable gateway would have served, so the result is an `unavailable`
 * that is not cacheable.
 *
 * @param keyId The key ID, which must be an `ap:` or `ap+ef61:` URI.
 * @param options Loaders and telemetry providers.
 * @returns The resolution, which is never `legacy`.
 * @internal
 */
export async function resolvePortableActorKey(
  keyId: URL,
  options: PortableGatewayKeyOptions = {},
): Promise<PortableActorKeyResolution> {
  const documentLoader = options.documentLoader ?? getDocumentLoader();
  const contextLoader = options.contextLoader ?? getDocumentLoader();
  let formattedKeyId = keyId.href;
  const reject = (reason: string): PortableActorKeyResolution => {
    logger.debug(
      "Failed to verify key {keyId} of a portable actor: {reason}",
      { keyId: formattedKeyId, reason },
    );
    return { type: "rejected", reason };
  };
  if (!isPortableUri(keyId) || getCanonicalPortableId(keyId) == null) {
    return reject("The key ID is not a valid ap: or ap+ef61: URI.");
  }
  formattedKeyId = formatIri(keyId);
  if (keyId.hash === "" || keyId.hash === "#") {
    return reject(
      "The key ID has no fragment; only keys embedded in actor documents " +
        "are supported.",
    );
  }
  const actorUrl = new URL(keyId.href);
  actorUrl.hash = "";
  const requestUrls: string[] = [];
  for (const gateway of getPortableGatewayCandidates(actorUrl)) {
    try {
      requestUrls.push(toCompatibleEf61Id(actorUrl, gateway).href);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return reject(`The key ID cannot be fetched from gateways: ${error}`);
    }
  }
  // No gateway to ask; custom document loaders may still know how to
  // retrieve the ap: URI itself:
  if (requestUrls.length < 1) requestUrls.push(formatIri(actorUrl));
  const attempts: PortableActorKeyAttempt[] = [];
  for (const url of requestUrls) {
    let remoteDocument: RemoteDocument;
    try {
      remoteDocument = await documentLoader(url);
    } catch (error) {
      logger.debug(
        "Failed to fetch the actor of key {keyId} from {url}: {error}",
        { keyId: formattedKeyId, url, error },
      );
      attempts.push({ type: "retrievalFailed", error });
      continue;
    }
    let resolution: PortableGatewayKeyResolution;
    try {
      const object = await ASObject.fromJsonLd(remoteDocument.document, {
        documentLoader,
        contextLoader,
        tracerProvider: options.tracerProvider,
      });
      resolution = isPortableActorDocument(object)
        ? await verifyPortableKeyDocument(
          remoteDocument.document,
          object,
          keyId,
          false,
          { ...options, documentLoader, contextLoader },
        )
        : {
          type: "rejected",
          reason: "The document is not a portable actor.",
        };
    } catch (error) {
      if (error instanceof TypeError) {
        resolution = {
          type: "rejected",
          reason: `The document is malformed: ${error.message}`,
        };
      } else {
        logger.debug(
          "Failed to process the actor of key {keyId} served from {url}: " +
            "{error}",
          { keyId: formattedKeyId, url, error },
        );
        attempts.push({ type: "indeterminate", error });
        continue;
      }
    }
    if (resolution.type === "verified") return resolution;
    const reason = resolution.type === "rejected"
      ? resolution.reason
      : "The document is not a portable actor.";
    logger.debug(
      "The actor document served from {url} does not vouch for key {keyId}: " +
        "{reason}",
      { keyId: formattedKeyId, url, reason },
    );
    attempts.push({ type: "rejected", reason });
  }
  const rejections = attempts.flatMap((a) =>
    a.type === "rejected" ? [a.reason] : []
  );
  if (rejections.length === attempts.length) {
    return reject(rejections.join(" "));
  }
  const errors = attempts.flatMap((a) =>
    a.type === "rejected" ? [] : [a.error]
  );
  const aggregate = errors.length === 1 ? errors[0] : new AggregateError(
    errors,
    `Failed to fetch the actor of key ${formattedKeyId} from any of its ` +
      `gateways: ${requestUrls.join(", ")}`,
  );
  if (attempts.every((a) => a.type === "retrievalFailed")) {
    const statuses = errors.map((error) =>
      error instanceof FetchError ? error.response?.status : undefined
    );
    const homogeneous = statuses[0] != null &&
      statuses.every((status) => status === statuses[0]);
    return {
      type: "unavailable",
      error: homogeneous ? errors[0] : aggregate,
      cacheable: true,
    };
  }
  return {
    type: "unavailable",
    error: new Error(
      `Could not determine whether the actor of key ${formattedKeyId} ` +
        "vouches for it.",
      { cause: aggregate },
    ),
    cacheable: false,
  };
}

/**
 * Finds the nodes that stand for the key with the given canonical portable
 * ID.  A node whose ID is an `ap:` or `ap+ef61:` URI stands for the key
 * itself, e.g., Mitra lists the keys of portable actors that way while
 * signing requests with compatible key IDs.  A node whose ID is a compatible
 * identifier stands for a gateway's key, so it matches only a compatible key
 * ID on the same gateway; a key ID that names no gateway never selects
 * a gateway's key, even with the same fragment.
 * @param values The expanded values of a key property.
 * @param canonicalKeyId The canonical portable ID of the key ID.
 * @param gateway The origin of the gateway whose key the key ID names, or
 *                `null` if the key ID names no gateway.
 */
function findNodes(
  values: unknown,
  canonicalKeyId: string,
  gateway: string | null,
): Record<string, unknown>[] {
  if (!Array.isArray(values)) return [];
  const nodes: Record<string, unknown>[] = [];
  for (const value of values) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const node = value as Record<string, unknown>;
    const nodeId = node["@id"];
    if (typeof nodeId !== "string") continue;
    if (getRawCanonicalPortableId(nodeId) !== canonicalKeyId) continue;
    const parsed = parseIri(nodeId);
    if (isPortableUri(parsed) || parsed.origin === gateway) nodes.push(node);
  }
  return nodes;
}

/** A node with nothing but an `@id` is a reference, not an embedded key. */
function isReference(node: Record<string, unknown>): boolean {
  return Object.keys(node).every((key) => key === "@id");
}
