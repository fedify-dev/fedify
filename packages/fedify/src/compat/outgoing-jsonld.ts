import { type DocumentLoader, preloadedContexts } from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import { getLogger } from "@logtape/logtape";
import { normalizePublicAudience } from "./public-audience.ts";

const logger = getLogger(["fedify", "compat", "outgoing-jsonld"]);

const ATTACHMENT_FIELDS = new Set([
  "attachment",
  "https://www.w3.org/ns/activitystreams#attachment",
]);

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

/**
 * Wraps scalar ActivityStreams attachment properties in arrays.
 */
function wrapScalarAttachments(
  jsonLd: unknown,
  depth: number = 0,
): unknown {
  if (depth >= MAX_TRAVERSAL_DEPTH) return jsonLd;

  if (Array.isArray(jsonLd)) {
    let changed = false;
    const normalized = jsonLd.map((item) => {
      const next = wrapScalarAttachments(item, depth + 1);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? normalized : jsonLd;
  }

  if (typeof jsonLd !== "object" || jsonLd == null) return jsonLd;

  const record = jsonLd as Record<string, unknown>;
  let changed = false;
  const normalized: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(record)) {
    const value = record[key];
    const next = key === "@context"
      ? value
      : wrapScalarAttachments(value, depth + 1);
    if (
      ATTACHMENT_FIELDS.has(key) &&
      next != null &&
      !Array.isArray(next)
    ) {
      normalized[key] = [next];
      changed = true;
    } else {
      normalized[key] = next;
      if (next !== value) changed = true;
    }
  }

  return changed ? normalized : jsonLd;
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
        "canonical form of the activity; sending the activity as is.  " +
        "This usually means the active JSON-LD context redefines the " +
        "`attachment` term.",
    );
  } catch (error) {
    logger.debug(
      "Failed to verify attachment array normalization equivalence via " +
        "JSON-LD canonicalization; sending the activity as is.\n{error}",
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
