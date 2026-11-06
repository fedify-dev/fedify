import { getFieldName } from "./field.ts";
import {
  isNonFunctionalProperty,
  type PropertySchema,
  type TypeSchema,
} from "./schema.ts";
import { areAllScalarTypes, getAllProperties, getEncoders } from "./type.ts";

/**
 * Emits the body of a loop that encodes the values of a property into the
 * shape that `toJsonLd({ format: "expand" })` passes to `jsonld.expand()`.
 * The loop pushes encoded values into a local `array`, and expects the
 * current value in `v` and the encoding options in `options`.
 * @param property The property to encode.
 * @param types The type schemas.
 * @param signedValueScope The expression of the signed-value scope whose
 *                         placeholders should replace retained signed values,
 *                         or `undefined` to encode them as they are.
 * @returns The code of the loop body.
 */
export function* generateExpandedPropertyElement(
  property: PropertySchema,
  types: Record<string, TypeSchema>,
  signedValueScope?: string,
): Iterable<string> {
  yield `
      let element = (
    `;
  const scalar = areAllScalarTypes(property.range, types);
  if (!scalar) {
    if (signedValueScope != null) {
      yield `retainedSignedValueRef(v, ${signedValueScope}) ?? (`;
    }
    yield 'v instanceof URL ? { "@id": formatIri(v) } : ';
  }
  for (const code of getEncoders(property.range, types, "v", "options")) {
    yield code;
  }
  if (!scalar && signedValueScope != null) yield ")";
  yield `
      );
      if (Array.isArray(element)) {
        if (element.length < 1) continue;
        if (element.length == 1) element = element[0];
      }
      if (typeof element === "undefined") continue;
    `;
  if (isNonFunctionalProperty(property) && property.container === "graph") {
    yield `array.push({ "@graph": element });`;
  } else {
    yield `array.push(element);`;
  }
}

/**
 * Emits module-private support for the raw property functions, shared by all
 * generated classes, and the public functions themselves.
 */
export function generateRawPropertyHelpers(): string {
  return `
type RawPropertyEncoder = (
  object: object,
  options: { format: "expand"; contextLoader?: DocumentLoader },
) => Promise<unknown>;

interface RawPropertyDescriptor {
  readonly canonicalIri: string;
  readonly encode: RawPropertyEncoder;
}

// Unknown properties retained while decoding, keyed by the decoded object:
const retainedRawProperties = new WeakMap<object, RetainedRawProperties>();

// Encoders of the properties each generated class declares, keyed by the
// class's prototype and then by the property IRIs, including aliases:
const rawPropertyDescriptors = new Map<
  object,
  ReadonlyMap<string, RawPropertyDescriptor>
>();

function getRawPropertyDescriptor(
  object: object,
  iri: string,
): RawPropertyDescriptor | undefined {
  let prototype: object | null = globalThis.Object.getPrototypeOf(object);
  while (prototype != null) {
    const descriptor = rawPropertyDescriptors.get(prototype)?.get(iri);
    if (descriptor != null) return descriptor;
    prototype = globalThis.Object.getPrototypeOf(prototype);
  }
  return undefined;
}

function copyRawProperties(source: object, destination: object): void {
  const retained = retainedRawProperties.get(source);
  if (retained == null) retainedRawProperties.delete(destination);
  else retainedRawProperties.set(destination, retained);
}

// The contexts embedded objects were decoded with, keyed by the objects.  Their
// cached JSON-LD stays as it was received, as a proof can cover its context, so
// this is what decoding the objects nested in them has to start from:
const inheritedContexts = new WeakMap<object, unknown>();

function getCachedJsonLdContext(object: object, context: unknown): unknown {
  return inheritedContexts.has(object)
    ? inheritedContexts.get(object)
    : context;
}

// Puts the document an embedded object was received as back into its cache,
// after decoding it from the result of inheritJsonLdContext():
async function keepCachedJsonLd(
  object: object,
  document: object,
  decoded: object,
  contextLoader: DocumentLoader,
): Promise<void> {
  if (decoded === document) return;
  const target = object as unknown as { _cachedJsonLd?: unknown };
  const cached = target._cachedJsonLd;
  if (cached == null) return;
  inheritedContexts.set(object, (decoded as { "@context"?: unknown })["@context"]);
  // The decoder can normalize what it caches, e.g., portable object IRIs:
  target._cachedJsonLd =
    globalThis.JSON.stringify(cached) === globalThis.JSON.stringify(decoded)
      ? structuredClone(document)
      : await compactJsonLdCache(
        await jsonld.expand(cached, {
          documentLoader: contextLoader,
          keepFreeFloatingNodes: true,
        }),
        document,
        contextLoader,
      );
}

// Embeds the context of a cached document in a document embedded in it, so
// that decoding the embedded document alone resolves its terms the same way
// as decoding the whole document did.  The parent's context entries keep
// their order, as later entries can refer to terms earlier ones define.
// When the embedded document's own context already begins with all of them,
// it is used as is, since applying the same entries again yields the same
// terms:
function inheritJsonLdContext(
  parentContext: unknown,
  document: object,
): object {
  const own = (document as { "@context"?: unknown })["@context"];
  const ownEntries = globalThis.Array.isArray(own) ? own : [own];
  const parentEntries = globalThis.Array.isArray(parentContext)
    ? parentContext
    : [parentContext];
  if (
    parentEntries.length <= ownEntries.length &&
    parentEntries.every((entry, i) =>
      globalThis.JSON.stringify(entry) ===
        globalThis.JSON.stringify(ownEntries[i])
    )
  ) {
    return document;
  }
  return { ...document, "@context": [...parentEntries, ...ownEntries] };
}

// The results of isCachedPropertyKey(), keyed by the document and then by the
// key:
const cachedPropertyKeys = new WeakMap<object, Map<string, Promise<boolean>>>();

async function expandTopLevelKeys(
  document: Record<string, unknown>,
  contextLoader: DocumentLoader,
): Promise<string[]> {
  const expanded = await jsonld.expand(document, {
    documentLoader: contextLoader,
    keepFreeFloatingNodes: true,
  });
  return globalThis.Object.keys(expanded[0] ?? {}).filter((iri) =>
    !iri.startsWith("@")
  );
}

// The number of expansions must not depend on the document, which can come
// from a remote peer, as each of them can load the contexts again:
async function mapsOnlyKeyToProperty(
  document: Record<string, unknown>,
  context: unknown,
  key: string,
  iris: readonly string[],
  contextLoader: DocumentLoader,
): Promise<boolean> {
  const own = await expandTopLevelKeys(
    { "@context": context, [key]: [] },
    contextLoader,
  );
  if (own.length !== 1 || own[0] !== iris[0]) return false;
  // Only the keys matter, so nested values and their contexts are left out,
  // while scalars stay for keyword aliases such as id, which require them:
  const others: Record<string, unknown> = { "@context": context };
  for (const [k, value] of globalThis.Object.entries(document)) {
    if (k === key || k.startsWith("@")) continue;
    others[k] = value != null && typeof value === "object" ? [] : value;
  }
  try {
    const expanded = await expandTopLevelKeys(others, contextLoader);
    return !expanded.some((iri) => iris.includes(iri));
  } catch {
    // Some other term could not take the placeholder, so nothing is known:
    return false;
  }
}

// Only the first entry of a context can declare that it does not propagate:
function isNonPropagatingContext(context: unknown): boolean {
  const first = globalThis.Array.isArray(context) ? context[0] : context;
  return first != null && typeof first === "object" &&
    (first as Record<string, unknown>)["@propagate"] === false;
}

// Objects whose contexts could not be rebuilt, so that neither they nor the
// objects nested in them can be decoded again from their cached JSON-LD:
const fixedCachedJsonLd = new WeakSet<object>();

// Whether an embedded document under a key of the cached JSON-LD of an object
// can be decoded again.  Prepending a context cannot rebuild what a context
// that does not propagate to embedded nodes, in the document or in the embedded
// document, or a property-scoped context for the key took part in:
function canDecodeCachedJsonLd(
  object: object,
  context: unknown,
  embedded: object,
  key: string,
): boolean {
  return !fixedCachedJsonLd.has(object) &&
    !isNonPropagatingContext(context) &&
    !isNonPropagatingContext(
      (embedded as { "@context"?: unknown })["@context"],
    ) &&
    !hasPropertyScopedContext(context, key);
}

// Gives an object decoded with the whole document the document it was received
// as, which a proof can cover, when it cannot be decoded from that document:
function fixCachedJsonLd(object: unknown, document: object): void {
  if (
    object == null || typeof object !== "object" ||
    !(RAW_PROPERTY_PROTOCOL in object)
  ) {
    return;
  }
  (object as unknown as { _cachedJsonLd?: unknown })._cachedJsonLd =
    structuredClone(document);
  fixedCachedJsonLd.add(object);
}

function hasPropertyScopedContext(context: unknown, key: string): boolean {
  const entries = globalThis.Array.isArray(context) ? context : [context];
  return entries.some((entry) => {
    const term = entry != null && typeof entry === "object"
      ? (entry as Record<string, unknown>)[key]
      : undefined;
    return term != null && typeof term === "object" && "@context" in term;
  });
}

// Whether the embedded documents under a key of a compacted document are the
// values decoded for a property.  The document has to map the key, and no other
// key, to the property, as a context can remap the key or map another term to
// the property, in which case the cached documents cannot be matched with the
// decoded values:
async function isCachedPropertyKey(
  document: Record<string, unknown>,
  context: unknown,
  key: string,
  iris: readonly string[],
  contextLoader: DocumentLoader,
): Promise<boolean> {
  let checks = cachedPropertyKeys.get(document);
  if (checks == null) {
    checks = new Map();
    cachedPropertyKeys.set(document, checks);
  }
  const cached = checks.get(key);
  if (cached != null) return await cached;
  const check = mapsOnlyKeyToProperty(
    document,
    context,
    key,
    iris,
    contextLoader,
  );
  // A failure, such as of the context loader, is not remembered, as another
  // call can pass another loader:
  const map = checks;
  check.catch(() => map.delete(key));
  checks.set(key, check);
  return await check;
}

async function readRawProperty(
  object: object,
  request: RawPropertyRequest,
  contextLoader: DocumentLoader,
): Promise<readonly unknown[]> {
  const retained = retainedRawProperties.get(object);
  for (const iri of request.candidates) {
    const descriptor = getRawPropertyDescriptor(object, iri);
    if (descriptor != null) {
      const value = await descriptor.encode(
        object,
        createRawPropertyEncodingOptions(request.stack, contextLoader),
      );
      return value === undefined ? [] : await expandRawPropertyValue(
        descriptor.canonicalIri,
        value,
        contextLoader,
      );
    }
    if (retained != null && globalThis.Object.hasOwn(retained, iri)) {
      return retained[iri];
    }
  }
  return [];
}

/**
 * Gets the values of a property of a vocabulary object in expanded JSON-LD,
 * looking the property up by its full IRI.  This works for properties that
 * have no typed accessor as well as for those that do.
 *
 * *Raw* means untyped expanded JSON-LD values, such as
 * \`{ "@value": "Hello" }\` or \`{ "@id": "https://example.com/" }\`, as
 * opposed to the values that typed accessors return.  It does not mean the
 * received document:
 *
 *  -  For a property that the object's class has no accessor for, the result
 *     is the values retained when the object was decoded by \`fromJsonLd()\`.
 *     Objects constructed locally have none.
 *  -  For a property that the class has an accessor for, including a
 *     redundant alias of such a property, the result is the current typed
 *     values encoded back into expanded JSON-LD.  It reflects \`clone()\`
 *     replacements and objects fetched by dereferencing accessors, and it can
 *     differ from the received values: for example, values that failed to
 *     decode are missing, and lexical forms such as date-times are
 *     normalized.  When a later release adds an accessor for a property,
 *     the result for that property switches from the retained values to the
 *     encoded ones.
 *
 * The values are not verified in any way, and IRIs in them are never
 * dereferenced.  Validate them before use, as with any other data received
 * from a remote server.  The result is a deep copy, so modifying it does not
 * affect the object.
 *
 * The IRI is matched as given, and then as normalized by the WHATWG URL
 * parser.  Prefixes are never expanded: \`"as:content"\` is a valid IRI with
 * the \`as:\` scheme, so it normally matches nothing.  An IRI whose scheme is
 * not \`http:\` or \`https:\` is therefore logged as a warning under the
 * \`["fedify", "vocab"]\` category.
 *
 * \`\`\`typescript ignore
 * const values = await getRawPropertyValues(
 *   note,
 *   "https://w3id.org/quantpub#structuredUrl",
 * );
 * for (const value of values) {
 *   if ("@id" in value && typeof value["@id"] === "string") {
 *     console.log(new URL(value["@id"]));
 *   }
 * }
 * \`\`\`
 *
 * @param object The vocabulary object to read.  It can be an object of any
 *               module generated by \`@fedify/vocab-tools\`.
 * @param propertyIri The full IRI of the property.
 * @returns The values of the property, or an empty array if it has none.
 * @throws {TypeError} If \`propertyIri\` is not an absolute IRI, e.g., an
 *                     empty string, a JSON-LD keyword such as \`"@id"\`, a
 *                     blank node identifier, a term, or a relative
 *                     reference; if \`object\` is not a generated vocabulary
 *                     object; or if encoding the values of a known property
 *                     meets a cycle of objects.
 * @since 2.5.0
 */
export function getRawPropertyValues(
  object: VocabularyObject,
  propertyIri: string | URL,
): Promise<RawPropertyValue[]> {
  return readRawPropertyValues(object, propertyIri, "getRawPropertyValues");
}

/**
 * Gets the first value of a property of a vocabulary object in expanded
 * JSON-LD, looking the property up by its full IRI.  It is equivalent to
 * \`(await getRawPropertyValues(object, propertyIri))[0] ?? null\`; see
 * {@link getRawPropertyValues} for how the values are obtained.
 *
 * It does not throw when the property has multiple values.  JSON-LD does not
 * order the values of a property unless it is a list, so the first value is
 * not more significant than the others.  A list property has a single value,
 * the \`{ "@list": [...] }\` object.
 *
 * @param object The vocabulary object to read.  It can be an object of any
 *               module generated by \`@fedify/vocab-tools\`.
 * @param propertyIri The full IRI of the property.
 * @returns The first value of the property, or \`null\` if it has none.
 * @throws {TypeError} In the same cases as {@link getRawPropertyValues}.
 * @since 2.5.0
 */
export async function getRawPropertyValue(
  object: VocabularyObject,
  propertyIri: string | URL,
): Promise<RawPropertyValue | null> {
  const values = await readRawPropertyValues(
    object,
    propertyIri,
    "getRawPropertyValue",
  );
  return values[0] ?? null;
}
`;
}

/**
 * Collects the full IRIs of the properties that the given class decodes,
 * including inherited properties and redundant aliases.
 */
export function getKnownPropertyIris(
  typeUri: string,
  types: Record<string, TypeSchema>,
): string[] {
  const iris = new Set<string>();
  for (const property of getAllProperties(typeUri, types)) {
    iris.add(property.uri);
    if (property.redundantProperties != null) {
      for (const alias of property.redundantProperties) iris.add(alias.uri);
    }
  }
  return [...iris].sort();
}

/**
 * Emits a static block that registers the encoders of the properties the
 * given class declares, keeping them and their private-field access out of
 * the declaration files.  A root class also installs the method through which
 * the raw property functions reach these encoders and the retained unknown
 * properties.
 */
export async function* generateRawPropertyDescriptors(
  typeUri: string,
  types: Record<string, TypeSchema>,
): AsyncIterable<string> {
  const type = types[typeUri];
  if (type.extends != null && type.properties.length < 1) return;
  yield "static {\n";
  if (type.extends == null) {
    yield `
    globalThis.Object.defineProperty(this.prototype, RAW_PROPERTY_PROTOCOL, {
      value: function (
        this: ${type.name},
        request: RawPropertyRequest,
      ): Promise<readonly unknown[]> {
        return readRawProperty(
          this,
          request,
          this.#contextLoader ?? getDocumentLoader(),
        );
      },
      configurable: true,
      enumerable: false,
      writable: true,
    });
    `;
  }
  if (type.properties.length > 0) {
    yield `
    const descriptors = new Map<string, RawPropertyDescriptor>();
    let descriptor: RawPropertyDescriptor;
    `;
  }
  for (const property of type.properties) {
    yield `
    descriptor = {
      canonicalIri: ${JSON.stringify(property.uri)},
      // Scalar encoders are mostly synchronous, but some are not:
      // deno-lint-ignore require-await
      async encode(
        object: object,
        options: { format: "expand"; contextLoader?: DocumentLoader },
      ): Promise<unknown> {
        const array: unknown[] = [];
        for (const v of (object as ${type.name}).${await getFieldName(
      property.uri,
    )}) {
    `;
    yield* generateExpandedPropertyElement(property, types);
    yield `
        }
        if (array.length < 1) return undefined;
        return ${
      isNonFunctionalProperty(property) && property.container === "list"
        ? `{ "@list": array }`
        : "array"
    };
      },
    };
    descriptors.set(${JSON.stringify(property.uri)}, descriptor);
    `;
    for (const alias of property.redundantProperties ?? []) {
      yield `descriptors.set(${JSON.stringify(alias.uri)}, descriptor);\n`;
    }
  }
  if (type.properties.length > 0) {
    yield "rawPropertyDescriptors.set(this.prototype, descriptors);\n";
  }
  yield "}\n";
}
