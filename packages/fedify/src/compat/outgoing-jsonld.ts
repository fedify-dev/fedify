import { type DocumentLoader, preloadedContexts } from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import { getLogger } from "@logtape/logtape";
import { normalizePublicAudience } from "./public-audience.ts";

const logger = getLogger(["fedify", "compat", "outgoing-jsonld"]);

const ATTACHMENT_FIELDS = new Set([
  "attachment",
  "https://www.w3.org/ns/activitystreams#attachment",
]);

const AS_CONTEXT_URL = "https://www.w3.org/ns/activitystreams";
const KNOWN_SAFE_CONTEXT_URLS: ReadonlySet<string> = new Set(
  Object.keys(preloadedContexts),
);

// Keep the traversal bounded for adversarial JSON-LD passed through proof
// verification fallback paths.
const MAX_TRAVERSAL_DEPTH = 64;

const preloadedOnlyDocumentLoader: DocumentLoader = (url: string) => {
  if (Object.hasOwn(preloadedContexts, url)) {
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: preloadedContexts[url],
    });
  }
  return Promise.reject(
    new Error(
      "Refusing to fetch a non-preloaded JSON-LD context: " + url,
    ),
  );
};

function isJsonLdListObject(value: unknown): boolean {
  return typeof value === "object" && value != null &&
    Object.hasOwn(value, "@list");
}

function isJsonLdValueObject(value: unknown): boolean {
  return typeof value === "object" && value != null &&
    Object.hasOwn(value, "@value");
}

/**
 * Wraps scalar ActivityStreams attachment properties in arrays.
 */
function wrapScalarAttachments(
  jsonLd: unknown,
  depth: number = 0,
): unknown {
  if (depth >= MAX_TRAVERSAL_DEPTH) return jsonLd;

  if (Array.isArray(jsonLd)) {
    let normalized: unknown[] | null = null;
    for (let i = 0; i < jsonLd.length; i++) {
      const item = jsonLd[i];
      const next = wrapScalarAttachments(item, depth + 1);
      if (normalized == null && next !== item) {
        normalized = jsonLd.slice(0, i);
      }
      if (normalized != null) {
        normalized[i] = next;
      }
    }
    return normalized ?? jsonLd;
  }

  if (typeof jsonLd !== "object" || jsonLd == null) return jsonLd;

  const record = jsonLd as Record<string, unknown>;
  const keys = Object.keys(record);
  let normalized: Record<string, unknown> | null = null;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = record[key];
    const next = key === "@context" ||
        (key === "@value" && isJsonLdValueObject(jsonLd))
      ? value
      : wrapScalarAttachments(value, depth + 1);
    const shouldWrap = ATTACHMENT_FIELDS.has(key) &&
      next != null &&
      !Array.isArray(next) &&
      !isJsonLdListObject(next);
    const output = shouldWrap ? [next] : next;

    if (normalized == null && output !== value) {
      const cloned: Record<string, unknown> = Object.create(null);
      for (let j = 0; j < i; j++) {
        const previousKey = keys[j];
        cloned[previousKey] = record[previousKey];
      }
      normalized = cloned;
    }
    if (normalized != null) {
      normalized[key] = output;
    }
  }

  return normalized ?? jsonLd;
}

function hasNestedContext(value: unknown, depth: number = 0): boolean {
  if (depth >= MAX_TRAVERSAL_DEPTH) return true;
  if (Array.isArray(value)) {
    return value.some((item) => hasNestedContext(item, depth + 1));
  }
  if (typeof value !== "object" || value == null) return false;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === "@context") return true;
    if (hasNestedContext(record[key], depth + 1)) return true;
  }
  return false;
}

function exceedsTraversalDepth(value: unknown, depth: number = 0): boolean {
  if (depth >= MAX_TRAVERSAL_DEPTH) return true;
  if (Array.isArray(value)) {
    return value.some((item) => exceedsTraversalDepth(item, depth + 1));
  }
  if (typeof value !== "object" || value == null) return false;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (
      key === "@context" || (key === "@value" && isJsonLdValueObject(value))
    ) {
      continue;
    }
    if (exceedsTraversalDepth(record[key], depth + 1)) return true;
  }
  return false;
}

function hasKnownSafeContext(jsonLd: unknown): boolean {
  if (typeof jsonLd !== "object" || jsonLd == null) return false;
  const record = jsonLd as Record<string, unknown>;
  if (!Object.hasOwn(record, "@context")) return false;
  const context = record["@context"];
  const entries = typeof context === "string"
    ? [context]
    : Array.isArray(context)
    ? context
    : null;
  if (entries == null || entries.length < 1) return false;
  let hasActivityStreamsContext = false;
  for (const entry of entries) {
    if (typeof entry !== "string") return false;
    if (!KNOWN_SAFE_CONTEXT_URLS.has(entry)) return false;
    if (entry === AS_CONTEXT_URL) hasActivityStreamsContext = true;
  }
  if (!hasActivityStreamsContext) return false;
  for (const key of Object.keys(record)) {
    if (key === "@context") continue;
    if (hasNestedContext(record[key])) return false;
  }
  return true;
}

/**
 * Ensures ActivityStreams attachment properties are represented as arrays
 * when doing so preserves the JSON-LD semantics.
 *
 * JSON-LD compaction collapses single-item arrays into scalar values by
 * default.  Some ActivityPub implementations, Pixelfed among them, parse
 * `attachment` as a plain JSON array rather than a JSON-LD property and reject
 * otherwise valid objects whose single attachment is emitted as a scalar.
 */
export async function normalizeAttachmentArrays(
  jsonLd: unknown,
  contextLoader?: DocumentLoader,
): Promise<unknown> {
  const normalized = wrapScalarAttachments(jsonLd);
  if (normalized === jsonLd) return jsonLd;
  if (exceedsTraversalDepth(jsonLd)) {
    logger.debug(
      "Skipping attachment array normalization because the JSON-LD document " +
        "exceeds the safe traversal depth; leaving it unchanged.",
    );
    return jsonLd;
  }
  if (hasKnownSafeContext(jsonLd)) return normalized;
  const loader = contextLoader ?? preloadedOnlyDocumentLoader;
  try {
    const [before, after] = await Promise.all([
      jsonld.canonize(jsonLd, {
        format: "application/n-quads",
        documentLoader: loader,
      }),
      jsonld.canonize(normalized, {
        format: "application/n-quads",
        documentLoader: loader,
      }),
    ]);
    if (before === after) return normalized;
    logger.warn(
      "Wrapping scalar attachment values in arrays would change the " +
        "canonical form of the JSON-LD document; leaving it unchanged.  " +
        "This usually means the active JSON-LD context redefines the " +
        "`attachment` term.",
    );
  } catch (error) {
    logger.debug(
      "Failed to verify attachment array normalization equivalence via " +
        "JSON-LD canonicalization; leaving the JSON-LD document " +
        "unchanged.\n{error}",
      { error },
    );
  }
  return jsonLd;
}

/**
 * Applies Fedify's internal JSON-LD wire-format interoperability workarounds
 * to locally generated outgoing activities before they are signed, enqueued,
 * or sent.
 */
export async function normalizeOutgoingActivityJsonLd(
  jsonLd: unknown,
  contextLoader?: DocumentLoader,
): Promise<unknown> {
  jsonLd = await normalizePublicAudience(jsonLd, contextLoader);
  return await normalizeAttachmentArrays(jsonLd, contextLoader);
}
