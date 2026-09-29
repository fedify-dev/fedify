import { getLogger } from "@logtape/logtape";
import {
  type Span,
  SpanStatusCode,
  type TracerProvider,
} from "@opentelemetry/api";
import preloadedContexts from "../contexts.ts";
import type { DocumentLoader, RemoteDocument } from "../docloader.ts";
import jsonld from "../jsonld.ts";
import { createScopedContextLoader } from "./jsonld-cache.ts";
import type {
  PortableObjectReferrer,
  PortableObjectVerification,
  PortableObjectVerifier,
} from "../portable.ts";
import {
  canonicalizePortableUri,
  formatIri,
  fromCompatibleEf61Id,
  haveSameFe34Origin,
  parseIri,
  toCompatibleEf61Id,
} from "../url.ts";

const logger = getLogger(["fedify", "vocab", "gateway"]);

/**
 * The maximum number of `@gateway` location hints to try for one reference.
 * Hints come from possibly untrusted documents, so they are bounded to keep
 * a single accessor call from fanning out to many servers.
 */
const MAX_GATEWAY_HINTS = 5;

const LOCATION_HINT_PARAMETER = "@gateway";

// The same baseline contexts that Fedify's proof verifier always resolves
// from its built-in copies (see getNormalizationContextLoader() in
// @fedify/fedify).  Serving them identically here keeps the identity check,
// the verifier, and the parser on the same context documents.  Other
// contexts go through the caller's context loader.
const BASELINE_CONTEXT_URLS: ReadonlySet<string> = new Set([
  "https://w3id.org/identity/v1",
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/v1",
  "https://w3id.org/security/data-integrity/v1",
]);

/**
 * The maximum number of links in a referrer chain passed to a
 * {@link PortableObjectVerifier}.  Longer chains are cut off and marked as
 * truncated.
 */
const MAX_REFERRER_CHAIN_LENGTH = 32;

/**
 * Where a vocabulary object came from, as far as portable objects are
 * concerned.
 */
interface Provenance {
  /**
   * How the object was accepted by a portable object verifier, if it was
   * returned by {@link dereferencePortableIri}.
   */
  readonly acceptance?: "verified" | "unsecured";

  /**
   * The opaque collection context that the verifier attached to the object.
   */
  readonly collectionContext?: unknown;

  /**
   * The object and property through which the object was obtained.
   */
  readonly referrer?: { readonly object: object; readonly property: string };
}

// Kept outside the objects so that they cannot be forged through vocabulary
// constructors or JSON-LD, and so that they do not show up in serialization:
const provenances = new WeakMap<object, Provenance>();

/**
 * A reference from a vocabulary object's property, which generated
 * accessors pass to {@link dereferencePortableIri}.
 *
 * @internal
 */
export interface PortableReferrerLink {
  readonly object: object;
  readonly property: string;
}

function getObjectId(object: unknown): URL | null {
  if (object == null || typeof object !== "object" || !("id" in object)) {
    return null;
  }
  const id = object.id;
  return id instanceof URL ? id : null;
}

/**
 * Checks whether a vocabulary object is part of a chain of portable objects,
 * i.e., whether it has a portable ID or was obtained from a portable object.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function isInPortableChain(object: object): boolean {
  if (provenances.has(object)) return true;
  const id = getObjectId(object);
  return id != null && isPortableIri(id);
}

/**
 * Checks whether a vocabulary object was accepted without an integrity
 * proof, e.g., as an unsecured portable collection served by a trusted
 * gateway.  Objects embedded in such an object must not be trusted because
 * of their origin.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function isUnsecuredPortableObject(object: object): boolean {
  return provenances.get(object)?.acceptance === "unsecured";
}

/**
 * Checks whether a URL is an FEP-ef61 compatible identifier, i.e., an HTTP(S)
 * URL under a gateway's `/.well-known/apgateway/` path that stands for
 * a portable object.  Malformed compatible identifiers count as compatible
 * identifiers too.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function isCompatibleEf61Iri(url: URL | string): boolean {
  try {
    return fromCompatibleEf61Id(url) != null;
  } catch (error) {
    if (error instanceof TypeError) return true;
    throw error;
  }
}

/**
 * Records that a vocabulary object returned by a property accessor was
 * obtained through the given property of a portable object, so that later
 * dereferences from it can tell where it came from.  Nothing is recorded if
 * the parent is not in a portable chain, or if the child already has its
 * provenance.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function recordPortableReferrer(
  parent: object,
  child: unknown,
  property: string,
): void {
  if (child == null || typeof child !== "object") return;
  if (provenances.has(child) || !isInPortableChain(parent)) return;
  provenances.set(child, { referrer: { object: parent, property } });
}

/**
 * Copies the provenance of a vocabulary object to its clone.  The clone
 * keeps where the original came from and the restriction on unsecured
 * objects, but not a positive verification status nor a collection context,
 * since the clone may have different property values.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function copyPortableProvenance(from: object, to: object): void {
  const provenance = provenances.get(from);
  if (provenance == null) return;
  provenances.set(to, {
    referrer: provenance.referrer,
    ...(provenance.acceptance === "unsecured"
      ? { acceptance: "unsecured" }
      : {}),
  });
}

/**
 * Recognizes an FEP-ef61 compatible identifier to dereference as a portable
 * object.
 *
 * @returns `undefined` if the URL is not a compatible identifier; `null` if
 *          it is a malformed compatible identifier; otherwise, the portable
 *          ID it stands for and the gateway it names.
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function parseCompatibleEf61Reference(
  url: URL | string,
): { readonly id: URL; readonly gateway: URL } | null | undefined {
  if (typeof url === "string") {
    if (!URL.canParse(url)) return undefined;
    url = new URL(url);
  }
  try {
    const id = fromCompatibleEf61Id(url);
    if (id == null) return undefined;
    return { id, gateway: new URL(url.origin) };
  } catch (error) {
    if (error instanceof TypeError) {
      logger.debug(
        "Invalid FEP-ef61 compatible identifier {url}: {error}",
        { url: url.href, error },
      );
      return null;
    }
    throw error;
  }
}

/**
 * Checks whether a property accessor call on a vocabulary object applies the
 * FEP-ef61 portable object policy, i.e., whether the `verifyPortableObject`
 * option is given or the object is part of a chain of portable objects.
 * In this mode, compatible identifiers are dereferenced as portable objects,
 * and fetched documents that turn out to stand for portable objects are
 * verified as such.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function isPortableMode(
  object: object,
  options: { readonly verifyPortableObject?: PortableObjectVerifier },
): boolean {
  return options.verifyPortableObject != null || isInPortableChain(object);
}

/**
 * Checks whether an object embedded in a property of a vocabulary object has
 * to be dereferenced by its `@id` and verified as a portable object rather
 * than trusted as embedded, even with `crossOrigin: "trust"`.  This is the
 * case in {@link isPortableMode | portable mode} if its `@id` is an FEP-ef61
 * compatible identifier, or a portable IRI whose DID differs from the
 * owner's portable ID.
 *
 * @param parent The object whose property embeds the object.
 * @param ownerId The ID of the object that vouches for embedded objects, or
 *                `null` if embedded objects are not trusted by their owner.
 * @param id The `@id` of the embedded object.
 * @param options The options of the accessor.
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function mustDereferencePortableObject(
  parent: object,
  ownerId: URL | null,
  id: URL,
  options: { readonly verifyPortableObject?: PortableObjectVerifier },
): boolean {
  if (!isPortableMode(parent, options)) return false;
  if (isCompatibleEf61Iri(id)) return true;
  if (!isPortableIri(id)) return false;
  return ownerId == null || !isPortableIri(ownerId) ||
    !haveSameFe34Origin(ownerId, id);
}

const PORTABLE_IRI_PATTERN = /^ap(?:\+ef61)?:/i;

/**
 * The portable object that a document fetched as an ordinary HTTP(S)
 * document claims to be.
 *
 * @internal
 */
export interface PortableResponseClaim {
  /** The portable ID that the document has to have. */
  readonly id: URL;
  /**
   * The gateways inferred from the document's URL or `@id`, which are
   * reported to the verifier as gateway hints.
   */
  readonly inferredGateways: readonly URL[];
}

/**
 * Finds out whether a document fetched as an ordinary HTTP(S) document
 * claims to be a portable object: its final URL is a portable IRI or an
 * FEP-ef61 compatible identifier, or else its `@id` is.  The final URL takes
 * precedence, so a document whose `@id` claims another object fails the
 * identity check against the final URL.
 *
 * @param documentUrl The final URL of the document.
 * @param objectId The `@id` of the parsed document.
 * @returns `undefined` if the document does not claim to be a portable
 *          object; `null` if the claim is malformed; otherwise, the claim.
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function getPortableResponseClaim(
  documentUrl: string,
  objectId: URL | null,
): PortableResponseClaim | null | undefined {
  if (PORTABLE_IRI_PATTERN.test(documentUrl)) {
    let id: URL;
    try {
      id = parseIri(documentUrl);
      // URL parsing normalizes dot segments in the opaque path, which would
      // make the parsed IRI identify another portable object:
      if (
        canonicalizePortableUri(documentUrl) !==
          canonicalizePortableUri(formatIri(id))
      ) {
        return null;
      }
    } catch (error) {
      if (error instanceof TypeError) return null;
      throw error;
    }
    return { id, inferredGateways: getPortableGatewayCandidates(id) };
  }
  for (const url of [documentUrl, objectId]) {
    if (url == null) continue;
    const compatible = parseCompatibleEf61Reference(url);
    if (compatible === null) return null;
    if (compatible != null) {
      return { id: compatible.id, inferredGateways: [compatible.gateway] };
    }
    if (url instanceof URL && isPortableIri(url)) {
      return { id: url, inferredGateways: getPortableGatewayCandidates(url) };
    }
  }
  return undefined;
}

// Objects that were fetched as ordinary HTTP(S) objects although they stand
// for portable objects, i.e., without the portable object policy:
const unverifiedPortableClaims = new WeakSet<object>();

/**
 * Records that an object fetched as an ordinary HTTP(S) object stands for
 * a portable object if its reference, its final URL, or its `@id` is
 * a portable IRI or an FEP-ef61 compatible identifier.  Accessors do not
 * cache such objects in their parents, so that a later call with the
 * `verifyPortableObject` option dereferences and verifies them.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function markUnverifiedPortableClaim(
  object: object,
  reference: URL,
  documentUrl: string,
): void {
  const objectId = getObjectId(object);
  if (
    isPortableIri(reference) || isCompatibleEf61Iri(reference) ||
    PORTABLE_IRI_PATTERN.test(documentUrl) ||
    isCompatibleEf61Iri(documentUrl) ||
    (objectId != null &&
      (isPortableIri(objectId) || isCompatibleEf61Iri(objectId)))
  ) {
    unverifiedPortableClaims.add(object);
  }
}

/**
 * Checks whether an object was fetched as an ordinary HTTP(S) object although
 * it stands for a portable object.  See {@link markUnverifiedPortableClaim}.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function isUnverifiedPortableClaim(object: object): boolean {
  return unverifiedPortableClaims.has(object);
}

/**
 * Rejects a malformed FEP-ef61 compatible identifier found in a reference,
 * the final URL of a fetched document, or its `@id`, when it would be
 * dereferenced as a portable object.  It is rejected without a request (or
 * without returning the fetched document), since it cannot be verified as
 * a portable object, and fetching it as an ordinary HTTP(S) object would
 * skip the portable object policy.
 *
 * @param url The rejected URL, for the log message.
 * @param options The options of the accessor.
 * @returns Always `null`.
 * @throws {Error} If `crossOrigin` is `"throw"` and `suppressError` is not
 *                 set.
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function rejectMalformedCompatibleReference(
  url: string,
  options: {
    readonly crossOrigin?: "ignore" | "throw" | "trust";
    readonly suppressError?: boolean;
  },
): null {
  const message = "Refusing to dereference {url}, because it is a malformed " +
    "FEP-ef61 compatible identifier, which cannot be verified as a portable " +
    "object.";
  if (options.crossOrigin === "throw" && !options.suppressError) {
    throw new PortableObjectRejectedError(message.replace("{url}", url));
  }
  logger.warn(message, { url });
  return null;
}

/**
 * Logs that an embedded object without `@id` in an object accepted without
 * an integrity proof is dropped, because it cannot be dereferenced and
 * verified on its own.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function warnUnverifiableEmbeddedObject(
  parent: object,
  property: string,
): void {
  logger.warn(
    "Dropping an embedded object without @id in the {property} property of " +
      "{parentId}, because the parent was accepted without an integrity " +
      "proof and the embedded object cannot be verified on its own.",
    { property, parentId: getObjectId(parent)?.href ?? null },
  );
}

function buildReferrerChain(
  link: PortableReferrerLink | undefined,
  depth = 0,
): PortableObjectReferrer | undefined {
  if (link == null) return undefined;
  const provenance = provenances.get(link.object);
  const base = {
    object: link.object,
    id: getObjectId(link.object),
    property: link.property,
    ...(provenance?.acceptance == null
      ? {}
      : { acceptance: provenance.acceptance }),
    ...(provenance?.collectionContext === undefined
      ? {}
      : { collectionContext: provenance.collectionContext }),
  };
  if (provenance?.referrer == null) return base;
  if (depth + 1 >= MAX_REFERRER_CHAIN_LENGTH) {
    return { ...base, truncated: true };
  }
  return {
    ...base,
    referrer: buildReferrerChain(provenance.referrer, depth + 1),
  };
}

/**
 * Checks whether a URL is an FEP-ef61 portable ActivityPub IRI.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function isPortableIri(url: URL): boolean {
  return url.protocol === "ap+ef61:" || url.protocol === "ap:";
}

/**
 * Picks the ordered list of FEP-ef61 gateways to fetch a portable IRI from.
 *
 * If `gateways` is given, it is used as is (even when empty), and `@gateway`
 * location hints in the IRI are ignored.  Otherwise, up to
 * {@link MAX_GATEWAY_HINTS} valid `@gateway` hints are used.  Duplicate
 * gateways are dropped in both cases.
 *
 * @throws {TypeError} If an explicit gateway is not an HTTP(S) origin.
 * @internal
 */
export function getPortableGatewayCandidates(
  url: URL,
  gateways?: readonly (string | URL)[],
): URL[] {
  const candidates: URL[] = [];
  const seen = new Set<string>();
  const add = (gateway: URL) => {
    if (seen.has(gateway.href)) return;
    seen.add(gateway.href);
    candidates.push(gateway);
  };
  if (gateways != null) {
    for (const gateway of gateways) {
      const parsed = parseGatewayOrigin(gateway);
      if (parsed == null) {
        throw new TypeError(
          "FEP-ef61 gateways must be HTTP(S) origins with no credentials, " +
            "path, query, or fragment: " + String(gateway),
        );
      }
      add(parsed);
    }
    return candidates;
  }
  for (
    const hint of new URLSearchParams(url.search).getAll(
      LOCATION_HINT_PARAMETER,
    )
  ) {
    if (candidates.length >= MAX_GATEWAY_HINTS) break;
    const parsed = parseGatewayOrigin(hint);
    if (parsed == null) {
      logger.debug(
        "Ignoring an invalid FEP-ef61 gateway hint {hint} in {url}.",
        { hint, url: formatIri(url) },
      );
      continue;
    }
    add(parsed);
  }
  return candidates;
}

function parseGatewayOrigin(gateway: string | URL): URL | null {
  let url: URL;
  if (gateway instanceof URL) url = new URL(gateway.href);
  else if (typeof gateway === "string" && URL.canParse(gateway)) {
    url = new URL(gateway);
  } else return null;
  // Comparing href with the origin also rejects credentials, a path, and
  // query and fragment components, including empty ? and # delimiters.
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.href !== `${url.origin}/`
  ) {
    return null;
  }
  return url;
}

/**
 * Creates a context loader that returns the same context documents for the
 * whole dereference operation, so that the identity check, the proof
 * verifier, and the parser interpret the fetched document identically even
 * if the underlying loader is nondeterministic.  Failed loads are not
 * remembered, so a transient failure does not affect the next gateway.
 *
 * The parsed object keeps the loader for its own later dereferences, so
 * `release()` turns it into a plain pass-through to the underlying loader
 * once the operation is over.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function createSnapshotContextLoader(
  contextLoader: DocumentLoader,
  suppressError?: boolean,
): { loader: DocumentLoader; release: () => void } {
  // Objects parsed during a dereference keep its loader, so later
  // dereferences from them would otherwise wrap released pass-throughs in
  // ever deeper chains:
  for (
    let wrapped = snapshotLoaders.get(contextLoader);
    wrapped?.released;
    wrapped = snapshotLoaders.get(contextLoader)
  ) {
    contextLoader = wrapped.base;
  }
  const cache = new Map<string, Promise<RemoteDocument>>();
  let released = false;
  const release = () => {
    released = true;
    state.released = true;
    cache.clear();
  };
  const loader: DocumentLoader = async (url, options) => {
    if (released) return await contextLoader(url, options);
    const key = URL.canParse(url) ? new URL(url).href : url;
    if (BASELINE_CONTEXT_URLS.has(key)) {
      return {
        contextUrl: null,
        document: structuredClone(preloadedContexts[key]),
        documentUrl: key,
      };
    }
    let promise = cache.get(key);
    if (promise == null) {
      const loading = contextLoader(
        url,
        suppressError ? { ...options, suppressError: true } : options,
      ).then((document) => structuredClone(document));
      promise = loading;
      cache.set(key, loading);
      loading.catch(() => {
        if (cache.get(key) === loading) cache.delete(key);
      });
    }
    return structuredClone(await promise);
  };
  const state = { base: contextLoader, released: false };
  snapshotLoaders.set(loader, state);
  return { loader, release };
}

const snapshotLoaders = new WeakMap<
  DocumentLoader,
  { readonly base: DocumentLoader; released: boolean }
>();

/**
 * Options for {@link dereferencePortableIri}.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export interface DereferencePortableIriOptions<T> {
  documentLoader: DocumentLoader;
  contextLoader: DocumentLoader;
  tracerProvider: TracerProvider;
  gateways?: readonly (string | URL)[];
  /**
   * The gateways inferred from where the reference came from, e.g., the
   * gateway of a compatible identifier.  When given, they replace the
   * `@gateway` location hints of the IRI, are asked before the explicit
   * `gateways`, and are reported to the verifier as gateway hints unless
   * `gateways` is given.
   */
  inferredGateways?: readonly URL[];
  /**
   * An already fetched document to validate instead of fetching the object
   * from gateways.  It is validated the same way as a gateway's response,
   * and nothing else is tried if it is rejected.
   */
  response?: RemoteDocument;
  verifyPortableObject?: PortableObjectVerifier;
  referrer?: PortableReferrerLink;
  suppressError?: boolean;
  crossOrigin?: "ignore" | "throw" | "trust";
  /**
   * The signal for cancelling the dereference.  It is passed to the document
   * loader for requests to gateways, and checked between attempts.  Requests
   * for JSON-LD contexts and verification methods may not be cancelled.
   */
  signal?: AbortSignal;
  parse: (
    document: unknown,
    options: { contextLoader: DocumentLoader; baseUrl: URL },
  ) => Promise<T>;
  span?: Span;
}

/**
 * The error thrown by {@link dereferencePortableIri} under
 * `crossOrigin: "throw"` when gateways returned objects but none of them
 * satisfied the identity and proof checks.
 *
 * @internal Not part of the public API contract.
 */
export class PortableObjectRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortableObjectRejectedError";
  }
}

type Attempt =
  | { readonly type: "rejected"; readonly source: string }
  | { readonly type: "error"; readonly error: unknown };

class PortableObjectRejection {
  constructor(
    readonly message: string,
    readonly values: Record<string, unknown> = {},
  ) {}
}

/**
 * Dereferences an FEP-ef61 portable IRI through its gateways.
 *
 * Gateways are tried one by one until one of them returns a single-node
 * document whose `@id`, if any, canonically matches the requested IRI and
 * which passes `verifyPortableObject`.  When there is no gateway to try, the
 * document loader is asked for the portable IRI itself, and its result is
 * validated the same way.  If the `response` option is given, only that
 * document is validated, and nothing is fetched.
 *
 * @returns The parsed object, or `null` if no valid object was retrieved and
 *          `suppressError` is set or the failure was a rejected object
 *          (unless `crossOrigin` is `"throw"`).
 * @throws {TypeError} If `gateways` has an invalid entry (always), if no
 *                     verifier is given, or if the IRI cannot be turned into
 *                     a gateway URL (unless `suppressError` is set).
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export async function dereferencePortableIri<T extends { id: URL | null }>(
  url: URL,
  options: DereferencePortableIriOptions<T>,
): Promise<T | null> {
  url = parseIri(url);
  const lookupUrl = formatIri(url);
  const { span } = options;
  // Invalid gateways are a programming error, so they are never suppressed:
  const explicitGateways = options.gateways == null
    ? undefined
    : getPortableGatewayCandidates(url, options.gateways);
  const inferredGateways = options.inferredGateways ??
    (explicitGateways == null ? getPortableGatewayCandidates(url) : []);
  const gateways = [...inferredGateways];
  for (const gateway of explicitGateways ?? []) {
    if (!gateways.some((g) => g.href === gateway.href)) gateways.push(gateway);
  }
  const fail = (error: unknown): null => {
    span?.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
    if (options.suppressError) {
      logger.warn("Failed to dereference {url}: {error}", {
        url: lookupUrl,
        error,
      });
      return null;
    }
    throw error;
  };
  const verify = options.verifyPortableObject;
  if (verify == null) {
    return fail(
      new TypeError(
        "Dereferencing the portable object " + lookupUrl + " requires the " +
          "verifyPortableObject option, e.g., verifyPortableObjectProof() " +
          "from @fedify/fedify.",
      ),
    );
  }
  const requestUrls: {
    url: string;
    gateway: URL | null;
    response?: RemoteDocument;
  }[] = [];
  let expectedId: string;
  try {
    expectedId = canonicalizePortableUri(lookupUrl);
    if (options.response != null) {
      requestUrls.push({
        url: options.response.documentUrl,
        gateway: null,
        response: options.response,
      });
    } else {
      for (const gateway of gateways) {
        requestUrls.push({
          url: toCompatibleEf61Id(url, gateway).href,
          gateway,
        });
      }
    }
  } catch (error) {
    return fail(error);
  }
  if (requestUrls.length < 1) {
    // No gateway to ask; custom document loaders may still know how to
    // retrieve the portable IRI itself:
    requestUrls.push({ url: lookupUrl, gateway: null });
  }
  const snapshot = createSnapshotContextLoader(
    options.contextLoader,
    options.suppressError,
  );
  const contextLoader = snapshot.loader;
  const scopedDocument = createScopedContextLoader(
    options.documentLoader,
    options.suppressError,
  );
  const attempts: Attempt[] = [];
  const { signal } = options;
  const gatewayHints = explicitGateways == null && inferredGateways.length > 0
    ? inferredGateways
    : undefined;
  const referrer = buildReferrerChain(options.referrer);
  try {
    for (const { url: requestUrl, gateway, response } of requestUrls) {
      signal?.throwIfAborted();
      let remoteDocument: RemoteDocument;
      try {
        remoteDocument = response ?? await options.documentLoader(
          requestUrl,
          { signal, suppressError: options.suppressError },
        );
      } catch (error) {
        signal?.throwIfAborted();
        logger.debug("Failed to fetch {url} from {requestUrl}: {error}", {
          url: lookupUrl,
          requestUrl,
          error,
        });
        attempts.push({ type: "error", error });
        continue;
      }
      const { document } = remoteDocument;
      try {
        await checkPortableObjectId(document, expectedId, contextLoader);
        let documentUrl: URL | undefined;
        try {
          documentUrl = parseIri(remoteDocument.documentUrl);
        } catch {
          documentUrl = undefined;
        }
        let result: PortableObjectVerification;
        try {
          result = await verify(document, {
            documentLoader: scopedDocument.loader,
            contextLoader,
            tracerProvider: options.tracerProvider,
            ...(documentUrl == null ? {} : { documentUrl }),
            ...(explicitGateways == null ? {} : { gateways: explicitGateways }),
            ...(gatewayHints == null ? {} : { gatewayHints }),
            ...(referrer == null ? {} : { referrer }),
          });
        } catch (error) {
          throw new PortableObjectRejection(
            "the proof verifier failed: {error}",
            { error },
          );
        }
        if (!result.verified) {
          throw new PortableObjectRejection(
            "it does not satisfy the FEP-ef61 proof policy: {result}",
            { result },
          );
        }
        const object = await options.parse(document, {
          contextLoader,
          baseUrl: url,
        });
        signal?.throwIfAborted();
        if (object != null && typeof object === "object") {
          provenances.set(object, {
            acceptance: result.unsecured === true ? "unsecured" : "verified",
            ...(result.collectionContext === undefined
              ? {}
              : { collectionContext: result.collectionContext }),
            ...(options.referrer == null ? {} : { referrer: options.referrer }),
          });
        }
        if (gateway != null) {
          span?.setAttribute("activitypub.gateway", gateway.href);
        }
        return object;
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof PortableObjectRejection) {
          logger.warn(
            "Rejected the portable object {url} served from {requestUrl}, " +
              "because " + error.message,
            { ...error.values, url: lookupUrl, requestUrl },
          );
          attempts.push({ type: "rejected", source: requestUrl });
          continue;
        }
        logger.debug("Failed to parse {url} from {requestUrl}: {error}", {
          url: lookupUrl,
          requestUrl,
          error,
        });
        attempts.push({ type: "error", error });
      }
    }
  } finally {
    scopedDocument.release();
    snapshot.release();
  }
  const rejected = attempts.filter((a) => a.type === "rejected");
  if (rejected.length > 0) {
    const message = "No gateway returned a valid portable object for " +
      lookupUrl + "; refusing to return the object.  Objects retrieved " +
      "from: " + rejected.map((a) => a.source).join(", ") + ".";
    if (options.suppressError || options.crossOrigin !== "throw") {
      span?.setStatus({ code: SpanStatusCode.ERROR, message });
      logger.warn(message);
      return null;
    }
    throw new PortableObjectRejectedError(message);
  }
  const errors = attempts.flatMap((a) => a.type === "error" ? [a.error] : []);
  return fail(
    errors.length === 1 ? errors[0] : new AggregateError(
      errors,
      "Failed to dereference " + lookupUrl + " through any of its " +
        "gateways: " + requestUrls.map((r) => r.url).join(", "),
    ),
  );
}

async function checkPortableObjectId(
  document: unknown,
  expectedId: string,
  contextLoader: DocumentLoader,
): Promise<void> {
  if (
    document == null || typeof document !== "object" || Array.isArray(document)
  ) {
    throw new PortableObjectRejection("it is not a single JSON object");
  }
  const expanded = await jsonld.expand(document, {
    documentLoader: contextLoader,
    keepFreeFloatingNodes: true,
  });
  if (expanded.length !== 1) {
    throw new PortableObjectRejection(
      "it does not have exactly one top-level node",
    );
  }
  const id = expanded[0]["@id"];
  // A document without @id, such as a proof document, is left to the
  // verifier; verifyPortableObjectProof() rejects it, because there is no
  // portable ID to check its proof against:
  if (id == null) return;
  if (typeof id !== "string") {
    throw new PortableObjectRejection("it has an invalid @id");
  }
  // Compare the raw @id rather than a parsed URL, because URL parsing
  // normalizes opaque path segments (e.g., dot segments).  A document may
  // also use a compatible identifier as its @id, e.g., one on the gateway it
  // was served from, which stands for the portable ID it contains:
  let actualId: string | null;
  try {
    const portable = fromCompatibleEf61Id(id);
    actualId = canonicalizePortableUri(
      portable == null ? id : formatIri(portable),
    );
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    actualId = null;
  }
  if (actualId !== expectedId) {
    throw new PortableObjectRejection(
      "its @id ({objectId}) does not match the requested portable ID",
      { objectId: id },
    );
  }
}
