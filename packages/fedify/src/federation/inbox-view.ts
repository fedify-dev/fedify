/**
 * The interpretation of an incoming activity that Fedify authenticated, kept
 * so that listeners, authorization helpers, and queue workers observe the
 * same JSON-LD meaning that signature verification observed.
 *
 * Every JSON-LD processing step of one delivery goes through a request-scoped
 * *context snapshot*, which memoizes the remote context responses so that
 * a nondeterministic or mutable remote context cannot give verification and
 * dispatch different meanings.  The snapshot is serialized into queued
 * messages, so that workers and retries replay the very same responses
 * without loading contexts again.
 * @module
 */
import {
  type DocumentLoader,
  preloadedContexts,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import { encodeHex } from "byte-encodings/hex";
import serialize from "json-canon";
import {
  detachSignature,
  type EffectiveContextLoaderPolicy,
  getNormalizationContextLoader,
  markEffectiveContextLoader,
  wrapContextLoaderForJsonLd,
} from "../sig/ld.ts";

/**
 * A context response that a delivery's interpretation used.
 * @internal
 */
export interface ContextSnapshotEntry {
  readonly policy: EffectiveContextLoaderPolicy;
  /** The normalized URL the response was requested for. */
  readonly url: string;
  readonly response: RemoteDocument;
}

/**
 * A {@link ContextSnapshotEntry} as stored in a queued message.  A response
 * that equals the one Fedify bundles for the URL is stored as a reference to
 * the bundled context, along with its hash for diagnostics.
 * @internal
 */
export type SerializedContextSnapshotEntry =
  & {
    readonly policy: EffectiveContextLoaderPolicy;
    readonly url: string;
    /** The SHA-256 of the canonical JSON of the whole response. */
    readonly sha256: string;
  }
  & (
    | { readonly bundled: true }
    | { readonly response: RemoteDocument }
  );

/**
 * Thrown when replaying an interpretation needs a context response that its
 * snapshot does not have, or has with a different content.
 * @internal
 */
export class ContextSnapshotMissError extends Error {
  readonly url: string;

  constructor(url: string, reason: string) {
    super(`Context ${url} cannot be replayed: ${reason}.`);
    this.name = "ContextSnapshotMissError";
    this.url = url;
  }
}

/**
 * The context snapshot of one delivery.
 * @internal
 */
export interface ContextSnapshot {
  /**
   * Gets the effective context loader of a policy, going through the
   * snapshot.  The loader is marked so that Fedify's JSON-LD helpers use it
   * as is instead of wrapping it again.
   * @param policy The loader policy.
   */
  loader(policy: EffectiveContextLoaderPolicy): DocumentLoader;

  /** The successful responses recorded so far. */
  entries(): readonly ContextSnapshotEntry[];

  /**
   * Turns the snapshot's loaders into pass-throughs to the underlying
   * effective loaders.  Objects parsed during the delivery keep their
   * loaders for later dereferences, which then load contexts normally.
   */
  release(): void;
}

function normalizeUrl(url: string): string {
  return URL.canParse(url) ? new URL(url).href : url;
}

/**
 * Creates the context snapshot of a delivery.
 * @param base The caller's context loader.
 * @returns The snapshot.
 * @internal
 */
export function createContextSnapshot(
  base: DocumentLoader | undefined,
): ContextSnapshot {
  const underlying: Record<EffectiveContextLoaderPolicy, DocumentLoader> = {
    standard: wrapContextLoaderForJsonLd(base),
    normalization: getNormalizationContextLoader(base),
  };
  const cache = new Map<string, Promise<RemoteDocument>>();
  const recorded = new Map<string, ContextSnapshotEntry>();
  const loaders = new Map<EffectiveContextLoaderPolicy, DocumentLoader>();
  let released = false;
  return {
    loader(policy) {
      let loader = loaders.get(policy);
      if (loader != null) return loader;
      const effective = underlying[policy];
      loader = markEffectiveContextLoader(async (url, options) => {
        if (released) return await effective(url, options);
        const normalizedUrl = normalizeUrl(url);
        const key = `${policy}\n${normalizedUrl}`;
        let promise = cache.get(key);
        if (promise == null) {
          // Rejections are memoized too: a context that failed once in this
          // delivery must not succeed later with another document.
          promise = Promise.resolve(effective(url, options)).then(
            (response) => {
              // A `tag` would let jsonld.js cache the context across
              // operations without asking this loader again, which would
              // keep it out of the snapshot:
              const cloned = normalizeResponse(structuredClone(response));
              recorded.set(key, {
                policy,
                url: normalizedUrl,
                response: structuredClone(cloned),
              });
              return cloned;
            },
          );
          promise.catch(() => {});
          cache.set(key, promise);
        }
        return structuredClone(await promise);
      }, policy);
      loaders.set(policy, loader);
      return loader;
    },
    entries() {
      return [...recorded.values()];
    },
    release() {
      released = true;
    },
  };
}

function getBundledResponse(url: string): RemoteDocument | null {
  if (!(url in preloadedContexts)) return null;
  return {
    contextUrl: null,
    document: preloadedContexts[url],
    documentUrl: url,
  };
}

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serialize(value)),
  );
  return encodeHex(digest);
}

function normalizeResponse(response: RemoteDocument): RemoteDocument {
  return {
    contextUrl: response.contextUrl ?? null,
    document: response.document,
    documentUrl: response.documentUrl,
  };
}

/**
 * Serializes the entries of a context snapshot for a queued message.
 * @param entries The entries.
 * @returns The serialized entries, which are plain JSON values.
 * @internal
 */
export async function serializeContextSnapshot(
  entries: readonly ContextSnapshotEntry[],
): Promise<SerializedContextSnapshotEntry[]> {
  const result: SerializedContextSnapshotEntry[] = [];
  for (const entry of entries) {
    const response = normalizeResponse(entry.response);
    const hash = await sha256(response);
    const bundled = getBundledResponse(entry.url);
    if (bundled != null && await sha256(bundled) === hash) {
      result.push({
        policy: entry.policy,
        url: entry.url,
        sha256: hash,
        bundled: true,
      });
    } else {
      result.push({
        policy: entry.policy,
        url: entry.url,
        sha256: hash,
        response: structuredClone(response),
      });
    }
  }
  return result;
}

function isRemoteDocument(value: unknown): value is RemoteDocument {
  if (value == null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.documentUrl === "string" && "document" in record &&
    (record.contextUrl == null || typeof record.contextUrl === "string");
}

/**
 * Restores the entries of a serialized context snapshot, verifying the
 * hashes of stored responses.  Bundled entries are reconstructed from the
 * contexts this version of Fedify bundles.
 * @param entries The serialized entries.
 * @returns The entries.
 * @throws {ContextSnapshotMissError} If an entry is malformed, or its
 *                                    content does not match its hash.
 * @internal
 */
export async function deserializeContextSnapshot(
  entries: unknown,
): Promise<ContextSnapshotEntry[]> {
  if (!Array.isArray(entries)) {
    throw new ContextSnapshotMissError("(snapshot)", "malformed snapshot");
  }
  const result: ContextSnapshotEntry[] = [];
  for (const entry of entries) {
    if (
      entry == null || typeof entry !== "object" ||
      (entry.policy !== "standard" && entry.policy !== "normalization") ||
      typeof entry.url !== "string" || typeof entry.sha256 !== "string"
    ) {
      throw new ContextSnapshotMissError("(snapshot)", "malformed entry");
    }
    let response: RemoteDocument | null;
    if (entry.bundled === true) {
      response = getBundledResponse(entry.url);
      if (response == null) {
        throw new ContextSnapshotMissError(entry.url, "not bundled");
      }
    } else if (isRemoteDocument(entry.response)) {
      response = normalizeResponse(entry.response);
    } else {
      throw new ContextSnapshotMissError(entry.url, "malformed entry");
    }
    // A bundled context may change between Fedify versions, e.g., with
    // a term the activity does not use; the digest of the expanded activity,
    // which restoreVerifiedActivityView() checks, tells whether the meaning of
    // the activity changed.  Other responses are stored as they were:
    if (entry.bundled !== true && await sha256(response) !== entry.sha256) {
      throw new ContextSnapshotMissError(entry.url, "content mismatch");
    }
    result.push({
      policy: entry.policy,
      url: entry.url,
      response: structuredClone(response),
    });
  }
  return result;
}

/**
 * Creates a context loader of a policy that serves only the responses of
 * a snapshot.  It is marked as the effective loader of the policy.
 * @param entries The snapshot's entries.
 * @param policy The policy.
 * @returns The loader, which throws {@link ContextSnapshotMissError} for
 *          anything else.
 * @internal
 */
export function createSnapshotOnlyLoader(
  entries: readonly ContextSnapshotEntry[],
  policy: EffectiveContextLoaderPolicy,
): DocumentLoader {
  const responses = new Map<string, RemoteDocument>();
  for (const entry of entries) {
    if (entry.policy === policy) responses.set(entry.url, entry.response);
  }
  // deno-lint-ignore require-await
  return markEffectiveContextLoader(async (url) => {
    const response = responses.get(normalizeUrl(url));
    if (response == null) {
      throw new ContextSnapshotMissError(url, "not in the snapshot");
    }
    return structuredClone(response);
  }, policy);
}

/**
 * A context loader that is strict until it is released, and a pass-through to
 * another loader afterwards.
 * @internal
 */
export interface ReleasableLoader {
  readonly loader: DocumentLoader;
  release(): void;
}

/**
 * Creates a {@link ReleasableLoader}.
 * @param strict The loader to use until release.
 * @param fallback The loader to use after release.
 * @param policy The policy both loaders apply.
 * @returns The releasable loader.
 * @internal
 */
export function createReleasableLoader(
  strict: DocumentLoader,
  fallback: DocumentLoader,
  policy: EffectiveContextLoaderPolicy,
): ReleasableLoader {
  let released = false;
  return {
    loader: markEffectiveContextLoader(
      (url, options) =>
        released ? fallback(url, options) : strict(url, options),
      policy,
    ),
    release() {
      released = true;
    },
  };
}

/**
 * Expands a JSON-LD document with the given context loader.
 * @param document The document.
 * @param contextLoader The context loader.
 * @returns The expanded document.
 * @internal
 */
export async function expandDocument(
  document: unknown,
  contextLoader: DocumentLoader,
): Promise<Record<string, unknown>[]> {
  // deno-lint-ignore no-explicit-any
  return await jsonld.expand(document as any, {
    documentLoader: contextLoader,
    // deno-lint-ignore no-explicit-any
  } as any) as Record<string, unknown>[];
}

/**
 * Computes the digest of an expanded document.
 * @param expanded The expanded document.
 * @returns The hex-encoded SHA-256 of its canonical JSON.
 * @internal
 */
export function digestExpandedDocument(expanded: unknown): Promise<string> {
  return sha256(expanded);
}

/**
 * Deeply freezes a JSON value.
 * @param value The value.
 * @returns The same value, frozen.
 * @internal
 */
export function deepFreeze<T>(value: T): T {
  if (value != null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const ACTOR_IRI = "https://www.w3.org/ns/activitystreams#actor";

/**
 * Gets the single root node of an expanded document.
 * @param expanded The expanded document.
 * @returns The root node, or `null` if there is not exactly one.
 * @internal
 */
export function getRootNode(
  expanded: readonly unknown[],
): Record<string, unknown> | null {
  if (expanded.length !== 1) return null;
  const node = expanded[0];
  if (node == null || typeof node !== "object" || Array.isArray(node)) {
    return null;
  }
  return node as Record<string, unknown>;
}

/**
 * Gets the values of a property of an expanded node, unwrapping a single
 * `@list` container the way generated vocabulary decoders do.
 * @param node The expanded node.
 * @param iri The property IRI.
 * @returns The values, or an empty array if the property is absent.
 * @internal
 */
export function getPropertyValues(
  node: Record<string, unknown>,
  iri: string,
): readonly unknown[] {
  const values = node[iri];
  if (values == null) return [];
  if (!Array.isArray(values)) return [values];
  if (
    values.length === 1 && values[0] != null &&
    typeof values[0] === "object" && "@list" in values[0]
  ) {
    const list = (values[0] as { "@list": unknown })["@list"];
    return Array.isArray(list) ? list : [list];
  }
  return values;
}

/**
 * Tells whether the root node of an expanded activity declares any `actor`
 * value at all, including blank nodes, anonymous or untyped nodes, and
 * literals, which ID accessors and typed parsing may drop.
 * @param expanded The expanded activity.
 * @returns `"absent"` if the root node declares no actor; `"present"`
 *          otherwise, including when there is no single root node.
 * @internal
 */
export function getActorPresence(
  expanded: readonly unknown[],
): "absent" | "present" {
  const root = getRootNode(expanded);
  if (root == null) return "present";
  return getPropertyValues(root, ACTOR_IRI).length < 1 ? "absent" : "present";
}

/**
 * The interpretation of an incoming activity that Fedify authenticated, as
 * stored in a queued message.  The document itself is not copied; it is
 * a field of the message.
 * @internal
 */
export interface SerializedVerifiedActivityView {
  /** The format version. */
  readonly version: 1;
  /** The context loader policy the activity was parsed with. */
  readonly policy: EffectiveContextLoaderPolicy;
  /**
   * Which document the activity was parsed from, with its Linked Data
   * Signature detached: the `activity` of the message, i.e., the payload as
   * received, or its `normalizedActivity`, i.e., the payload compacted for
   * Linked Data Signatures.
   */
  readonly source: "activity" | "normalizedActivity";
  /** The `baseUrl` option the activity was parsed with. */
  readonly baseUrl: string | null;
  /** The context responses the interpretation used. */
  readonly contexts: readonly SerializedContextSnapshotEntry[];
  /** The digest of the expanded activity. */
  readonly expandedDigest: string;
}

/**
 * Describes which document an activity was parsed from, and how.
 * @internal
 */
export interface VerifiedActivityViewSource {
  readonly policy: EffectiveContextLoaderPolicy;
  readonly source: "activity" | "normalizedActivity";
  /** The document the activity was parsed from. */
  readonly document: unknown;
  readonly baseUrl: URL | null;
}

/**
 * Builds the serialized view of an authenticated activity.  The document is
 * expanded through the snapshot, so that the snapshot holds every context
 * response the interpretation needs.
 * @param snapshot The delivery's context snapshot.
 * @param source Which document the activity was parsed from.
 * @returns The serialized view and the expanded activity.
 * @internal
 */
export async function buildVerifiedActivityView(
  snapshot: ContextSnapshot,
  source: VerifiedActivityViewSource,
): Promise<{
  view: SerializedVerifiedActivityView;
  expanded: Record<string, unknown>[];
}> {
  // Only the responses this interpretation uses are kept, not those that
  // other steps of the delivery loaded, e.g., for key documents:
  const loader = snapshot.loader(source.policy);
  const used = new Set<string>();
  const expanded = await expandDocument(
    source.document,
    markEffectiveContextLoader((url, options) => {
      used.add(normalizeUrl(url));
      return loader(url, options);
    }, source.policy),
  );
  const contexts = await serializeContextSnapshot(
    snapshot.entries().filter((entry) =>
      entry.policy === source.policy && used.has(entry.url)
    ),
  );
  return {
    view: {
      version: 1,
      policy: source.policy,
      source: source.source,
      baseUrl: source.baseUrl?.href ?? null,
      contexts,
      expandedDigest: await digestExpandedDocument(expanded),
    },
    expanded,
  };
}

/**
 * Validates the shape of a serialized view taken from a queued message.
 * @param value The value of the message's `verifiedView` field.
 * @returns The view, or `null` if it is malformed or of an unsupported
 *          version.
 * @internal
 */
export function parseSerializedVerifiedActivityView(
  value: unknown,
): SerializedVerifiedActivityView | null {
  if (value == null || typeof value !== "object") return null;
  const view = value as Record<string, unknown>;
  if (
    view.version !== 1 ||
    (view.policy !== "standard" && view.policy !== "normalization") ||
    (view.source !== "activity" && view.source !== "normalizedActivity") ||
    (view.baseUrl !== null &&
      (typeof view.baseUrl !== "string" || !URL.canParse(view.baseUrl))) ||
    !Array.isArray(view.contexts) || typeof view.expandedDigest !== "string"
  ) {
    return null;
  }
  return view as unknown as SerializedVerifiedActivityView;
}

/**
 * A view restored from a queued message.
 * @internal
 */
export interface RestoredVerifiedActivityView {
  /** The document to parse the activity from. */
  readonly document: unknown;
  /** A loader that serves only the snapshot's responses of the policy. */
  readonly loader: DocumentLoader;
  /** The expanded activity, whose digest has been checked. */
  readonly expanded: Record<string, unknown>[];
  readonly baseUrl: URL | null;
}

/**
 * Restores a view from a queued message without loading any context.
 * @param view The serialized view.
 * @param message The fields of the message the view refers to.
 * @returns The restored view.
 * @throws {ContextSnapshotMissError} If the view cannot be replayed exactly.
 * @internal
 */
export async function restoreVerifiedActivityView(
  view: SerializedVerifiedActivityView,
  message: {
    readonly activity: unknown;
    readonly normalizedActivity?: unknown;
  },
): Promise<RestoredVerifiedActivityView> {
  const entries = await deserializeContextSnapshot(view.contexts);
  const loader = createSnapshotOnlyLoader(entries, view.policy);
  if (
    view.source === "normalizedActivity" && message.normalizedActivity == null
  ) {
    throw new ContextSnapshotMissError(
      "(normalizedActivity)",
      "the normalized activity is missing",
    );
  }
  const document = detachSignature(
    view.source === "activity" ? message.activity : message.normalizedActivity,
  );
  const expanded = await expandDocument(document, loader);
  if (await digestExpandedDocument(expanded) !== view.expandedDigest) {
    throw new ContextSnapshotMissError(
      "(activity)",
      "the interpretation does not match the authenticated one",
    );
  }
  return {
    document,
    loader,
    expanded,
    baseUrl: view.baseUrl == null ? null : new URL(view.baseUrl),
  };
}
