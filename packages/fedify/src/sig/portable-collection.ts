import {
  type Actor,
  CollectionPage,
  isActor,
  type Multikey,
  Object as ASObject,
} from "@fedify/vocab";
import {
  canonicalizePortableUri,
  type DocumentLoader,
  formatIri,
  fromCompatibleEf61Id,
  getDocumentLoader,
  getFe34Origin,
  parseIri,
  type PortableObjectReferrer,
  type PortableObjectVerifierOptions,
} from "@fedify/vocab-runtime";
import {
  dereferencePortableIri,
  getPortableGatewayCandidates,
} from "@fedify/vocab-runtime/internal/portable-dereference";
import { getLogger } from "@logtape/logtape";
import { trace } from "@opentelemetry/api";
import metadata from "../../deno.json" with { type: "json" };
import {
  verifyPortableObjectProof,
  type VerifyPortableObjectProofFailureReason,
  type VerifyPortableObjectProofOptions,
  verifyPortableObjectProofWithRoot,
} from "./proof.ts";

const logger = getLogger(["fedify", "sig", "proof"]);

const AS_NAMESPACE = "https://www.w3.org/ns/activitystreams#";
const AS_ATTRIBUTED_TO = `${AS_NAMESPACE}attributedTo`;
const AS_PART_OF = `${AS_NAMESPACE}partOf`;

/**
 * The properties through which a collection refers to its pages, and a page
 * to other pages of the same collection.
 */
const PAGING_PROPERTIES: ReadonlySet<string> = new Set(
  ["first", "last", "current", "next", "prev"].map((p) => AS_NAMESPACE + p),
);

/**
 * The properties through which an actor refers to its own collections.
 */
const ACTOR_COLLECTION_PROPERTIES: ReadonlySet<string> = new Set([
  "http://www.w3.org/ns/ldp#inbox",
  `${AS_NAMESPACE}outbox`,
  `${AS_NAMESPACE}followers`,
  `${AS_NAMESPACE}following`,
  `${AS_NAMESPACE}liked`,
]);

/**
 * Options for {@link verifyPortableObject}.
 *
 * Besides the options for {@link verifyPortableObjectProof}, it takes where
 * the document came from, which property accessors pass automatically when
 * `verifyPortableObject()` is used as their `verifyPortableObject` option.
 * @since 2.4.0
 */
export interface VerifyPortableObjectOptions
  extends
    VerifyPortableObjectProofOptions,
    Omit<
      PortableObjectVerifierOptions,
      "documentLoader" | "contextLoader" | "tracerProvider"
    > {
}

/**
 * The reason why {@link verifyPortableObject} did not accept a document.
 *
 * Besides the reasons of {@link verifyPortableObjectProof}, it describes why
 * an unsecured portable collection was not trusted.  The
 * `unsecuredCollection` reason itself never appears, since such collections
 * are judged by the gateway trust policy instead.
 * @since 2.4.0
 */
export type VerifyPortableObjectFailureReason =
  | Exclude<
    VerifyPortableObjectProofFailureReason,
    { readonly type: "unsecuredCollection" }
  >
  | {
    /**
     * The unsecured collection was not retrieved from a gateway, i.e., the
     * document's final URL is missing or is not a compatible identifier for
     * the same portable collection.
     */
    readonly type: "unknownCollectionSource";
    /** The final URL of the document, if known. */
    readonly documentUrl: URL | null;
  }
  | {
    /**
     * The actor that owns the unsecured collection cannot be determined
     * unambiguously.
     */
    readonly type: "unknownCollectionOwner";
  }
  | {
    /** The collection, its pages, or its referrer disagree on its owner. */
    readonly type: "conflictingCollectionOwners";
    /** The owner candidates that disagree. */
    readonly candidates: readonly URL[];
  }
  | {
    /**
     * A collection page does not belong to the collection it was reached
     * from: its `partOf` names another collection, or its cryptographic
     * origin differs.
     */
    readonly type: "collectionPageMismatch";
    /** The page. */
    readonly pageId: URL;
    /** The collection that the page was reached from. */
    readonly collectionId: URL;
    /** The mismatching `partOf`, or `null` if the origin differs. */
    readonly partOf: URL | null;
  }
  | {
    /**
     * The owner's actor document could not be retrieved or verified, or it
     * lists no gateways.
     */
    readonly type: "collectionOwnerUnavailable";
    /** The owner candidate. */
    readonly owner: URL;
  }
  | {
    /**
     * The owner's actor document does not list the collection as its
     * `inbox`, `outbox`, `followers`, `following`, or `liked`.
     */
    readonly type: "collectionNotListedByOwner";
    /** The owner. */
    readonly owner: URL;
    /** The collection. */
    readonly collectionId: URL;
  }
  | {
    /**
     * The unsecured collection was retrieved from a gateway that its owner
     * does not list in its `gateways`.
     */
    readonly type: "untrustedGateway";
    /** The owner. */
    readonly owner: URL;
    /** The gateway that served the collection. */
    readonly gateway: URL;
    /** The owner's gateways. */
    readonly gateways: readonly URL[];
  };

/**
 * The result of {@link verifyPortableObject}.
 * @since 2.4.0
 */
export type VerifyPortableObjectResult =
  | {
    /** Whether the document is accepted. */
    readonly verified: true;
    /** The document carries valid Object Integrity Proofs. */
    readonly method: "proof";
    /** The public keys used by the verified proofs, in proof order. */
    readonly keys: readonly Multikey[];
    /**
     * Opaque state for verifying the pages of a portable collection.  Do not
     * inspect it; property accessors pass it back automatically.
     */
    readonly collectionContext?: unknown;
  }
  | {
    /** Whether the document is accepted. */
    readonly verified: true;
    /**
     * The document is an unsecured portable collection served by a gateway
     * that its owner lists.
     */
    readonly method: "gateway";
    /** The document has no integrity proof. */
    readonly unsecured: true;
    /** The actor that owns the collection. */
    readonly owner: URL;
    /** The gateway that served the collection. */
    readonly gateway: URL;
    /**
     * Opaque state for verifying the pages of a portable collection.  Do not
     * inspect it; property accessors pass it back automatically.
     */
    readonly collectionContext: unknown;
  }
  | {
    /** Whether the document is accepted. */
    readonly verified: false;
    /** Why the document was not accepted. */
    readonly reason: VerifyPortableObjectFailureReason;
  };

interface CollectionOwner {
  readonly id: URL;
  readonly gateways: readonly URL[];
}

interface ContextState {
  /** The canonical ID of the root collection. */
  readonly rootId: string;
  /** The cryptographic origin of the root collection. */
  readonly rootOrigin: string;
  /** The verified owner, if it has been resolved. */
  readonly owner: CollectionOwner | null;
  /** The owner candidate, if the owner has not been resolved. */
  readonly ownerCandidate: OwnerCandidate | null;
}

// Context tokens are opaque objects mapped to their state here, so that
// a structurally similar object cannot pass for a context:
const contextStates = new WeakMap<object, ContextState>();

function createContext(state: ContextState): unknown {
  const token = Object.freeze(Object.create(null));
  contextStates.set(token, state);
  return token;
}

function getContextState(context: unknown): ContextState | undefined {
  if (context == null || typeof context !== "object") return undefined;
  return contextStates.get(context);
}

/** A collection or page, as far as the ownership checks are concerned. */
interface CollectionNode {
  /** The canonical ID. */
  readonly id: string;
  /** The ID as a URL, for failure reasons. */
  readonly url: URL;
  /** The cryptographic origin. */
  readonly origin: string;
  /** The canonical IDs of `partOf`, or `null` if any of them is invalid. */
  readonly partOf: readonly string[] | null;
  /**
   * The canonical IDs of `attributedTo`, or `null` if any of them is
   * invalid, e.g., not a portable IRI.
   */
  readonly attributedTo: readonly string[] | null;
  /**
   * The `attributedTo` IRIs as they appear, in the same order as
   * {@link attributedTo}, keeping location hints for fetching the owner.
   */
  readonly attributedToUrls: readonly URL[] | null;
}

function canonicalize(id: string | URL): string | null {
  try {
    return canonicalizePortableUri(typeof id === "string" ? id : formatIri(id));
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

function toUrl(canonicalId: string): URL {
  return parseIri(canonicalId);
}

function canonicalizeAll(ids: readonly (string | URL)[]): string[] | null {
  const result: string[] = [];
  for (const id of ids) {
    const canonical = canonicalize(id);
    if (canonical == null) return null;
    result.push(canonical);
  }
  return result;
}

function getExpandedIds(
  node: Record<string, unknown>,
  property: string,
): string[] | null {
  const values = node[property];
  if (values == null) return [];
  if (!Array.isArray(values)) return null;
  const ids: string[] = [];
  for (const value of values) {
    if (
      value == null || typeof value !== "object" || Array.isArray(value) ||
      typeof (value as Record<string, unknown>)["@id"] !== "string"
    ) {
      return null;
    }
    ids.push((value as Record<string, unknown>)["@id"] as string);
  }
  return ids;
}

function parseAll(ids: readonly string[]): URL[] | null {
  const result: URL[] = [];
  for (const id of ids) {
    try {
      result.push(parseIri(id));
    } catch (error) {
      if (error instanceof TypeError) return null;
      throw error;
    }
  }
  return result;
}

function describeRoot(root: Record<string, unknown>): CollectionNode | null {
  const rawId = root["@id"];
  if (typeof rawId !== "string") return null;
  const id = canonicalize(rawId);
  if (id == null) return null;
  const partOf = getExpandedIds(root, AS_PART_OF);
  const attributedTo = getExpandedIds(root, AS_ATTRIBUTED_TO);
  return {
    id,
    url: toUrl(id),
    origin: getFe34Origin(id),
    partOf: partOf == null ? null : canonicalizeAll(partOf),
    attributedTo: attributedTo == null ? null : canonicalizeAll(attributedTo),
    attributedToUrls: attributedTo == null ? null : parseAll(attributedTo),
  };
}

function describeObject(object: unknown): CollectionNode | null {
  if (!(object instanceof ASObject) || object.id == null) return null;
  const id = canonicalize(object.id);
  if (id == null) return null;
  const partOfId = object instanceof CollectionPage ? object.partOfId : null;
  return {
    id,
    url: toUrl(id),
    origin: getFe34Origin(id),
    partOf: canonicalizeAll(partOfId == null ? [] : [partOfId]),
    attributedTo: canonicalizeAll(object.attributionIds),
    attributedToUrls: object.attributionIds,
  };
}

type Failure = Extract<VerifyPortableObjectResult, { verified: false }>;

function fail(reason: VerifyPortableObjectFailureReason): Failure {
  return { verified: false, reason };
}

interface OwnerCandidate {
  /** The canonical ID. */
  readonly id: string;
  /** The IRI to fetch the owner from, which may carry location hints. */
  readonly url?: URL;
  /** The referring actor object, when the candidate came from a referrer. */
  readonly object?: unknown;
  readonly acceptance?: "verified" | "unsecured";
}

interface ResolvedChain {
  readonly rootId: string;
  readonly rootOrigin: string;
  readonly owner: CollectionOwner | null;
  readonly candidate: OwnerCandidate;
}

/**
 * Walks the referrer chain of a collection or page to find the root
 * collection and its owner candidate, checking every page on the way.
 */
function resolveChain(
  node: CollectionNode,
  referrer: PortableObjectReferrer | undefined,
): ResolvedChain | Failure {
  const pages: CollectionNode[] = [];
  let top = node;
  let link = referrer;
  let state: ContextState | undefined;
  while (link != null && PAGING_PROPERTIES.has(link.property)) {
    // The object reached through a paging property is a page:
    pages.push(top);
    state = getContextState(link.collectionContext);
    if (state != null) break;
    const parent = describeObject(link.object);
    if (parent == null || link.truncated) {
      return fail({ type: "unknownCollectionOwner" });
    }
    top = parent;
    link = link.referrer;
  }
  let rootId: string;
  let rootOrigin: string;
  let candidate: OwnerCandidate;
  if (state != null) {
    rootId = state.rootId;
    rootOrigin = state.rootOrigin;
    const ownerCandidate: OwnerCandidate | null = state.owner == null
      ? state.ownerCandidate
      : { id: canonicalize(state.owner.id)! };
    if (ownerCandidate == null) {
      return fail({ type: "unknownCollectionOwner" });
    }
    candidate = ownerCandidate;
  } else {
    rootId = top.id;
    rootOrigin = top.origin;
    const attributedTo = top.attributedTo;
    if (attributedTo == null) {
      return fail({ type: "unknownCollectionOwner" });
    }
    if (link != null && ACTOR_COLLECTION_PROPERTIES.has(link.property)) {
      const id = link.id == null ? null : canonicalize(link.id);
      if (id == null) return fail({ type: "unknownCollectionOwner" });
      candidate = { id, object: link.object, acceptance: link.acceptance };
    } else if (attributedTo.length === 1) {
      candidate = { id: attributedTo[0], url: top.attributedToUrls?.[0] };
    } else if (attributedTo.length > 1) {
      return fail({
        type: "conflictingCollectionOwners",
        candidates: attributedTo.map(toUrl),
      });
    } else {
      return fail({ type: "unknownCollectionOwner" });
    }
    const conflict = attributedTo.find((id) => id !== candidate.id);
    if (conflict != null) {
      return fail({
        type: "conflictingCollectionOwners",
        candidates: [toUrl(candidate.id), toUrl(conflict)],
      });
    }
  }
  if (getFe34Origin(candidate.id) !== rootOrigin) {
    return fail({ type: "unknownCollectionOwner" });
  }
  for (const page of pages) {
    if (page.origin !== rootOrigin) {
      return fail({
        type: "collectionPageMismatch",
        pageId: page.url,
        collectionId: toUrl(rootId),
        partOf: null,
      });
    }
    if (page.partOf == null) {
      return fail({ type: "unknownCollectionOwner" });
    }
    const partOf = page.partOf.find((id) => id !== rootId);
    if (partOf != null) {
      return fail({
        type: "collectionPageMismatch",
        pageId: page.url,
        collectionId: toUrl(rootId),
        partOf: toUrl(partOf),
      });
    }
    if (page.attributedTo == null) {
      return fail({ type: "unknownCollectionOwner" });
    }
    const conflict = page.attributedTo.find((id) => id !== candidate.id);
    if (conflict != null) {
      return fail({
        type: "conflictingCollectionOwners",
        candidates: [toUrl(candidate.id), toUrl(conflict)],
      });
    }
  }
  return { rootId, rootOrigin, owner: state?.owner ?? null, candidate };
}

function getActorCollectionIds(actor: Actor): string[] {
  const ids: string[] = [];
  for (
    const id of [
      actor.inboxId,
      actor.outboxId,
      actor.followersId,
      actor.followingId,
      actor.likedId,
    ]
  ) {
    if (id == null) continue;
    const canonical = canonicalize(id);
    if (canonical != null) ids.push(canonical);
  }
  return ids;
}

async function fetchOwner(
  candidate: URL,
  options: VerifyPortableObjectOptions,
): Promise<Actor | null> {
  const documentLoader = options.documentLoader ?? getDocumentLoader();
  const contextLoader: DocumentLoader = options.contextLoader ??
    getDocumentLoader();
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  // Explicit gateways (even an empty list) take precedence, as in property
  // accessors; otherwise the owner's own location hints, and failing that,
  // the hints that the collection was fetched with:
  const gateways = options.gateways ??
    (getPortableGatewayCandidates(candidate).length > 0
      ? undefined
      : options.gatewayHints);
  const span = tracer.startSpan("activitypub.lookup_object");
  try {
    const object = await dereferencePortableIri(candidate, {
      documentLoader,
      contextLoader,
      tracerProvider,
      gateways,
      verifyPortableObject: (document, verifierOptions) =>
        verifyPortableObjectProof(document, {
          ...options,
          ...verifierOptions,
        }),
      suppressError: true,
      span,
      parse: (document, parseOptions) =>
        ASObject.fromJsonLd(document, {
          documentLoader,
          contextLoader: parseOptions.contextLoader,
          tracerProvider,
          baseUrl: parseOptions.baseUrl,
        }),
    });
    return isActor(object) ? object : null;
  } catch (error) {
    logger.debug(
      "Failed to fetch the owner {owner} of a portable collection: {error}",
      { owner: formatIri(candidate), error },
    );
    return null;
  } finally {
    span.end();
  }
}

async function resolveOwner(
  chain: ResolvedChain,
  options: VerifyPortableObjectOptions,
): Promise<CollectionOwner | Failure> {
  if (chain.owner != null) return chain.owner;
  const { candidate } = chain;
  const candidateUrl = toUrl(candidate.id);
  let actor: Actor | null = null;
  if (
    candidate.acceptance === "verified" && isActor(candidate.object) &&
    candidate.object.id != null &&
    canonicalize(candidate.object.id) === candidate.id
  ) {
    // The referring actor was itself verified when it was dereferenced, so
    // its snapshot is used instead of fetching a possibly older one:
    actor = candidate.object;
  } else {
    actor = await fetchOwner(
      candidate.url ??
        (candidate.object instanceof ASObject && candidate.object.id != null
          ? candidate.object.id
          : candidateUrl),
      options,
    );
  }
  if (actor == null || actor.id == null) {
    return fail({ type: "collectionOwnerUnavailable", owner: candidateUrl });
  }
  const gateways = actor.gateways;
  if (gateways.length < 1) {
    return fail({ type: "collectionOwnerUnavailable", owner: candidateUrl });
  }
  if (!getActorCollectionIds(actor).includes(chain.rootId)) {
    return fail({
      type: "collectionNotListedByOwner",
      owner: candidateUrl,
      collectionId: toUrl(chain.rootId),
    });
  }
  return { id: candidateUrl, gateways };
}

function getSourceGateway(
  node: CollectionNode,
  documentUrl: URL | undefined,
): URL | null {
  if (
    documentUrl == null ||
    (documentUrl.protocol !== "http:" && documentUrl.protocol !== "https:")
  ) {
    return null;
  }
  let portableId: URL | null;
  try {
    portableId = fromCompatibleEf61Id(documentUrl);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
  if (portableId == null || canonicalize(portableId) !== node.id) return null;
  return new URL(documentUrl.origin);
}

/**
 * Applies the [FEP-ef61] trust policy to a portable object fetched through
 * a gateway.
 *
 * Portable actors, activities, objects, and collections with proofs are
 * verified by {@link verifyPortableObjectProof}.  A portable collection or
 * collection page without a proof is accepted only if all of the following
 * hold:
 *
 *  -  It was retrieved from a gateway: its final URL (`documentUrl`) is
 *     a compatible identifier for the same portable collection.
 *  -  Its owner is determined unambiguously: the actor whose `inbox`,
 *     `outbox`, `followers`, `following`, or `liked` property referred to
 *     the collection, or the single actor in its `attributedTo`.  A page
 *     inherits the owner of the collection it was reached from through
 *     `first`, `last`, `current`, `next`, or `prev`, and must not name
 *     another collection in `partOf`.
 *  -  The owner's actor document is verified by its proof and lists the
 *     collection as its `inbox`, `outbox`, `followers`, `following`, or
 *     `liked`.
 *  -  The gateway that served the collection is in the owner's `gateways`.
 *
 * Where the document came from and which object referred to it are passed
 * by property accessors when this function is used as their
 * `verifyPortableObject` option.  Objects embedded in an unsecured
 * collection accepted this way are not trusted: accessors dereference and
 * verify them one by one.
 *
 * Note that acceptance through the gateway policy does not verify anything
 * cryptographically; it only means that the owner trusts the gateway.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 *
 * @param jsonLd The JSON-LD document to verify.
 * @param options Additional options.  See also
 *                {@link VerifyPortableObjectOptions}.
 * @returns The detailed result.
 * @throws {TypeError} If the input is not a single JSON-LD object or has a
 *                     malformed portable ID.
 * @since 2.4.0
 */
export async function verifyPortableObject(
  jsonLd: unknown,
  options: VerifyPortableObjectOptions = {},
): Promise<VerifyPortableObjectResult> {
  const { result, root, objectType } = await verifyPortableObjectProofWithRoot(
    jsonLd,
    options,
  );
  if (result.verified) {
    const node = objectType === "collection" && root != null
      ? describeRoot(root)
      : null;
    const chain = node == null ? null : resolveChain(node, options.referrer);
    if (chain == null || !("rootId" in chain)) {
      return { verified: true, method: "proof", keys: result.keys };
    }
    return {
      verified: true,
      method: "proof",
      keys: result.keys,
      collectionContext: createContext({
        rootId: chain.rootId,
        rootOrigin: chain.rootOrigin,
        owner: chain.owner,
        // Keeping the candidate as is lets unsigned pages reuse the verified
        // referring actor, and the location hints of its IRI:
        ownerCandidate: chain.candidate,
      }),
    };
  }
  if (result.reason.type !== "unsecuredCollection") {
    return { verified: false, reason: result.reason };
  }
  const node = root == null ? null : describeRoot(root);
  if (node == null) return fail({ type: "unknownCollectionOwner" });
  const gateway = getSourceGateway(node, options.documentUrl);
  if (gateway == null) {
    return fail({
      type: "unknownCollectionSource",
      documentUrl: options.documentUrl ?? null,
    });
  }
  const chain = resolveChain(node, options.referrer);
  if (!("rootId" in chain)) return chain;
  const owner = await resolveOwner(chain, options);
  if (!("gateways" in owner)) return owner;
  if (!owner.gateways.some((g) => g.origin === gateway.origin)) {
    return fail({
      type: "untrustedGateway",
      owner: owner.id,
      gateway,
      gateways: owner.gateways,
    });
  }
  return {
    verified: true,
    method: "gateway",
    unsecured: true,
    owner: owner.id,
    gateway,
    collectionContext: createContext({
      rootId: chain.rootId,
      rootOrigin: chain.rootOrigin,
      owner,
      ownerCandidate: null,
    }),
  };
}
