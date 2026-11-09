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
    if (descriptor != null) {
      return descriptor;
    }
    prototype = globalThis.Object.getPrototypeOf(prototype);
  }
  return undefined;
}

function copyRawProperties(source: object, destination: object): void {
  const retained = retainedRawProperties.get(source);
  if (retained == null) retainedRawProperties.delete(destination);
  else retainedRawProperties.set(destination, retained);
}

// Objects that were given the document they were received as, or whose values
// changed after decoding, which that document no longer describes:
const receivedJsonLd = new WeakSet<object>();

// Retains the unknown properties of the node a preprocessor made a value of,
// such as an Image of a Link, by the class of that value, since the value was
// not decoded from the node by that class:
function retainPreprocessedRawProperties(value: unknown, node: unknown): void {
  if (
    value == null || typeof value !== "object" || node == null ||
    typeof node !== "object" || globalThis.Array.isArray(node)
  ) {
    return;
  }
  const known = new Set<string>();
  let prototype: object | null = globalThis.Object.getPrototypeOf(value);
  while (prototype != null) {
    for (const iri of rawPropertyDescriptors.get(prototype)?.keys() ?? []) {
      known.add(iri);
    }
    prototype = globalThis.Object.getPrototypeOf(prototype);
  }
  const retained = retainRawProperties(node as Record<string, unknown>, known);
  if (retained != null) retainedRawProperties.set(value, retained);
}

function skipReceivedJsonLd(value: unknown): void {
  if (value != null && typeof value === "object") receivedJsonLd.add(value);
}

function invalidateCachedJsonLd(object: object): void {
  (object as unknown as { _cachedJsonLd?: unknown })._cachedJsonLd =
    undefined;
  receivedJsonLd.add(object);
}

// The received documents of embedded objects that have their own context,
// keyed by the expanded nodes they became while the outermost object was
// decoded:
type ReceivedDocuments = WeakMap<object, object>;

// Collects the embedded documents of a received document, at any depth: the
// objects with their own context other than the outermost node, under keys
// other than keywords, also inside arrays and @set, @list, and @graph.  Value
// objects and graph objects never become embedded objects, and the marker
// would change what they mean, so they are left out, as far as their keys
// tell: an object with @graph and nothing but @context, @id, and @index is a
// graph object.  One with other keys is marked, whatever they are aliases of,
// as the comparison of the expansions catches a marker that made a node of a
// graph object:
function collectEmbeddedDocuments(root: object): object[] {
  const outermost = globalThis.Array.isArray(root) ? root[0] : root;
  const documents: object[] = [];
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (globalThis.Array.isArray(value)) {
      // A loop, as spreading a long array into arguments overflows the stack:
      for (const element of value) pending.push(element);
      continue;
    }
    if (value == null || typeof value !== "object") continue;
    if (
      value !== outermost && "@context" in value && !("@value" in value) &&
      (!("@graph" in value) ||
        globalThis.Object.keys(value).some((key) =>
          key !== "@context" && key !== "@graph" && key !== "@id" &&
          key !== "@index"
        )) &&
      !("@set" in value) && !("@list" in value)
    ) {
      documents.push(value);
    }
    for (const [key, child] of globalThis.Object.entries(value)) {
      if (
        !key.startsWith("@") || key === "@set" || key === "@list" ||
        key === "@graph"
      ) {
        pending.push(child);
      }
    }
  }
  return documents;
}

// Copies a document without recursion, copying the replacements of the
// objects in the map instead of the objects.  The replacements are copied in
// turn, so that objects nested in them are replaced as well:
function replaceInDocument(
  document: object,
  replacements: ReadonlyMap<object, object>,
): unknown {
  const root: unknown = globalThis.Array.isArray(document) ? [] : {};
  const pending: [object, Record<string, unknown> | unknown[]][] = [
    [replacements.get(document) ?? document, root as Record<string, unknown>],
  ];
  while (pending.length > 0) {
    const [source, target] = pending.pop()!;
    for (const [key, child] of globalThis.Object.entries(source)) {
      let copy: unknown = child;
      if (child != null && typeof child === "object") {
        copy = globalThis.Array.isArray(child) ? [] : {};
        pending.push([
          replacements.get(child) ?? child,
          copy as Record<string, unknown>,
        ]);
      }
      if (globalThis.Array.isArray(target)) target.push(copy);
      // An own __proto__ member, as JSON.parse() makes, would otherwise set
      // the prototype of the copy instead:
      else {
        globalThis.Object.defineProperty(target, key, {
          value: copy,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }
  }
  return root;
}

// Tells whether two JSON values are the same, without recursion, as expanded
// documents can nest values deeply.  The order of object keys does not
// matter, while the order of array elements does:
function isSameJsonValue(a: unknown, b: unknown): boolean {
  const pending: [unknown, unknown][] = [[a, b]];
  while (pending.length > 0) {
    const [x, y] = pending.pop()!;
    if (x === y) continue;
    if (
      x == null || y == null || typeof x !== "object" || typeof y !== "object"
    ) {
      return false;
    }
    if (globalThis.Array.isArray(x)) {
      if (!globalThis.Array.isArray(y) || x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) pending.push([x[i], y[i]]);
      continue;
    }
    if (globalThis.Array.isArray(y)) return false;
    const xKeys = globalThis.Object.keys(x);
    if (xKeys.length !== globalThis.Object.keys(y).length) return false;
    for (const key of xKeys) {
      if (!globalThis.Object.hasOwn(y, key)) return false;
      pending.push([
        (x as Record<string, unknown>)[key],
        (y as Record<string, unknown>)[key],
      ]);
    }
  }
  return true;
}

// Expands a received document, and tells which expanded node each embedded
// document with its own context became.  Each such document gets a property
// with a random IRI as its marker before the expansion, so that JSON-LD
// processing itself, with every context as it applies, tells where each
// document ends up; the markers are taken out of the expanded document right
// after, and the decoders never see them.  If a document cannot take the
// marker, e.g., as it is a value object under an alias of @value, the document
// is expanded as it is, and no embedded object gets its received document:
async function expandReceivedJsonLd(
  json: unknown,
  contextLoader: DocumentLoader,
): Promise<{ expanded: unknown[]; documents?: ReceivedDocuments }> {
  // Both expansions below take the contexts that one of them loaded, so that
  // a context is not loaded twice, and cannot fail the second time:
  const loads = new Map<string, Promise<RemoteDocument>>();
  const sharedLoader: DocumentLoader = (url, loaderOptions) => {
    let load = loads.get(url);
    if (load == null) {
      load = contextLoader(url, loaderOptions);
      loads.set(url, load);
      load.catch(() => loads.delete(url));
    }
    return load;
  };
  const options = { documentLoader: sharedLoader, keepFreeFloatingNodes: true };
  // A document under an alias of @nest merges into the node around it, marker
  // and all, so that node would be taken for the document; any context that
  // mentions @nest, which few do, makes the document be expanded without
  // markers.  Only contexts count, not, e.g., a content that reads @nest:
  const mentionsNest = (value: unknown): boolean => {
    // A loader can return a document as a JSON string, which jsonld.js parses;
    // one that cannot be parsed counts as a mention, so that no marker is
    // put in a document that this cannot tell about:
    if (typeof value === "string") {
      try {
        value = globalThis.JSON.parse(value);
      } catch {
        return true;
      }
    }
    // Without recursion, as a document can nest values deeply, e.g., under a
    // term that its context maps to nothing.  An object met again on its own
    // path, i.e., a cycle, counts as a mention, so that no marker is put in it
    // and jsonld.js rejects the cycle as it would without markers; one shared
    // by several paths is scanned once:
    const pending: { item: unknown; exit?: object; context?: boolean }[] = [
      { item: value },
    ];
    const onPath = new WeakSet<object>();
    // An object can be reached both outside and inside a context, and only
    // a scan inside one tells whether it mentions @nest:
    const scannedInContext = new WeakSet<object>();
    const scannedOutside = new WeakSet<object>();
    while (pending.length > 0) {
      const { item, exit, context } = pending.pop()!;
      if (exit != null) {
        onPath.delete(exit);
        (context ? scannedInContext : scannedOutside).add(exit);
        continue;
      }
      if (context && item === "@nest") return true;
      if (
        item == null || typeof item !== "object" ||
        scannedInContext.has(item) || (!context && scannedOutside.has(item))
      ) {
        continue;
      }
      if (onPath.has(item)) return true;
      onPath.add(item);
      pending.push({ item: undefined, exit: item, context });
      if (globalThis.Array.isArray(item)) {
        for (const element of item) pending.push({ item: element, context });
        continue;
      }
      for (const [key, child] of globalThis.Object.entries(item)) {
        if (context && key === "@nest") return true;
        pending.push({ item: child, context: context || key === "@context" });
      }
    }
    return false;
  };
  const candidates = json != null && typeof json === "object" &&
      !mentionsNest(json)
    ? collectEmbeddedDocuments(json)
    : [];
  // The embedded objects get the documents as they are in one copy of the
  // whole document, rather than a copy each, which would copy a document as
  // many times as there are documents around it:
  const received = candidates.length > 0 ? copyJsonValue(json) : undefined;
  const documents = received == null ? [] : collectEmbeddedDocuments(received);
  if (documents.length < 1) {
    return {
      expanded: await jsonld.expand(json as Record<string, unknown>, options),
    };
  }
  // An IRI that a context cannot know, and that cannot be a compact IRI, as
  // its suffix after the scheme starts with //.  Some runtimes do not make
  // random values everywhere, e.g., Cloudflare Workers outside handlers, in
  // which case the document is expanded without markers:
  let token: string;
  try {
    token = globalThis.crypto.randomUUID();
  } catch {
    return {
      expanded: await jsonld.expand(json as Record<string, unknown>, options),
    };
  }
  const marker = "https://fedify.dev/ns/received#" + token;
  const replacements = new Map<object, object>();
  for (const [index, document] of documents.entries()) {
    replacements.set(document, {
      ...document,
      [marker]: globalThis.String(index),
    });
  }
  // Only a document that cannot take its marker makes the document be
  // expanded again without markers; a context that fails to load fails the
  // decoding as it would without them:
  let loadFailed = false;
  let nestLoaded = false;
  const markedOptions = {
    ...options,
    documentLoader: (async (url, loaderOptions) => {
      try {
        const loaded = await sharedLoader(url, loaderOptions);
        if (mentionsNest(loaded.document)) nestLoaded = true;
        return loaded;
      } catch (error) {
        loadFailed = true;
        throw error;
      }
    }) as DocumentLoader,
  };
  let expanded: unknown[];
  try {
    expanded = await jsonld.expand(
      replaceInDocument(received as object, replacements) as Record<
        string,
        unknown
      >,
      markedOptions,
    );
  } catch (error) {
    if (loadFailed) throw error;
    getLogger(["fedify", "vocab"]).debug(
      "Failed to mark the embedded documents of {json}: {error}",
      { json, error },
    );
    return {
      expanded: await jsonld.expand(json as Record<string, unknown>, options),
    };
  }
  const nodes: ReceivedDocuments = new WeakMap();
  // Whether two documents became one node, as one under an alias of @nest
  // merged into the node around it, which leaves the expansion as it would be
  // without markers but would give that node the wrong document:
  let merged = false;
  // Takes the markers out, also from JSON literals, which keep the documents
  // in them as they are:
  const pending: { value: unknown; literal: boolean }[] = [
    { value: expanded, literal: false },
  ];
  while (pending.length > 0) {
    const { value, literal } = pending.pop()!;
    if (globalThis.Array.isArray(value)) {
      // A loop, as spreading a long array into arguments overflows the stack:
      for (const element of value) pending.push({ value: element, literal });
      continue;
    }
    if (value == null || typeof value !== "object") continue;
    const object = value as Record<string, unknown>;
    if (marker in object) {
      const mark = object[marker];
      const index = literal
        ? undefined
        : (globalThis.Array.isArray(mark)
          ? (mark[0] as { "@value"?: unknown } | undefined)?.["@value"]
          : undefined);
      delete object[marker];
      if (!literal && globalThis.Array.isArray(mark) && mark.length > 1) {
        merged = true;
        break;
      }
      if (typeof index === "string") {
        const document = documents[globalThis.Number(index)];
        if (document != null) nodes.set(object, document);
      }
    }
    if (!literal && object["@type"] === "@json") {
      pending.push({ value: object["@value"], literal: true });
      continue;
    }
    for (const [key, child] of globalThis.Object.entries(object)) {
      if (literal || key !== "@value") pending.push({ value: child, literal });
    }
  }
  // A marker can change what a document expands to in more ways than can be
  // told before expanding it, e.g., a key of an index map that reads @context
  // is no context, and a graph object with a marker is a node, so the
  // document is expanded without markers as well, and the markers' mapping is
  // used only if both expansions are the same:
  const unmarked = await jsonld.expand(
    json as Record<string, unknown>,
    options,
  );
  if (merged || nestLoaded || !isSameJsonValue(expanded, unmarked)) {
    return { expanded: unmarked };
  }
  return { expanded, documents: nodes };
}

// Gives an embedded object the document it was received as, which toJsonLd()
// has to return as is, as a proof can cover it.  The object is decoded from the
// whole document, since an embedded document alone cannot rebuild what its
// parents' contexts contributed to it:
function keepReceivedJsonLd(
  object: unknown,
  node: unknown,
  options: unknown,
): void {
  const documents = (options as { _receivedDocuments?: ReceivedDocuments })
    ._receivedDocuments;
  if (
    documents == null || node == null || typeof node !== "object" ||
    object == null || typeof object !== "object" ||
    !(RAW_PROPERTY_PROTOCOL in object) || receivedJsonLd.has(object) ||
    // Decoding dropped some of the document as malformed, which the document
    // would bring back:
    (object as unknown as { _shouldCacheJsonLd?: boolean })
        ._shouldCacheJsonLd === false
  ) {
    return;
  }
  // A graph object with nothing else is decoded from its first node, as
  // expansion would take that node out of it:
  const graph = (node as { "@graph"?: unknown })["@graph"];
  const decodedNode = globalThis.Object.keys(node).length === 1 &&
      globalThis.Array.isArray(graph) && graph[0] != null &&
      typeof graph[0] === "object"
    ? graph[0]
    : node;
  const document = documents.get(decodedNode);
  if (document == null) return;
  receivedJsonLd.add(object);
  (object as unknown as { _cachedJsonLd?: unknown })._cachedJsonLd = document;
  embeddedReceivedJsonLd.add(document);
}

// The documents that embedded objects were received as, which they keep as
// their cached JSON-LD.  Such a document can rely on what the documents around
// it define, e.g., terms of their contexts and their base IRIs, so a parent
// that encodes its values anew encodes such an object from its values instead;
// the object's own toJsonLd() still returns the document as is, as a proof can
// cover it.  The documents rather than the objects are kept, as a cache can be
// copied to another object, e.g., by @fedify/testing:
const embeddedReceivedJsonLd = new WeakSet<object>();

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
    let element = "";
    for (const code of generateExpandedPropertyElement(property, types)) {
      element += code;
    }
    yield `
    descriptor = {
      canonicalIri: ${JSON.stringify(property.uri)},
      ${
        // Scalar encoders are mostly synchronous, but some are not:
        element.includes("await")
          ? ""
          : "// oxlint-disable-next-line require-await"
      }
      async encode(
        object: object,
        options: { format: "expand"; contextLoader?: DocumentLoader },
      ): Promise<unknown> {
        const array: unknown[] = [];
        for (const v of (object as ${type.name}).${await getFieldName(
          property.uri,
        )}) {
    `;
    yield element;
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
