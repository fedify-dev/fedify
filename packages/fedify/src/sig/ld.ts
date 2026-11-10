import { Activity, CryptographicKey, getTypeId, Object } from "@fedify/vocab";
import {
  type CryptoKeyLike,
  type DocumentLoader,
  getDocumentLoader,
  preloadedContexts,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import { asCryptoKey } from "@fedify/vocab-runtime/internal";
import jsonld from "@fedify/vocab-runtime/jsonld";
import { getLogger } from "@logtape/logtape";
import { SpanStatusCode, trace, type TracerProvider } from "@opentelemetry/api";
import { decodeBase64, encodeBase64 } from "byte-encodings/base64";
import { encodeHex } from "byte-encodings/hex";
import metadata from "../../deno.json" with { type: "json" };
import { fetchKey, type KeyCache, validateCryptoKey } from "./key.ts";

const logger = getLogger(["fedify", "sig", "ld"]);
// This is the internal compaction target for LD-signature normalization, not
// an allow-list of every JSON-LD vocabulary Fedify accepts on the wire.
// Custom, Mastodon-specific, FEP, or deployment-defined extension contexts are
// still resolved through the caller's context loader and may survive in the
// parsed object graph; we only compact signed payloads onto Fedify's built-in
// baseline so signature-sensitive parsing runs against a stable local context.
const localContext = [
  "https://w3id.org/identity/v1",
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/v1",
  "https://w3id.org/security/data-integrity/v1",
] as const;
const localContextUrls = new Set<string>(localContext);
const builtInContextLoader = getDocumentLoader();
// Reject JSON-LD graph-restructuring features for signed activities:
// https://github.com/fedify-dev/fedify/security/advisories/GHSA-9rfg-v8g9-9367
const disallowedJsonLdKeywords = new Set(["@graph", "@included", "@reverse"]);

/** @internal */
export class UnsafeJsonLdError extends TypeError {
  constructor(readonly keyword: string) {
    super(`Unsupported JSON-LD keyword: ${keyword}.`);
    this.name = "UnsafeJsonLdError";
  }
}

/** @internal */
export class InvalidContextReferenceError extends TypeError {
  constructor(readonly reference: string) {
    super(`Invalid JSON-LD context reference: ${reference}.`);
    this.name = "InvalidContextReferenceError";
  }
}

function createLoadingRemoteContextFailedError(
  reference: string,
  cause: unknown,
): Error & { details: { code: string; url: string } } {
  const message = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(
    `Dereferencing a URL did not result in a valid JSON-LD context: ` +
      `${reference}. ${message}`,
  ) as Error & {
    details: { code: string; url: string };
    cause?: unknown;
  };
  error.name = "jsonld.InvalidUrl";
  error.details = {
    code: "loading remote context failed",
    url: reference,
  };
  error.cause = cause;
  return error;
}

/** @internal */
export function isClearlyMalformedContextReference(
  reference: string,
): boolean {
  // Opaque identifiers such as did:, urn:, or app: may be handled by
  // deployment-specific loaders, so a scheme prefix alone is not enough to
  // mark an @context reference as permanently malformed.  Treat only clearly
  // broken raw strings as sender defects here: embedded whitespace/control
  // characters, malformed scheme-prefixed references such as http:/[ or
  // http:[, invalid percent escapes, and malformed relative or network-path
  // references.  Parseable absolute or opaque identifiers stay retryable at
  // this layer because custom loaders may still fail transiently while
  // resolving them.
  for (const char of reference) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference) && !URL.canParse(reference)
  ) {
    return true;
  }
  for (let i = 0; i < reference.length; i++) {
    if (reference[i] !== "%") continue;
    if (
      i + 2 >= reference.length ||
      !/[0-9A-Fa-f]/.test(reference[i + 1]) ||
      !/[0-9A-Fa-f]/.test(reference[i + 2])
    ) {
      return true;
    }
    i += 2;
  }
  if (
    reference.startsWith("./") || reference.startsWith("../") ||
    reference.startsWith("/") || reference.startsWith("//")
  ) {
    for (const char of reference) {
      if ('[]<>"\\^`{|}'.includes(char)) return true;
    }
  }
  return false;
}

function cloneRemoteDocument(remoteDocument: RemoteDocument): RemoteDocument {
  return structuredClone(remoteDocument);
}

function createMemoizedDocumentLoader(documentLoader: DocumentLoader) {
  const cache = new Map<string, Promise<RemoteDocument>>();
  return async (url: string, options?: { signal?: AbortSignal }) => {
    const cacheKey = URL.canParse(url) ? new URL(url).href : url;
    let remoteDocument = cache.get(cacheKey);
    if (remoteDocument == null) {
      remoteDocument = Promise.resolve(documentLoader(url, options)).then(
        cloneRemoteDocument,
      );
      remoteDocument.catch(() => {
        if (cache.get(cacheKey) === remoteDocument) cache.delete(cacheKey);
      });
      cache.set(cacheKey, remoteDocument);
    }
    return cloneRemoteDocument(await remoteDocument);
  };
}

/** @internal */
export function wrapContextLoaderForJsonLd(
  contextLoader: DocumentLoader | undefined,
): DocumentLoader {
  const loader = contextLoader ?? builtInContextLoader;
  return async (url, options) => {
    try {
      return await loader(url, options);
    } catch (error) {
      if (!isInvalidUrlTypeError(error)) throw error;
      if (isClearlyMalformedContextReference(url)) {
        throw new InvalidContextReferenceError(url);
      }
      // Keep generic loader-side Invalid URL failures retryable at JSON-LD
      // parse boundaries.  The same TypeError text is also used by generated
      // ActivityPub decoders for permanently malformed payload IRIs, so only
      // the context-loading layer can safely reinterpret it as transient.
      throw createLoadingRemoteContextFailedError(url, error);
    }
  };
}

/** @internal */
export function getNormalizationContextLoader(
  contextLoader: DocumentLoader | undefined,
): DocumentLoader {
  const loader = wrapContextLoaderForJsonLd(contextLoader);
  return createMemoizedDocumentLoader(async (url, options) => {
    // Normalized LDS documents are compacted against Fedify's built-in context.
    // That does not mean callers are limited to these four contexts overall:
    // extension contexts from the input document still resolve through the
    // caller's loader.  This shortcut only avoids asking the caller to fetch
    // Fedify's own baseline contexts during internal normalization, and only
    // for references that are already parseable as absolute URLs; raw or
    // opaque context ids must still reach the caller's loader unchanged.
    // Keep the resulting loader request-scoped and memoized so the pre-scan
    // and the actual jsonld.compact() call both see the same remote context
    // payload even when the caller's loader is nondeterministic or backed by a
    // cache that may change between awaits.
    if (URL.canParse(url)) {
      const normalizedUrl = new URL(url).href;
      if (localContextUrls.has(normalizedUrl)) {
        return await builtInContextLoader(normalizedUrl, options);
      }
    }
    return await loader(url, options);
  });
}

/** @internal */
export async function compactJsonLd(
  jsonLd: unknown,
  contextLoader: DocumentLoader | undefined,
): Promise<unknown> {
  const hasLds = typeof jsonLd === "object" && jsonLd != null &&
    "signature" in jsonLd;
  const signature = hasLds
    ? (jsonLd as { signature: unknown }).signature
    : undefined;
  const normalizationContextLoader = getNormalizationContextLoader(
    contextLoader,
  );
  const document = hasLds ? detachSignature(jsonLd) : jsonLd;
  // Most unsafe JSON-LD keywords remain visible after compaction and can be
  // rejected on the normalized document.  @graph is the exception: a source
  // document can wrap a single signed node in @graph (or an alias for it), and
  // jsonld.compact() may flatten that wrapper away entirely.  We therefore
  // reject @graph on source terms before compaction using the active JSON-LD
  // context at each object location, then reject the remaining unsafe keywords
  // on the compacted representation.
  // Use the same request-scoped normalization loader here so built-in Fedify
  // contexts do not depend on caller-provided loaders during the pre-scan and
  // the remote context payloads observed by the pre-scan cannot diverge from
  // the ones observed by jsonld.compact() later in this call.
  await assertNoGraphBeforeCompaction(document, normalizationContextLoader);
  const compacted = await jsonld.compact(
    document,
    localContext,
    { documentLoader: normalizationContextLoader },
  );
  if (hasLds && typeof compacted === "object" && compacted != null) {
    // Linked Data Signatures are handled out-of-band by this module.
    (compacted as Record<string, unknown>).signature = signature;
  }
  assertSafeJsonLd(compacted);
  return compacted;
}

interface GraphAliasContextState {
  readonly graphTerms: Set<string>;
  readonly jsonTerms: Set<string>;
  readonly propertyContexts: Map<string, GraphAliasPropertyContext>;
  readonly termTargets: Map<string, string | null>;
}

interface GraphAliasRemoteContext {
  readonly context: unknown;
  readonly baseUrl: string | null;
}

interface GraphAliasPropertyContext {
  readonly context: unknown;
  readonly baseUrl: string | null;
}

type GraphAliasRemoteContextCache = Map<
  string,
  Promise<GraphAliasRemoteContext>
>;

function createInvalidRemoteContextError(
  reference: string,
): Error & { details: { code: string; url: string } } {
  const error = new Error(
    "Dereferencing a URL did not result in a JSON object. " +
      "The response was valid JSON, but it was not a JSON object. " +
      `URL: "${reference}".`,
  ) as Error & { details: { code: string; url: string } };
  error.name = "jsonld.InvalidUrl";
  error.details = {
    code: "invalid remote context",
    url: reference,
  };
  return error;
}

function getRemoteContext(
  remoteDocument: RemoteDocument,
  reference: string,
): GraphAliasRemoteContext {
  const { contextUrl, documentUrl } = remoteDocument;
  let { document } = remoteDocument;
  if (typeof document === "string") {
    // Match jsonld's remote-context loader semantics: string documents are
    // parsed as JSON first, and only the post-parse shape determines whether
    // the failure is a permanent invalid-remote-context defect or a retriable
    // loading failure.
    document = JSON.parse(document) as unknown;
  }
  if (
    typeof document !== "object" || document == null || Array.isArray(document)
  ) {
    throw createInvalidRemoteContextError(reference);
  }
  // Mirror jsonld's remote-context handling so the safety scan classifies
  // permanently invalid remote context documents the same way the actual
  // compaction path does.
  let context: unknown = "@context" in document ? document["@context"] : {};
  if (contextUrl != null) {
    context = Array.isArray(context)
      ? [...context, contextUrl]
      : [context, contextUrl];
  }
  return {
    context,
    baseUrl: documentUrl ?? reference,
  };
}

function createGraphAliasContextState(): GraphAliasContextState {
  return {
    graphTerms: new Set(),
    jsonTerms: new Set(),
    propertyContexts: new Map(),
    termTargets: new Map(),
  };
}

function cloneGraphAliasContextState(
  state: GraphAliasContextState,
): GraphAliasContextState {
  return {
    graphTerms: new Set(state.graphTerms),
    jsonTerms: new Set(state.jsonTerms),
    propertyContexts: new Map(state.propertyContexts),
    termTargets: new Map(state.termTargets),
  };
}

function resolveContextTarget(
  target: string,
  state: GraphAliasContextState,
): string {
  if (target === "@graph") return target;
  const mapped = state.termTargets.get(target);
  if (mapped == null) return target;
  return mapped;
}

function getDirectContextTarget(
  definition: unknown,
): string | null | undefined {
  if (definition === null) return null;
  if (typeof definition === "string") return definition;
  if (
    typeof definition === "object" && definition != null &&
    "@id" in definition
  ) {
    const id = definition["@id"];
    if (id === null) return null;
    if (typeof id === "string") return id;
  }
  return undefined;
}

function isJsonTypedDefinition(definition: unknown): boolean {
  return typeof definition === "object" && definition != null &&
    "@type" in definition && definition["@type"] === "@json";
}

function resolveLocalContextTarget(
  target: string,
  state: GraphAliasContextState,
  localTargets: ReadonlyMap<string, string | null>,
  seen = new Set<string>(),
): string {
  if (target === "@graph") return target;
  if (seen.has(target)) return target;
  seen.add(target);
  if (localTargets.has(target)) {
    const localTarget = localTargets.get(target);
    return localTarget == null
      ? target
      : resolveLocalContextTarget(localTarget, state, localTargets, seen);
  }
  return resolveContextTarget(target, state);
}

function refreshGraphAliases(state: GraphAliasContextState): void {
  state.graphTerms.clear();
  for (const [term, target] of state.termTargets) {
    // termTargets stores the target captured when each local context entry was
    // applied. This preserves JSON-LD's sequential @context array semantics:
    // same-object forward aliases can resolve through local definitions, but
    // later array items do not retroactively rewrite earlier captured terms.
    if (target === "@graph") {
      state.graphTerms.add(term);
    }
  }
}

function normalizeContextReference(
  reference: string,
  baseUrl: string | null,
): string {
  // Preserve raw top-level opaque ids so deployment-specific loaders can
  // resolve them.  Once a remote context has established a document URL,
  // however, nested relative @context/@import references should follow
  // JSON-LD's normal base-URL resolution semantics before reaching the
  // caller's loader.
  if (baseUrl != null) {
    return new URL(reference, baseUrl).href;
  }
  return URL.canParse(reference) ? new URL(reference).href : reference;
}

/** @internal */
export function isInvalidUrlTypeError(error: unknown): error is TypeError {
  const code = (error as { code?: unknown }).code;
  return error instanceof TypeError &&
    (code === "ERR_INVALID_URL" ||
      error.message === "Invalid URL string." ||
      /^Invalid URL(?::|$)/.test(error.message) ||
      / cannot be parsed as a URL\.?$/.test(error.message));
}

async function applyGraphAliasContext(
  state: GraphAliasContextState,
  context: unknown,
  documentLoader: DocumentLoader,
  remoteContextCache: GraphAliasRemoteContextCache,
  baseUrl: string | null = null,
  processingContexts = new Set<string>(),
): Promise<GraphAliasContextState> {
  if (context === null) {
    // Explicit null resets the active JSON-LD context for the current object.
    // The pre-compaction graph-alias scan must mirror that scope boundary so
    // aliases like g -> @graph do not leak into fenced-off nested data.
    return createGraphAliasContextState();
  }
  let nextState = cloneGraphAliasContextState(state);
  if (Array.isArray(context)) {
    for (const item of context) {
      nextState = await applyGraphAliasContext(
        nextState,
        item,
        documentLoader,
        remoteContextCache,
        baseUrl,
        processingContexts,
      );
    }
    return nextState;
  }
  if (typeof context === "string") {
    const reference = normalizeContextReference(context, baseUrl);
    const cacheKey = `${baseUrl ?? ""}\n${reference}`;
    if (processingContexts.has(cacheKey)) return nextState;
    processingContexts.add(cacheKey);
    try {
      let remoteContext = remoteContextCache.get(cacheKey);
      if (remoteContext == null) {
        // Reuse the fetched remote document across the whole scan while still
        // re-applying it against the caller's current JSON-LD context state.
        remoteContext = (async () => {
          try {
            return getRemoteContext(
              await documentLoader(reference),
              reference,
            );
          } catch (error) {
            if (
              reference === context &&
              isInvalidUrlTypeError(error) &&
              isClearlyMalformedContextReference(context)
            ) {
              // Only classify raw string references as permanently invalid
              // when the string itself is clearly broken.  Deployment-specific
              // loaders may still resolve opaque or relative identifiers
              // through non-URL backends and may transiently surface the same
              // generic TypeError("Invalid URL ...") while doing so.
              throw new InvalidContextReferenceError(context);
            }
            throw error;
          }
        })();
        remoteContextCache.set(cacheKey, remoteContext);
      }
      const loadedRemoteContext = await remoteContext;
      return await applyGraphAliasContext(
        nextState,
        loadedRemoteContext.context,
        documentLoader,
        remoteContextCache,
        loadedRemoteContext.baseUrl,
        processingContexts,
      );
    } finally {
      processingContexts.delete(cacheKey);
    }
  }
  if (typeof context === "object" && context != null) {
    if ("@import" in context && typeof context["@import"] === "string") {
      nextState = await applyGraphAliasContext(
        nextState,
        context["@import"],
        documentLoader,
        remoteContextCache,
        baseUrl,
        processingContexts,
      );
    }
    const localTargets = new Map<string, string | null>();
    for (const [term, definition] of globalThis.Object.entries(context)) {
      if (term.startsWith("@")) continue;
      const target = getDirectContextTarget(definition);
      if (target == null) {
        localTargets.set(term, null);
      } else if (typeof target === "string") {
        localTargets.set(term, target);
      } else {
        localTargets.delete(term);
      }
    }
    for (const [term, definition] of globalThis.Object.entries(context)) {
      if (term.startsWith("@")) continue;
      if (localTargets.has(term)) {
        const directTarget = localTargets.get(term);
        if (directTarget == null) {
          nextState.termTargets.set(term, null);
        } else {
          nextState.termTargets.set(
            term,
            resolveLocalContextTarget(directTarget, nextState, localTargets),
          );
        }
      } else {
        nextState.termTargets.delete(term);
      }
      if (
        typeof definition === "object" && definition != null &&
        "@context" in definition
      ) {
        // Property-scoped contexts can carry relative remote references whose
        // meaning depends on the document URL of the context that declared
        // them. Preserve that base so the pre-compaction replay below sees the
        // same resolution scope as jsonld's actual context processing.
        nextState.propertyContexts.set(term, {
          context: definition["@context"],
          baseUrl,
        });
      } else {
        nextState.propertyContexts.delete(term);
      }
      if (isJsonTypedDefinition(definition)) {
        nextState.jsonTerms.add(term);
      } else {
        nextState.jsonTerms.delete(term);
      }
    }
    refreshGraphAliases(nextState);
  }
  return nextState;
}

async function assertNoGraphBeforeCompaction(
  jsonLd: unknown,
  documentLoader: DocumentLoader,
  inheritedState = createGraphAliasContextState(),
  propertyContext?: GraphAliasPropertyContext,
  remoteContextCache: GraphAliasRemoteContextCache = new Map(),
): Promise<void> {
  if (Array.isArray(jsonLd)) {
    for (const item of jsonLd) {
      await assertNoGraphBeforeCompaction(
        item,
        documentLoader,
        inheritedState,
        propertyContext,
        remoteContextCache,
      );
    }
    return;
  }
  if (typeof jsonLd !== "object" || jsonLd == null) return;
  const jsonLiteralWrapper = isJsonLiteralWrapper(
    jsonLd as Record<string, unknown>,
  );
  let state = inheritedState;
  if (propertyContext !== undefined) {
    // Re-apply property-scoped contexts with the base URL they were declared
    // under. Otherwise relative child contexts from remote documents would be
    // replayed as raw strings and misclassified as invalid before compaction.
    state = await applyGraphAliasContext(
      state,
      propertyContext.context,
      documentLoader,
      remoteContextCache,
      propertyContext.baseUrl,
    );
  }
  if ("@context" in jsonLd) {
    state = await applyGraphAliasContext(
      state,
      jsonLd["@context"],
      documentLoader,
      remoteContextCache,
    );
  }
  for (const [key, value] of globalThis.Object.entries(jsonLd)) {
    if (key === "@context") continue;
    if (jsonLiteralWrapper && key === "@value") continue;
    if (key === "@graph" || state.graphTerms.has(key)) {
      throw new UnsafeJsonLdError("@graph");
    }
    if (state.jsonTerms.has(key)) continue;
    await assertNoGraphBeforeCompaction(
      value,
      documentLoader,
      state,
      state.propertyContexts.get(key),
      remoteContextCache,
    );
  }
}

function isJsonLiteralWrapper(value: Record<string, unknown>): boolean {
  return "@value" in value &&
    (value["@type"] === "@json" || value.type === "@json");
}

/** @internal */
export function assertSafeJsonLd(jsonLd: unknown): void {
  if (Array.isArray(jsonLd)) {
    for (const item of jsonLd) assertSafeJsonLd(item);
  } else if (typeof jsonLd === "object" && jsonLd != null) {
    const jsonLiteralWrapper = isJsonLiteralWrapper(
      jsonLd as Record<string, unknown>,
    );
    for (const [key, value] of globalThis.Object.entries(jsonLd)) {
      if (disallowedJsonLdKeywords.has(key)) throw new UnsafeJsonLdError(key);
      if (jsonLiteralWrapper && key === "@value") continue;
      assertSafeJsonLd(value);
    }
  }
}

const signatureTermDefinition = {
  "signature": "https://w3id.org/security#signature",
} as const;
const signatureDefiningContexts: ReadonlySet<string> = new Set([
  "https://w3id.org/identity/v1",
  "https://w3id.org/security/v1",
]);
// Preloaded contexts that do not define `signature`.  Unrecognized remote
// contexts stay out of this set, since resolving them requires a loader that
// attachSignature() does not have.
const signatureFreeContexts: ReadonlySet<string> = getSignatureFreeContexts();

function getSignatureFreeContexts(): ReadonlySet<string> {
  const urls = new Set<string>();
  for (
    const [url, document] of globalThis.Object.entries(preloadedContexts)
  ) {
    if (typeof document !== "object" || document == null) continue;
    const context = (document as Record<string, unknown>)["@context"];
    if (
      typeof context !== "object" || context == null || Array.isArray(context)
    ) {
      continue;
    }
    const record = context as Record<string, unknown>;
    if (
      !globalThis.Object.prototype.hasOwnProperty.call(record, "signature")
    ) {
      urls.add(url);
    }
  }
  return urls;
}

type SignatureTermState = "defined" | "absent" | "unknown";
type ContextEntryEffect = "defines" | "resets" | "absent" | "unknown";

function getContextEntryEffect(entry: unknown): ContextEntryEffect {
  if (entry == null) return "resets";
  if (typeof entry === "string") {
    if (signatureDefiningContexts.has(entry)) return "defines";
    if (signatureFreeContexts.has(entry)) return "absent";
    return "unknown";
  }
  if (typeof entry !== "object") return "absent";
  const record = entry as Record<string, unknown>;
  if (globalThis.Object.prototype.hasOwnProperty.call(record, "signature")) {
    const definition = record["signature"];
    const contextProtected = record["@protected"] === true;
    const imported = globalThis.Object.prototype.hasOwnProperty.call(
      record,
      "@import",
    );
    if (definition == null) {
      if (contextProtected) return "defines";
      // An imported context may protect the term through @protected.
      return imported ? "unknown" : "resets";
    }
    if (typeof definition === "object" && !Array.isArray(definition)) {
      const term = definition as Record<string, unknown>;
      const protectedTerm = contextProtected || term["@protected"] === true;
      if (
        globalThis.Object.prototype.hasOwnProperty.call(term, "@id") &&
        term["@id"] == null
      ) {
        if (protectedTerm) return "defines";
        // An imported context may protect the null definition.
        return imported ? "unknown" : "resets";
      }
    }
    return "defines";
  }
  if (globalThis.Object.prototype.hasOwnProperty.call(record, "@import")) {
    return "unknown";
  }
  return "absent";
}

function getSignatureTermState(context: unknown): SignatureTermState {
  if (context == null) return "absent";
  if (!Array.isArray(context)) {
    const effect = getContextEntryEffect(context);
    return effect === "defines"
      ? "defined"
      : effect === "unknown"
      ? "unknown"
      : "absent";
  }
  let state: SignatureTermState = "absent";
  for (const entry of context) {
    const effect = getContextEntryEffect(entry);
    if (effect === "defines") {
      state = "defined";
    } else if (effect === "resets") {
      state = "absent";
    } else if (effect === "unknown" && state !== "defined") {
      state = "unknown";
    }
  }
  return state;
}

function prepareSignatureDocument(jsonLd: unknown): unknown {
  if (typeof jsonLd !== "object" || jsonLd == null || Array.isArray(jsonLd)) {
    return jsonLd;
  }
  const document = jsonLd as Record<string, unknown>;
  // A proof covers the literal JSON, including the @context.  Adding a term
  // would invalidate it, so leave proof-bearing documents unchanged.
  if (document["proof"] != null) return { ...document };
  const context = document["@context"];
  // An unknown remote context may already define `signature`, possibly as a
  // protected term, so leave it unchanged rather than risk redefining it.
  if (getSignatureTermState(context) !== "absent") return { ...document };
  // Copy the template so callers that mutate the returned document cannot
  // change the definition used by later signing calls.
  const definition = { ...signatureTermDefinition };
  return {
    ...document,
    "@context": context == null
      ? [definition]
      : Array.isArray(context)
      ? [...context, definition]
      : [context, definition],
  };
}

/**
 * A signature of a JSON-LD document.
 * @since 1.0.0
 */
export interface Signature {
  "@context"?:
    | "https://w3id.org/identity/v1"
    | "https://w3id.org/security/v1";
  type: "RsaSignature2017";
  id?: string;
  creator: string;
  created: string;
  signatureValue: string;
}

/**
 * Attaches a LD signature to the given JSON-LD document.
 *
 * When the document's context does not already define the `signature`
 * property, the returned document adds a minimal inline context for it.
 * Without that definition, expanding the attached signature would produce a
 * blank node predicate, which is not valid RDF.  Documents that already carry
 * a `proof` are left unchanged, since a new context definition would invalidate
 * the proof.  Documents whose context includes an unrecognized remote context
 * are also left unchanged, since that context may already define `signature`.
 * @param jsonLd The JSON-LD document to attach the signature to.  It is not
 *               modified.
 * @param signature The signature to attach.
 * @returns The JSON-LD document with the attached signature.
 * @throws {TypeError} If the input document is not a valid JSON-LD document.
 *                    Top-level arrays are rejected, since a Linked Data
 *                    Signature is attached to a single node.
 * @since 1.0.0
 */
export function attachSignature(
  jsonLd: unknown,
  signature: Signature,
): { signature: Signature } & Record<string, unknown> {
  if (
    typeof jsonLd !== "object" || jsonLd == null || Array.isArray(jsonLd)
  ) {
    throw new TypeError(
      "Failed to attach signature; invalid JSON-LD document.",
    );
  }
  const document = jsonLd as Record<string, unknown>;
  const output = prepareSignatureDocument(document) as {
    signature: Signature;
  } & Record<string, unknown>;
  output.signature = signature;
  return output;
}

/**
 * Options for creating Linked Data Signatures.
 * @since 1.0.0
 */
export interface CreateSignatureOptions {
  /**
   * The context loader for loading remote JSON-LD contexts.
   */
  contextLoader?: DocumentLoader;

  /**
   * The time when the signature was created.  If not specified, the current
   * time will be used.
   */
  created?: Temporal.Instant;
}

/**
 * Creates a LD signature for the given JSON-LD document.
 *
 * If the document's context does not define the `signature` property, the
 * signature is computed over the document with a minimal inline definition
 * added.  Use {@link attachSignature} to attach the signature to that exact
 * document.  Documents that already carry a `proof`, or whose context includes
 * an unrecognized remote context, are hashed unchanged.
 * @param jsonLd The JSON-LD document to sign.
 * @param privateKey The private key to sign the document.
 * @param keyId The ID of the public key that corresponds to the private key.
 * @param options Additional options for creating the signature.
 *                See also {@link CreateSignatureOptions}.
 * @return The created signature.
 * @throws {TypeError} If the private key is invalid or unsupported.
 * @since 1.0.0
 */
export async function createSignature(
  jsonLd: unknown,
  privateKey: CryptoKeyLike,
  keyId: URL,
  { contextLoader, created }: CreateSignatureOptions = {},
): Promise<Signature> {
  validateCryptoKey(privateKey, "private");
  if (privateKey.algorithm.name !== "RSASSA-PKCS1-v1_5") {
    throw new TypeError("Unsupported algorithm: " + privateKey.algorithm.name);
  }
  const options = {
    creator: keyId.href,
    created: created?.toString() ?? new Date().toISOString(),
  };
  // The signature options are hashed against identity/v1 because that is the
  // context Linked Data Signature verifiers, including Mastodon, reconstruct
  // when they verify.  The context no longer resolves, so the attached
  // signature advertises security/v1 instead, which defines the same terms.
  const optionsHash = await hashJsonLd(
    { "@context": "https://w3id.org/identity/v1", ...options },
    contextLoader,
  );
  const docHash = await hashJsonLd(
    prepareSignatureDocument(jsonLd),
    contextLoader,
  );
  const message = optionsHash + docHash;
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(message);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    asCryptoKey(privateKey),
    messageBytes,
  );
  return {
    "@context": "https://w3id.org/security/v1",
    ...options,
    type: "RsaSignature2017",
    signatureValue: encodeBase64(signature),
  };
}

/**
 * Options for signing JSON-LD documents.
 * @since 1.0.0
 */
export interface SignJsonLdOptions extends CreateSignatureOptions {
  /**
   * The OpenTelemetry tracer provider for tracing the signing process.
   * If omitted, the global tracer provider is used.
   * @since 1.3.0
   */
  tracerProvider?: TracerProvider;
}

/**
 * Signs the given JSON-LD document with the private key and returns the signed
 * JSON-LD document.
 * @param jsonLd The JSON-LD document to sign.
 * @param privateKey The private key to sign the document.
 * @param keyId The key ID to use in the signature.  It will be used by the
 *              verifier to fetch the corresponding public key.
 * @param options Additional options for signing the document.
 *                See also {@link SignJsonLdOptions}.
 * @returns The signed JSON-LD document.
 * @throws {TypeError} If the private key is invalid or unsupported.
 * @since 1.0.0
 */
export async function signJsonLd(
  jsonLd: unknown,
  privateKey: CryptoKeyLike,
  keyId: URL,
  options: SignJsonLdOptions,
): Promise<{ signature: Signature }> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  return await tracer.startActiveSpan(
    "ld_signatures.sign",
    {
      attributes: { "ld_signatures.key_id": keyId.href },
    },
    async (span) => {
      try {
        const signature = await createSignature(
          jsonLd,
          privateKey,
          keyId,
          options,
        );
        if (span.isRecording()) {
          span.setAttribute("ld_signatures.type", signature.type);
          span.setAttribute(
            "ld_signatures.signature",
            encodeHex(decodeBase64(signature.signatureValue)),
          );
        }
        return attachSignature(jsonLd, signature);
      } catch (error) {
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

interface SignedJsonLd {
  signature: Signature;
}

interface VerifiableSignature {
  type: "RsaSignature2017";
  creator: string;
  created?: string;
  signatureValue: string;
}

/** @internal */
export function hasVerifiableSignature(
  jsonLd: unknown,
): jsonLd is { signature: VerifiableSignature } {
  if (
    typeof jsonLd !== "object" || jsonLd == null || Array.isArray(jsonLd) ||
    !("signature" in jsonLd)
  ) return false;
  const signature = jsonLd.signature;
  if (
    typeof signature !== "object" || signature == null ||
    Array.isArray(signature)
  ) return false;
  return "type" in signature && signature.type === "RsaSignature2017" &&
    "creator" in signature && typeof signature.creator === "string" &&
    (!("created" in signature) || typeof signature.created === "string") &&
    "signatureValue" in signature &&
    typeof signature.signatureValue === "string";
}

/** @internal */
export function describeSignatureShape(jsonLd: unknown): {
  signatureKind: string;
  signatureProperties: string[];
  signaturePropertyCount: number;
} | null {
  if (
    typeof jsonLd !== "object" || jsonLd == null || !("signature" in jsonLd)
  ) return null;
  const signature = jsonLd.signature;
  const properties = typeof signature === "object" && signature != null
    ? globalThis.Object.keys(signature)
    : [];
  return {
    signatureKind: signature == null
      ? String(signature)
      : Array.isArray(signature)
      ? "array"
      : typeof signature,
    signatureProperties: properties.sort().slice(0, 20).map((p) =>
      p.slice(0, 80)
    ),
    signaturePropertyCount: properties.length,
  };
}

/**
 * Checks if the given JSON-LD document has a Linked Data Signature.
 * @param jsonLd The JSON-LD document to check.
 * @returns `true` if the document has a signature; `false` otherwise.
 * @since 1.0.0
 */
export function hasSignature(jsonLd: unknown): jsonLd is SignedJsonLd {
  if (typeof jsonLd !== "object" || jsonLd == null) return false;
  if ("signature" in jsonLd) {
    const signature = jsonLd.signature;
    if (typeof signature !== "object" || signature == null) return false;
    return "type" in signature && signature.type === "RsaSignature2017" &&
      "creator" in signature && typeof signature.creator === "string" &&
      "created" in signature && typeof signature.created === "string" &&
      "signatureValue" in signature &&
      typeof signature.signatureValue === "string";
  }
  return false;
}

/**
 * Detaches Linked Data Signatures from the given JSON-LD document.
 * @param jsonLd The JSON-LD document to modify.
 * @returns The modified JSON-LD document.  If the input document does not
 *          contain a signature, the original document is returned.
 * @since 1.0.0
 */
export function detachSignature(jsonLd: unknown): unknown {
  if (typeof jsonLd !== "object" || jsonLd == null) return jsonLd;
  const doc: { signature?: unknown } = { ...jsonLd };
  delete doc.signature;
  return doc;
}

/**
 * Options for verifying Linked Data Signatures.
 * @since 1.0.0
 */
export interface VerifySignatureOptions {
  /**
   * The document loader to use for fetching the public key.
   */
  documentLoader?: DocumentLoader;

  /**
   * The context loader to use for JSON-LD context retrieval.
   */
  contextLoader?: DocumentLoader;

  /**
   * The key cache to use for caching public keys.
   */
  keyCache?: KeyCache;

  /**
   * The OpenTelemetry tracer provider for tracing the verification process.
   * If omitted, the global tracer provider is used.
   * @since 1.3.0
   */
  tracerProvider?: TracerProvider;
}

/**
 * Verifies Linked Data Signatures of the given JSON-LD document.
 * Unmapped properties discarded during JSON-LD processing are tolerated, but
 * their values are not authenticated by the signature.  Other unsafe
 * canonicalization warnings, including relative IRIs, remain rejected.
 * @param jsonLd The JSON-LD document to verify.
 * @param options Options for verifying the signature.
 * @returns The public key that signed the document or `null` if the signature
 *          is invalid or the key is not found.
 * @since 1.0.0
 */
export async function verifySignature(
  jsonLd: unknown,
  options: VerifySignatureOptions = {},
): Promise<CryptographicKey | null> {
  if (!hasVerifiableSignature(jsonLd)) {
    const shape = describeSignatureShape(jsonLd);
    if (shape != null) {
      logger.debug(
        "Linked Data Signature has an unsupported shape: {signatureKind}; " +
          "properties: {signatureProperties}.",
        shape,
      );
    }
    return null;
  }
  const sig = jsonLd.signature;
  let signature: Uint8Array;
  try {
    signature = decodeBase64(sig.signatureValue);
  } catch (error) {
    logger.debug(
      "Failed to verify; invalid base64 signatureValue: {signatureValue}",
      { ...sig, error },
    );
    return null;
  }
  let creator: URL;
  try {
    creator = new URL(sig.creator);
  } catch {
    logger.debug("Failed to verify; signature creator is not a valid URL.");
    return null;
  }
  const { key, cached } = await fetchKey(
    creator,
    CryptographicKey,
    options,
  );
  if (key == null) return null;
  const sigOpts: {
    "@context": string;
    type?: string;
    id?: string;
    signatureValue?: string;
  } = {
    ...sig,
    "@context": "https://w3id.org/identity/v1",
  };
  delete sigOpts.type;
  delete sigOpts.id;
  delete sigOpts.signatureValue;
  let sigOptsHash: string;
  try {
    sigOptsHash = await hashJsonLd(sigOpts, options.contextLoader, "verify");
  } catch (error) {
    logger.warn(
      "Failed to verify; failed to hash the signature options: {signatureOptions}\n{error}",
      { signatureOptions: sigOpts, error },
    );
    return null;
  }
  const document: { signature?: unknown } = { ...jsonLd };
  delete document.signature;
  let docHash: string;
  try {
    docHash = await hashJsonLd(document, options.contextLoader, "verify");
  } catch (error) {
    logger.warn(
      "Failed to verify; failed to hash the document: {document}\n{error}",
      { document, error },
    );
    return null;
  }
  const encoder = new TextEncoder();
  const message = sigOptsHash + docHash;
  const messageBytes = encoder.encode(message);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key.publicKey,
    signature.slice(),
    messageBytes,
  );
  if (verified) return key;
  if (cached) {
    logger.debug(
      "Failed to verify with the cached key {keyId}; " +
        "signature {signatureValue} is invalid.  " +
        "Retrying with the freshly fetched key...",
      { keyId: sig.creator, ...sig },
    );
    const { key } = await fetchKey(
      creator,
      CryptographicKey,
      {
        ...options,
        keyCache: {
          get: () => Promise.resolve(undefined),
          set: async (keyId, key) => await options.keyCache?.set(keyId, key),
        },
      },
    );
    if (key == null) return null;
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key.publicKey,
      signature.slice(),
      messageBytes,
    );
    return verified ? key : null;
  }
  logger.debug(
    "Failed to verify with the fetched key {keyId}; " +
      "signature {signatureValue} is invalid.  " +
      "Check if the key is correct or if the signed message is correct.  " +
      "The message to sign is:\n{message}",
    { keyId: sig.creator, ...sig, message },
  );
  return null;
}

/**
 * Options for verifying JSON-LD documents.
 */
export interface VerifyJsonLdOptions extends VerifySignatureOptions {
}

/**
 * Verify the authenticity of the given JSON-LD document using Linked Data
 * Signatures.  If the document is signed, this function verifies the signature
 * and checks if the document is attributed to the owner of the public key.
 * If the document is not signed, this function returns `false`.
 * Unmapped properties discarded during JSON-LD processing are not
 * authenticated, even when verification succeeds.
 * @param jsonLd The JSON-LD document to verify.
 * @param options Options for verifying the document.
 * @returns `true` if the document is authentic; `false` otherwise.
 */
export async function verifyJsonLd(
  jsonLd: unknown,
  options: VerifyJsonLdOptions = {},
): Promise<boolean> {
  return await verifyJsonLdInternal(jsonLd, options, true);
}

/** @internal */
export async function verifyCompactJsonLd(
  jsonLd: unknown,
  options: VerifyJsonLdOptions = {},
): Promise<boolean> {
  return await verifyJsonLdInternal(jsonLd, options, false);
}

async function verifyJsonLdInternal(
  jsonLd: unknown,
  options: VerifyJsonLdOptions,
  compact: boolean,
): Promise<boolean> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  return await tracer.startActiveSpan(
    "ld_signatures.verify",
    async (span) => {
      try {
        const hasLdSignature = hasVerifiableSignature(jsonLd);
        const verificationOptions = hasLdSignature
          ? {
            ...options,
            contextLoader: getNormalizationContextLoader(options.contextLoader),
          }
          : options;
        const compacted = compact
          ? hasLdSignature
            ? await compactJsonLd(jsonLd, options.contextLoader)
            : jsonLd
          : jsonLd;
        const object = await Object.fromJsonLd(compacted, verificationOptions);
        if (object.id != null) {
          span.setAttribute("activitypub.object.id", object.id.href);
        }
        span.setAttribute("activitypub.object.type", getTypeId(object).href);
        if (
          typeof jsonLd === "object" && jsonLd != null &&
          "signature" in jsonLd && typeof jsonLd.signature === "object" &&
          jsonLd.signature != null
        ) {
          if (
            "creator" in jsonLd.signature &&
            typeof jsonLd.signature.creator === "string"
          ) {
            span.setAttribute(
              "ld_signatures.key_id",
              jsonLd.signature.creator,
            );
          }
          if (
            "signatureValue" in jsonLd.signature &&
            typeof jsonLd.signature.signatureValue === "string"
          ) {
            span.setAttribute(
              "ld_signatures.signature",
              jsonLd.signature.signatureValue,
            );
          }
          if (
            "type" in jsonLd.signature &&
            typeof jsonLd.signature.type === "string"
          ) {
            span.setAttribute("ld_signatures.type", jsonLd.signature.type);
          }
        }
        const attributions = new Set(
          object.attributionIds.map((uri) => uri.href),
        );
        if (object instanceof Activity) {
          for (const uri of object.actorIds) attributions.add(uri.href);
        }
        const key = await verifySignature(compacted, verificationOptions);
        if (key == null) return false;
        if (key.ownerId == null) {
          logger.debug("Key {keyId} has no owner.", { keyId: key.id?.href });
          return false;
        }
        attributions.delete(key.ownerId.href);
        if (attributions.size > 0) {
          logger.debug(
            "Some attributions are not authenticated by the Linked Data " +
              "Signatures: {attributions}.",
            { attributions: [...attributions] },
          );
          return false;
        }
        return true;
      } catch (error) {
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

const tolerableVerificationWarnings = new Set([
  "blank node predicate",
  "invalid property",
]);

function handleVerificationEvent({ event, next }: {
  event: { level: string; code: string };
  next: () => void;
}): void {
  // These unmapped properties are dropped by both RDF conversion and the
  // vocabulary parser.  Other warnings, especially relative IRIs that the
  // parser may resolve, can hide changes to fields the application interprets.
  if (
    event.level === "warning" && !tolerableVerificationWarnings.has(event.code)
  ) {
    throw new TypeError(
      `Unsafe JSON-LD canonicalization warning: ${event.code}`,
    );
  }
  next();
}

async function hashJsonLd(
  jsonLd: unknown,
  contextLoader: DocumentLoader | undefined,
  mode: "sign" | "verify" = "sign",
): Promise<string> {
  const canon = await jsonld.canonize(jsonLd, {
    format: "application/n-quads",
    documentLoader: contextLoader ?? getDocumentLoader(),
    // jsonld's safe handler runs before custom handlers.  Replace it only on
    // verification so senders can sign graphs with unmapped properties, while
    // outbound signing continues to reject every unsafe warning.
    safe: mode === "sign",
    eventHandler: mode === "verify" ? handleVerificationEvent : undefined,
  });
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(canon));
  return encodeHex(hash);
}

// cSpell: ignore URGNA2012
