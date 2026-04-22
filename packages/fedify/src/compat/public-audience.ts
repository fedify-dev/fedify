import { PUBLIC_COLLECTION } from "@fedify/vocab";
import { type DocumentLoader, getDocumentLoader } from "@fedify/vocab-runtime";
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
  for (const key in record) {
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
    return value.map((item) => rewritePublicAudience(item, parentKey));
  }
  if (typeof value !== "object" || value == null) return value;
  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key in record) {
    normalized[key] = rewritePublicAudience(record[key], key);
  }
  return normalized;
}

/**
 * Rewrites the compact `as:Public` / `Public` CURIE appearing in activity
 * addressing fields (`to`, `cc`, `bto`, `bcc`, `audience`) to the fully
 * expanded `https://www.w3.org/ns/activitystreams#Public` URI.
 *
 * Several ActivityPub implementations — Lemmy among them — match these
 * fields as plain URLs without running JSON-LD expansion, and silently
 * drop activities whose public addressing appears in CURIE form.  This
 * helper works around that gap.
 *
 * The rewrite is gated on a JSON-LD equivalence check: both forms are
 * canonicalized with URDNA2015 and the resulting N-Quads are compared.
 * When they differ — which indicates an application-defined `@context`
 * that redefines the `as:` prefix or the bare `Public` term — the
 * original document is returned unchanged so semantics are preserved.
 * Canonicalization failures also fall back to the original document.
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
