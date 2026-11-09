/** Generates helpers for composing independent JSON-LD documents. */
export function generateContextHelpers(): string {
  return `
function hasJsonLdContext(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasJsonLdContext);
  return value != null && typeof value === "object" &&
    globalThis.Object.hasOwn(value, "@context");
}

function hasSupportedJsonLdScalars(value: unknown, idReferences: boolean): boolean {
  if (Array.isArray(value)) {
    return value.every(item => hasSupportedJsonLdScalars(item, idReferences));
  }
  return value === null || typeof value === "object" ||
    (idReferences && typeof value === "string" && URL.canParse(value));
}

function equalJsonLdValues(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => equalJsonLdValues(item, right[index]));
  }
  if (left === null || right === null || typeof left !== "object" ||
      typeof right !== "object") return false;
  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const keys = globalThis.Object.keys(leftObject);
  return keys.length === globalThis.Object.keys(rightObject).length &&
    keys.every(key => globalThis.Object.hasOwn(rightObject, key) &&
      equalJsonLdValues(leftObject[key], rightObject[key]));
}

async function isolateJsonLdSibling(
  value: unknown,
  term: string,
  originalContext: unknown,
  repairedContext: unknown,
  contextLoader: DocumentLoader | undefined,
): Promise<unknown> {
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      result.push(await isolateJsonLdSibling(
        item, term, originalContext, repairedContext, contextLoader,
      ));
    }
    return result;
  }
  if (value === null) return value;
  if (typeof value === "string") {
    // These references were checked against the original term's @type:@id.
    // Resolve compact IRIs and @base before removing their enclosing context.
    const expanded = await jsonld.expand(
      { "@context": originalContext, "@id": value },
      { documentLoader: contextLoader, keepFreeFloatingNodes: true },
    );
    return { "@context": { id: "@id" }, id: expanded[0]["@id"] };
  }
  if (typeof value !== "object" ||
      globalThis.Object.hasOwn(value, "@context")) return value;

  // Comparing equal-shaped wrappers also preserves list and graph semantics.
  // Keep already independent expanded sources exactly as received: adding a
  // context to a signed source can invalidate its JSON canonicalization proof.
  const original = await jsonld.expand(
    { "@context": originalContext, [term]: value },
    { documentLoader: contextLoader },
  );
  const repaired = await jsonld.expand(
    { "@context": repairedContext, [term]: value },
    { documentLoader: contextLoader },
  );
  return equalJsonLdValues(original, repaired)
    ? value
    : { ...value, "@context": originalContext };
}

async function isolateJsonLdContexts(
  result: Record<string, unknown>,
  terms: readonly string[],
  contextLoader: DocumentLoader | undefined,
): Promise<Record<string, unknown>> {
  const candidates = terms.filter(term =>
    globalThis.Object.hasOwn(result, term) && hasJsonLdContext(result[term])
  );
  if (candidates.length === 0) return result;

  const originalContext = result["@context"];
  const contexts = Array.isArray(originalContext)
    ? originalContext
    : [originalContext];
  const activeContext = await jsonld.processContext(
    await jsonld.processContext({}, null),
    originalContext,
    { documentLoader: contextLoader },
  );
  let definitions: Record<string, unknown> = {};
  let siblings: Record<string, unknown> = {};
  for (const term of candidates) {
    const mapping = jsonld.getContextValue(activeContext, term) as
      Record<string, unknown> | null;
    if (mapping == null || mapping.protected === true || mapping.reverse === true ||
        globalThis.Object.hasOwn(mapping, "@context") ||
        mapping["@type"] === "@json" || typeof mapping["@id"] !== "string" ||
        mapping["@id"].startsWith("@")) continue;

    // A scalar scoped reset does not override protected definitions in the
    // published expansion algorithm.  Check the entire property before making
    // any changes; supported URL references receive their own local context.
    if (!hasSupportedJsonLdScalars(result[term], mapping["@type"] === "@id")) {
      continue;
    }
    const definition: Record<string, unknown> = {};
    for (const keyword of [
      "@id", "@type", "@container", "@language", "@direction", "@index",
      "@nest", "@prefix",
    ]) {
      if (!globalThis.Object.hasOwn(mapping, keyword)) continue;
      const value = mapping[keyword];
      definition[keyword] = Array.isArray(value)
        ? value.length === 1 && keyword === "@container" ? value[0] : [...value]
        : value;
    }
    // The processor stores the semantic @prefix flag under an internal name.
    if (mapping._prefix === true) definition["@prefix"] = true;
    definition["@context"] = null;
    const proposedDefinitions = { ...definitions, [term]: definition };
    const repairedContext = [...contexts, proposedDefinitions];
    const rewritten = await isolateJsonLdSibling(
      result[term], term, originalContext, repairedContext, contextLoader,
    );
    definitions = proposedDefinitions;
    siblings = { ...siblings, [term]: rewritten };
  }
  return globalThis.Object.keys(definitions).length === 0
    ? result
    : { ...result, ...siblings, "@context": [...contexts, definitions] };
}
`;
}
