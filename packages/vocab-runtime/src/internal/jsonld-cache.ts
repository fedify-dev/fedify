import type { DocumentLoader } from "../docloader.ts";
import jsonld from "../jsonld.ts";
import { formatIri, haveSameIriOrigin } from "../url.ts";

/**
 * Options for deciding whether two IRIs should be treated as same-origin.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export interface IriTrustOptions {
  crossOrigin?: "ignore" | "throw" | "trust";
}

/**
 * Checks whether an IRI is trusted relative to another IRI.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function isTrustedIriOrigin(
  options: IriTrustOptions,
  left: URL | null | undefined,
  right: URL | null | undefined,
): boolean {
  return options.crossOrigin === "trust" || left == null ||
    (right != null && haveSameIriOrigin(left, right));
}

/**
 * Normalizes portable IRIs in JSON-LD cache data.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function normalizeJsonLdIris(
  value: unknown,
  iriKeys: ReadonlySet<string>,
  iriPattern: RegExp = /^ap(?:\+ef61)?:\/\//i,
): unknown {
  return normalize(value, undefined, 0, undefined);

  function isIriPosition(key: string, parentKey?: string): boolean {
    return iriKeys.has(key) ||
      ((key === "@value" || key === "@list" || key === "@set") &&
        parentKey != null && iriKeys.has(parentKey));
  }

  function normalize(
    value: unknown,
    key?: string,
    depth = 0,
    parentKey?: string,
  ): unknown {
    if (depth > 32 || key === "@context") return value;
    if (typeof value === "string") {
      if (
        key != null && isIriPosition(key, parentKey) && iriPattern.test(value)
      ) {
        try {
          return formatIri(value);
        } catch {
          return value;
        }
      }
      return value;
    }
    if (Array.isArray(value)) {
      let clone: unknown[] | undefined;
      for (let i = 0; i < value.length; i++) {
        const result = normalize(value[i], key, depth + 1, parentKey);
        if (result !== value[i]) {
          clone ??= value.slice(0, i);
          clone.push(result);
        } else if (clone != null) {
          clone.push(value[i]);
        }
      }
      return clone ?? value;
    }
    if (value == null || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    let clone: Record<string, unknown> | undefined;
    for (const entryKey of globalThis.Object.keys(object)) {
      const result = normalize(object[entryKey], entryKey, depth + 1, key);
      if (result !== object[entryKey]) {
        clone ??= { ...object };
        clone[entryKey] = result;
      }
    }
    return clone ?? object;
  }
}

/**
 * Finds the first JSON-LD context in a value.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function getJsonLdContext(value: unknown, depth = 0): unknown {
  if (depth > 32) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const context = getJsonLdContext(item, depth + 1);
      if (context !== undefined) return context;
    }
    return undefined;
  }
  if (
    value == null || typeof value !== "object" ||
    !("@context" in value)
  ) {
    return undefined;
  }
  return (value as Record<string, unknown>)["@context"];
}

/**
 * Recompacts normalized JSON-LD cache data against the original context.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export async function compactJsonLdCache(
  normalized: unknown,
  original: unknown,
  documentLoader?: DocumentLoader,
  depth = 0,
  inheritedContext?: unknown,
): Promise<unknown> {
  if (depth > 32) return normalized;
  if (Array.isArray(original)) {
    const normalizedArray = Array.isArray(normalized)
      ? normalized
      : normalized != null && typeof normalized === "object" &&
          "@graph" in normalized &&
          Array.isArray((normalized as Record<string, unknown>)["@graph"])
      ? (normalized as Record<string, unknown>)["@graph"] as unknown[]
      : undefined;
    if (normalizedArray == null) return normalized;
    let clone: unknown[] | undefined;
    for (let i = 0; i < normalizedArray.length; i++) {
      const item = await compactJsonLdCache(
        normalizedArray[i],
        original[i],
        documentLoader,
        depth + 1,
        inheritedContext,
      );
      if (item !== normalizedArray[i]) {
        clone ??= normalizedArray.slice(0, i);
        clone.push(item);
      } else if (clone != null) {
        clone.push(normalizedArray[i]);
      }
    }
    return clone ?? (Array.isArray(normalized) ? normalized : normalizedArray);
  }
  const ownContext = getJsonLdContext(original);
  const context = ownContext ?? inheritedContext;
  if (context == null) return normalized;
  return await preserveJsonLdShape(
    await mergeUnmappedTerms(
      await jsonld.compact(
        Array.isArray(normalized) && normalized.length === 1
          ? normalized[0]
          : normalized,
        context,
        { documentLoader },
      ),
      original,
      context,
      documentLoader,
    ),
    original,
    context,
    documentLoader,
    depth,
  );
}

function getTopLevelTerms(value: unknown): ReadonlySet<string> {
  const terms = new Set<string>();
  const nodes = Array.isArray(value) ? value : [value];
  for (const node of nodes) {
    if (node == null || typeof node !== "object" || Array.isArray(node)) {
      continue;
    }
    for (const key of globalThis.Object.keys(node)) {
      if (key.startsWith("@")) continue;
      terms.add(key);
    }
  }
  return terms;
}

async function mergeUnmappedTerms(
  compacted: unknown,
  original: unknown,
  context: unknown,
  documentLoader?: DocumentLoader,
): Promise<unknown> {
  if (
    original == null || typeof original !== "object" ||
    Array.isArray(original) ||
    compacted == null || typeof compacted !== "object" ||
    Array.isArray(compacted)
  ) {
    return compacted;
  }
  const result = { ...compacted as Record<string, unknown> };
  const unmappedKeys = globalThis.Object.keys(original).filter((key) =>
    key !== "@context" &&
    !globalThis.Object.prototype.hasOwnProperty.call(result, key)
  );
  if (unmappedKeys.length < 1) return result;
  const compactedWithContext = compacted != null &&
      typeof compacted === "object" && !Array.isArray(compacted) &&
      !("@context" in compacted)
    ? { "@context": context, ...compacted as Record<string, unknown> }
    : compacted;
  const compactedTerms = getTopLevelTerms(
    await jsonld.expand(compactedWithContext, { documentLoader }),
  );
  const dummyPrefix = "urn:fedify:dummy:";
  const dummy: Record<string, unknown> = { "@context": context };
  for (let i = 0; i < unmappedKeys.length; i++) {
    dummy[unmappedKeys[i]] = `${dummyPrefix}${i}`;
  }
  const expanded = await jsonld.expand(dummy, { documentLoader });
  const representedKeys = new Set<string>();
  const nodes = Array.isArray(expanded) ? expanded : [expanded];
  for (const node of nodes) {
    if (node == null || typeof node !== "object" || Array.isArray(node)) {
      continue;
    }
    for (const [term, termValue] of globalThis.Object.entries(node)) {
      if (!compactedTerms.has(term)) continue;
      for (let i = 0; i < unmappedKeys.length; i++) {
        if (containsValue(termValue, `${dummyPrefix}${i}`)) {
          representedKeys.add(unmappedKeys[i]);
        }
      }
    }
  }
  for (const key of unmappedKeys) {
    if (!representedKeys.has(key)) {
      result[key] = (original as Record<string, unknown>)[key];
    }
  }
  return result;
}

function containsValue(value: unknown, expected: string, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === expected) return true;
  if (Array.isArray(value)) {
    return value.some((item) => containsValue(item, expected, depth + 1));
  }
  if (value == null || typeof value !== "object") return false;
  return globalThis.Object.entries(value).some(([key, item]) =>
    key !== "@context" && containsValue(item, expected, depth + 1)
  );
}

async function preserveJsonLdShape(
  compacted: unknown,
  original: unknown,
  context: unknown,
  documentLoader?: DocumentLoader,
  depth = 0,
): Promise<unknown> {
  if (depth > 32) return compacted;
  if (compacted === original) return compacted;
  if (
    original == null || typeof original !== "object" ||
    compacted == null || typeof compacted !== "object"
  ) {
    return compacted;
  }
  if (Array.isArray(original)) {
    const compactedArray = Array.isArray(compacted)
      ? compacted
      : "@graph" in compacted &&
          Array.isArray((compacted as Record<string, unknown>)["@graph"])
      ? (compacted as Record<string, unknown>)["@graph"] as unknown[]
      : undefined;
    if (compactedArray == null) return compacted;
    let clone: unknown[] | undefined;
    for (let i = 0; i < compactedArray.length; i++) {
      const value = await preserveJsonLdShape(
        compactedArray[i],
        original[i],
        context,
        documentLoader,
        depth + 1,
      );
      const originalContext = original[i] != null &&
          typeof original[i] === "object" && !Array.isArray(original[i]) &&
          "@context" in original[i]
        ? (original[i] as Record<string, unknown>)["@context"]
        : undefined;
      const shaped = originalContext !== undefined &&
          value != null && typeof value === "object" &&
          !Array.isArray(value) && !("@context" in value)
        ? { "@context": originalContext, ...value as Record<string, unknown> }
        : value;
      if (shaped !== compactedArray[i]) {
        clone ??= compactedArray.slice(0, i);
        clone.push(shaped);
      } else if (clone != null) {
        clone.push(compactedArray[i]);
      }
    }
    return clone ?? (Array.isArray(compacted) ? compacted : compactedArray);
  }
  if (Array.isArray(compacted)) return compacted;
  let clone: Record<string, unknown> | undefined;
  const compactedObject = depth > 0
    ? await mergeUnmappedTerms(
      compacted,
      original,
      combineContexts(context, getJsonLdContext(original)),
      documentLoader,
    ) as Record<string, unknown>
    : compacted as Record<string, unknown>;
  const originalObject = original as Record<string, unknown>;
  for (const key of globalThis.Object.keys(compactedObject)) {
    if (key === "@context") continue;
    const value = await preserveJsonLdShape(
      compactedObject[key],
      originalObject[key],
      context,
      documentLoader,
      depth + 1,
    );
    const shaped = Array.isArray(originalObject[key]) && !Array.isArray(value)
      ? [value]
      : value;
    if (shaped !== compactedObject[key]) {
      clone ??= { ...compactedObject };
      clone[key] = shaped;
    }
  }
  if (depth > 0) {
    if ("@context" in originalObject && !("@context" in compactedObject)) {
      clone ??= { ...compactedObject };
      clone["@context"] = originalObject["@context"];
    }
  }
  return clone ?? compactedObject;
}

function combineContexts(
  inheritedContext: unknown,
  ownContext: unknown,
): unknown {
  if (ownContext == null || ownContext === inheritedContext) {
    return inheritedContext;
  }
  return Array.isArray(inheritedContext)
    ? [...inheritedContext, ownContext]
    : [inheritedContext, ownContext];
}
