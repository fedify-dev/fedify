import { type DocumentLoader, preloadedContexts } from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["fedify", "compat", "attachment-arrays"]);
const MAX_DEPTH = 64;
const ATTACHMENT = "https://www.w3.org/ns/activitystreams#attachment";
const PROOF = "https://w3id.org/security#proof";

/** Recognizes JSON-LD maps without accepting arrays or scalar values. */
function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

/** Copies only changed branches; cached vocabulary JSON belongs to its owner. */
function walk(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) {
    throw new RangeError("JSON-LD nesting limit exceeded.");
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => walk(item, depth + 1));
    return items.some((item, i) => item !== value[i]) ? items : value;
  }
  if (!isMap(value)) return value;
  if (Object.hasOwn(value, "@value")) return value;
  let result: Record<string, unknown> | undefined;
  for (const [key, item] of Object.entries(value)) {
    let next = key === "@context" ? item : walk(item, depth + 1);
    if (
      (key === "attachment" || key === ATTACHMENT) &&
      next != null && !Array.isArray(next) &&
      !(isMap(next) && Object.hasOwn(next, "@list"))
    ) next = [next];
    if (next !== item) {
      result ??= Object.assign(Object.create(null), value);
      result![key] = next;
    }
  }
  return result ?? value;
}

const preloadedLoader: DocumentLoader = (url) => {
  if (!Object.hasOwn(preloadedContexts, url)) {
    return Promise.reject(new Error("Unknown JSON-LD context: " + url));
  }
  return Promise.resolve({
    contextUrl: null,
    documentUrl: url,
    document: preloadedContexts[url],
  });
};

/** Reuses each context resolution across the complete equivalence check. */
function memoizeLoader(loader: DocumentLoader): DocumentLoader {
  const pending = new Map<string, ReturnType<DocumentLoader>>();
  return (url, options) => {
    let result = pending.get(url);
    if (result == null) {
      result = loader(url, options);
      pending.set(url, result);
    }
    return result;
  };
}

/** Finds security predicates in expanded nodes, never inside JSON literals. */
function hasSecurityPredicate(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSecurityPredicate);
  if (!isMap(value) || Object.hasOwn(value, "@value")) return false;
  for (const [key, child] of Object.entries(value)) {
    if (key === PROOF || key === "https://w3id.org/security#signature") {
      return true;
    }
    if (hasSecurityPredicate(child)) return true;
  }
  return false;
}

/**
 * Keeps singleton attachments in arrays for raw-JSON ActivityPub consumers.
 * Mastodon's property_values() ignores valid compact JSON-LD scalar values,
 * and its caller clears the profile fields in that case:
 * https://github.com/mastodon/mastodon/blob/594166519a623584920c7e696bae9a009d9183ab/app/services/activitypub/process_account_service.rb#L465-L472
 * Pixelfed likewise rejects singleton media attachments:
 * https://github.com/pixelfed/pixelfed/issues/6588
 *
 * This workaround changes only attachment representation, after serialization.
 * RDF equality protects custom contexts, including JSON literals; it does not
 * protect JCS signatures. Any semantic proof or Linked Data signature leaves
 * the whole serialized document unchanged, as does an unresolved context.
 * This layer does not compose signed objects or repair vocabulary serialization.
 * Remove this
 * workaround only when the supported consumer versions, including deployed
 * older releases, accept scalar attachments. Do not replace it with a
 * vocabulary transformer: subsequent compaction collapses arrays.
 * @internal
 */
export async function normalizeAttachmentArrays(
  document: unknown,
  contextLoader?: DocumentLoader,
): Promise<unknown> {
  try {
    const normalized = walk(document);
    if (normalized === document) return document;
    const loader = memoizeLoader(contextLoader ?? preloadedLoader);
    // Use JSON-LD's interpretation rather than field names: context-coerced
    // @json values can contain ordinary data named proof or signature.  A
    // whole-document barrier avoids having to reconstruct signed boundaries.
    const expanded = await jsonld.expand(document, { documentLoader: loader });
    if (hasSecurityPredicate(expanded)) return document;
    const [before, after] = await Promise.allSettled([
      jsonld.canonize(document, {
        format: "application/n-quads",
        documentLoader: loader,
      }),
      jsonld.canonize(normalized, {
        format: "application/n-quads",
        documentLoader: loader,
      }),
    ]);
    if (before.status === "rejected") throw before.reason;
    if (after.status === "rejected") throw after.reason;
    if (before.value === after.value) return normalized;
  } catch (error) {
    logger.debug(
      "Could not safely normalize attachment arrays; preserving the document: {error}",
      { error },
    );
  }
  return document;
}
