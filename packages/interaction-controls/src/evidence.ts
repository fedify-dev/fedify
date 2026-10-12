import {
  canonicalizePortableUri,
  formatIri,
  fromCompatibleEf61Id,
  parseIri,
} from "@fedify/vocab-runtime";

const COMPATIBLE_ID_PATH_PATTERN = /^\/\.well-known\/apgateway\//i;

/**
 * Tells whether an ID is an [FEP-ef61] portable ID or a compatible
 * identifier, which no web origin speaks for.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 */
export function isPortableClaim(id: URL): boolean {
  return id.protocol === "ap:" || id.protocol === "ap+ef61:" ||
    ((id.protocol === "http:" || id.protocol === "https:") &&
      COMPATIBLE_ID_PATH_PATTERN.test(id.pathname));
}

/**
 * Normalizes an ID for comparison: [FEP-ef61] portable IDs and compatible
 * identifiers to their canonical portable IDs, other IDs to their `href`.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @returns The normalized ID, or `null` if it is a malformed portable ID or
 *          compatible identifier, which never matches anything.
 */
export function canonicalizeId(id: URL): string | null {
  try {
    if (id.protocol === "ap:" || id.protocol === "ap+ef61:") {
      return canonicalizePortableUri(formatIri(id));
    }
    if (isPortableClaim(id)) {
      const portable = fromCompatibleEf61Id(id);
      return portable == null
        ? null
        : canonicalizePortableUri(formatIri(portable));
    }
    return id.href;
  } catch {
    return null;
  }
}

/**
 * Compares two IDs, canonicalizing [FEP-ef61] portable IDs.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 */
export function sameId(
  left: URL | null | undefined,
  right: URL | null | undefined,
): boolean {
  if (left == null || right == null) return false;
  const canonical = canonicalizeId(left);
  return canonical != null && canonical === canonicalizeId(right);
}

/** Tells whether a URL carries a username or a password. */
export function hasCredentials(url: URL): boolean {
  return url.username !== "" || url.password !== "";
}

/**
 * Gets the single root node of an expanded document.
 * @returns The root node, or `null` if there is not exactly one.
 */
export function getRootNode(
  expanded: readonly unknown[],
): Readonly<Record<string, unknown>> | null {
  if (expanded.length !== 1) return null;
  const node = expanded[0];
  if (node == null || typeof node !== "object" || Array.isArray(node)) {
    return null;
  }
  return node as Readonly<Record<string, unknown>>;
}

/**
 * Gets the values of a property of an expanded node, unwrapping a single
 * `@list` container the way generated vocabulary decoders do.
 */
export function getPropertyValues(
  node: Readonly<Record<string, unknown>>,
  iri: string,
): readonly unknown[] {
  const values = node[iri];
  if (values == null) return [];
  if (!Array.isArray(values)) return [values];
  if (
    values.length === 1 && values[0] != null &&
    typeof values[0] === "object" && "@list" in values[0]
  ) {
    const list = (values[0] as { readonly "@list": unknown })["@list"];
    return Array.isArray(list) ? list : [list];
  }
  return values;
}

/**
 * Resolves the `@id` of an expanded value, the way generated vocabulary
 * decoders resolve references.
 * @param value The expanded value, a node object or a node reference.
 * @param base The base URL to resolve a relative IRI against.
 * @returns The IRI, or `null` if the value is not a node with a non-blank
 *          `@id` that can be resolved.
 */
export function resolveNodeId(
  value: unknown,
  base: URL | null,
): URL | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const id = (value as { readonly "@id"?: unknown })["@id"];
  if (typeof id !== "string" || id.startsWith("_:")) return null;
  try {
    return base == null ? parseIri(id) : parseIri(id, base);
  } catch {
    return null;
  }
}

/** Tells whether an expanded node has the given type. */
export function hasType(
  node: Readonly<Record<string, unknown>>,
  typeIri: string,
): boolean {
  const types = node["@type"];
  return Array.isArray(types) ? types.includes(typeIri) : types === typeIri;
}
