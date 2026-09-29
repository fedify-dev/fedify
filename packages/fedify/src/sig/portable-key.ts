import {
  type Actor,
  CryptographicKey,
  Multikey,
  Object as ASObject,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  getDocumentLoader,
  isGatewayUrl,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import type { MeterProvider, TracerProvider } from "@opentelemetry/api";
import type { KeyCache } from "./key.ts";
import {
  getCanonicalPortableId,
  isPortableActorDocument,
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
export async function verifyPortableGatewayKeyDocument(
  document: unknown,
  actor: Actor,
  keyId: URL,
  options: PortableGatewayKeyOptions = {},
): Promise<PortableGatewayKeyResolution> {
  const reject = (reason: string): PortableGatewayKeyResolution => {
    logger.debug(
      "Failed to verify gateway key {keyId} of the portable actor " +
        "{actorId}: {reason}",
      { keyId: keyId.href, actorId: actor.id?.href, reason },
    );
    return { type: "rejected", reason };
  };
  const keyBase = new URL(keyId.href);
  keyBase.hash = "";
  const claimedActorId = getCanonicalPortableId(keyBase);
  const actorId = actor.id == null ? null : getCanonicalPortableId(actor.id);
  if (claimedActorId == null || actorId == null) {
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
  if (
    !isPortableActorDocument(verifiedActor) ||
    getCanonicalPortableId(verifiedActor.id!) !== claimedActorId
  ) {
    return reject(
      "The key ID is not a compatible identifier of the actor whose " +
        "document is signed.",
    );
  }
  actor = verifiedActor;
  const assertionNodes = findNodes(root[`${SEC}assertionMethod`], keyId);
  const publicKeyNodes = findNodes(root[`${SEC}publicKey`], keyId);
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
  const listed = actor.gateways.some((gateway) =>
    isGatewayUrl(gateway) && gateway.origin === keyId.origin
  );
  if (!listed) {
    return reject(
      `The gateway ${keyId.origin} is not listed in the actor's gateways.`,
    );
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

function findNodes(values: unknown, id: URL): Record<string, unknown>[] {
  if (!Array.isArray(values)) return [];
  const nodes: Record<string, unknown>[] = [];
  for (const value of values) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const node = value as Record<string, unknown>;
    const nodeId = node["@id"];
    if (typeof nodeId !== "string" || !URL.canParse(nodeId)) continue;
    if (new URL(nodeId).href === id.href) nodes.push(node);
  }
  return nodes;
}

/** A node with nothing but an `@id` is a reference, not an embedded key. */
function isReference(node: Record<string, unknown>): boolean {
  return Object.keys(node).every((key) => key === "@id");
}
