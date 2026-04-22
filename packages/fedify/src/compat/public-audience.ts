import { PUBLIC_COLLECTION } from "@fedify/vocab";
import {
  type DocumentLoader,
  getDocumentLoader,
  preloadedContexts,
} from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["fedify", "compat", "public-audience"]);

const PUBLIC_ADDRESSING_FIELDS = new Set([
  "to",
  "cc",
  "bto",
  "bcc",
  "audience",
]);

const AS_CONTEXT_URL = "https://www.w3.org/ns/activitystreams";

// Set of `@context` URLs whose content is shipped with Fedify and known not
// to redefine the `as:` prefix or the bare `Public` term in any way that
// would change what `as:Public` / `Public` expand to.  Every preloaded
// context other than the ActivityStreams one stays clear of those two
// names, so combining any subset of these URLs with the ActivityStreams
// URL preserves the standard meaning of public addressing.
const KNOWN_SAFE_CONTEXT_URLS: ReadonlySet<string> = new Set(
  Object.keys(preloadedContexts),
);

function hasPublicCurieInAddressing(
  value: unknown,
  parentKey?: string,
): boolean {
  if (typeof value === "string") {
    return parentKey != null &&
      PUBLIC_ADDRESSING_FIELDS.has(parentKey) &&
      (value === "as:Public" || value === "Public");
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasPublicCurieInAddressing(item, parentKey));
  }
  if (typeof value !== "object" || value == null) return false;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    // `@context` holds term definitions, not addressing values; skip it so
    // we do not traverse potentially large inline context objects.
    if (key === "@context") continue;
    if (hasPublicCurieInAddressing(record[key], key)) return true;
  }
  return false;
}

function rewritePublicAudience(value: unknown, parentKey?: string): unknown {
  if (
    typeof value === "string" &&
    parentKey != null &&
    PUBLIC_ADDRESSING_FIELDS.has(parentKey) &&
    (value === "as:Public" || value === "Public")
  ) {
    return PUBLIC_COLLECTION.href;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item) => {
      const rewritten = rewritePublicAudience(item, parentKey);
      if (rewritten !== item) changed = true;
      return rewritten;
    });
    return changed ? mapped : value;
  }
  if (typeof value !== "object" || value == null) return value;
  const record = value as Record<string, unknown>;
  let changed = false;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    // `@context` is never an addressing field, so skip the recursion and
    // keep the reference intact.
    const rewritten = key === "@context"
      ? record[key]
      : rewritePublicAudience(record[key], key);
    if (rewritten !== record[key]) changed = true;
    normalized[key] = rewritten;
  }
  return changed ? normalized : value;
}

/**
 * Checks whether the `@context` of a JSON-LD document is guaranteed not
 * to redefine the `as:` prefix or the bare `Public` term.  Only documents
 * whose `@context` is a string, or an array of strings, drawn from Fedify's
 * preloaded context set AND including the ActivityStreams URL qualify:
 * in that case the rewrite is provably semantics-preserving and the
 * URDNA2015 equivalence check can be skipped.  Unknown external URLs are
 * treated as potentially unsafe because their content could redefine
 * those names.
 */
function hasKnownSafeContext(jsonLd: unknown): boolean {
  if (typeof jsonLd !== "object" || jsonLd == null) return false;
  const record = jsonLd as Record<string, unknown>;
  if (!Object.hasOwn(record, "@context")) return false;
  const ctx = record["@context"];
  const entries = typeof ctx === "string"
    ? [ctx]
    : Array.isArray(ctx)
    ? ctx
    : null;
  if (entries == null || entries.length === 0) return false;
  let hasAs = false;
  for (const entry of entries) {
    if (typeof entry !== "string") return false;
    if (!KNOWN_SAFE_CONTEXT_URLS.has(entry)) return false;
    if (entry === AS_CONTEXT_URL) hasAs = true;
  }
  return hasAs;
}

/**
 * Rewrites the compact `as:Public` / `Public` CURIE appearing in activity
 * addressing fields (`to`, `cc`, `bto`, `bcc`, `audience`) to the fully
 * expanded `https://www.w3.org/ns/activitystreams#Public` URI.
 *
 * Several ActivityPub implementations, Lemmy among them, match these
 * fields as plain URLs without running JSON-LD expansion, and silently
 * drop activities whose public addressing appears in CURIE form.  This
 * helper works around that gap.
 *
 * For documents whose `@context` is drawn entirely from Fedify's
 * preloaded context set and includes the ActivityStreams URL, the
 * rewrite is applied directly: the content of every preloaded non-AS
 * context is known not to redefine the `as:` prefix or the bare `Public`
 * term, so the semantics are preserved by construction.  Any other
 * shape (an inline object, an unknown external URL, and so on) is
 * treated as potentially unsafe and gated on a JSON-LD equivalence
 * check; both forms are canonicalized with URDNA2015 and the resulting
 * N-Quads are compared.  When they differ, the original document is
 * returned unchanged.  Canonicalization failures also fall back to the
 * original document.
 *
 * Must be called before any signing step that canonicalizes the
 * compact form byte-for-byte (for example, Object Integrity Proofs
 * using the `eddsa-jcs-2022` cryptosuite), so the signed payload
 * matches what is sent on the wire.
 */
export async function normalizePublicAudience(
  jsonLd: unknown,
  contextLoader?: DocumentLoader,
): Promise<unknown> {
  if (!hasPublicCurieInAddressing(jsonLd)) return jsonLd;
  const normalized = rewritePublicAudience(jsonLd);
  if (hasKnownSafeContext(jsonLd)) return normalized;
  const loader = contextLoader ?? getDocumentLoader();
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
      "Expanding the public audience CURIE to its full URI would change " +
        "the canonical form of the activity; sending the activity as is.  " +
        "This usually means the active JSON-LD context redefines the `as:` " +
        "prefix or the bare `Public` term.",
    );
  } catch (error) {
    logger.debug(
      "Failed to verify public audience normalization equivalence via " +
        "JSON-LD canonicalization; sending the activity as is.\n{error}",
      { error },
    );
  }
  return jsonLd;
}
