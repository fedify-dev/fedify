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
  readonly values: (object: object) => readonly unknown[];
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

function isSameRawPropertyNode(source: unknown, destination: unknown): boolean {
  if (
    source == null || destination == null ||
    typeof source !== "object" || typeof destination !== "object" ||
    !(RAW_PROPERTY_PROTOCOL in source) || !(RAW_PROPERTY_PROTOCOL in destination)
  ) {
    return false;
  }
  const sourceId = (source as unknown as { id: URL | null }).id;
  const destinationId = (destination as unknown as { id: URL | null }).id;
  return sourceId?.href === destinationId?.href;
}

function getRawPropertyDescriptors(object: object): Set<RawPropertyDescriptor> {
  const descriptors = new Set<RawPropertyDescriptor>();
  let prototype: object | null = globalThis.Object.getPrototypeOf(object);
  while (prototype != null) {
    for (const descriptor of rawPropertyDescriptors.get(prototype)?.values() ?? []) {
      descriptors.add(descriptor);
    }
    prototype = globalThis.Object.getPrototypeOf(prototype);
  }
  return descriptors;
}

// Merges the retained unknown properties of a decoded object into a copy that
// was decoded again by a different class.  The classes classify properties
// differently, so the copy keeps what it retained itself and gains the
// original's values for the properties its own class does not know either:
function mergeRawProperties(source: object, destination: object): void {
  const retained = retainedRawProperties.get(source);
  if (retained == null) return;
  const merged: Record<string, readonly unknown[]> = {
    ...retainedRawProperties.get(destination),
  };
  let changed = false;
  for (const [iri, values] of globalThis.Object.entries(retained)) {
    if (getRawPropertyDescriptor(destination, iri) != null) continue;
    merged[iri] = values;
    changed = true;
  }
  if (changed) {
    retainedRawProperties.set(
      destination,
      globalThis.Object.freeze(merged) as RetainedRawProperties,
    );
  }
}

// Copies the retained unknown properties of a decoded object and of the
// objects nested in it to a copy of the same graph that was decoded again,
// pairing nested objects by property and position.  Only objects with the same
// id are paired.  When the decoding dropped some values of a property,
// positions no longer correspond, so nested objects are paired by id alone.
// When the copy was decoded by a different class, the retained properties are
// merged rather than replaced, and only the properties both classes declare,
// matched by their IRIs, are followed:
function copyRawPropertiesDeep(
  source: object,
  destination: object,
  visited: Set<object> = new Set(),
): void {
  if (visited.has(destination)) return;
  visited.add(destination);
  if (!isSameRawPropertyNode(source, destination)) return;
  const sameClass = globalThis.Object.getPrototypeOf(source) ===
    globalThis.Object.getPrototypeOf(destination);
  if (sameClass) copyRawProperties(source, destination);
  else mergeRawProperties(source, destination);
  for (const descriptor of getRawPropertyDescriptors(destination)) {
    // Sibling classes declare the same property with distinct descriptors, so
    // each object is read through its own class's descriptor:
    const sourceDescriptor = sameClass
      ? descriptor
      : getRawPropertyDescriptor(source, descriptor.canonicalIri);
    if (sourceDescriptor == null) continue;
    const sources = sourceDescriptor.values(source);
    const destinations = descriptor.values(destination);
    const aligned = sources.length === destinations.length;
    for (let i = 0; i < destinations.length; i++) {
      const destination = destinations[i];
      const source = aligned
        ? sources[i]
        : (destination as { id?: URL | null } | null)?.id == null
        ? undefined
        : sources.find((s) => isSameRawPropertyNode(s, destination));
      if (source !== destination && isSameRawPropertyNode(source, destination)) {
        copyRawPropertiesDeep(source as object, destination as object, visited);
      }
    }
  }
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
      values(object: object): readonly unknown[] {
        return (object as ${type.name}).${await getFieldName(property.uri)};
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
