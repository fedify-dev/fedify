import { getFieldName } from "./field.ts";
import { hasSingularAccessor, isNonFunctionalProperty } from "./schema.ts";
import type { PropertySchema, TypeSchema } from "./schema.ts";
import {
  areAllScalarTypes,
  emitOverride,
  getTypeGuards,
  getTypeNames,
} from "./type.ts";

function generateParameterType(
  property: PropertySchema,
  types: Record<string, TypeSchema>,
): string {
  const range = property.range;
  const scalar = areAllScalarTypes(range, types);
  const code: string[] = [];
  if (hasSingularAccessor(property)) {
    if (scalar) {
      code.push(
        `${property.singularName}?: ${getTypeNames(range, types)} | null;`,
      );
    } else {
      code.push(
        `${property.singularName}?: ${
          getTypeNames(range, types)
        } | URL | null;`,
      );
    }
  }
  if (isNonFunctionalProperty(property)) {
    if (scalar) {
      code.push(
        `${property.pluralName}?: (${getTypeNames(range, types, true)})[];`,
      );
    } else {
      code.push(
        `${property.pluralName}?: (${getTypeNames(range, types)} | URL)[];`,
      );
    }
  }
  return code.join("\n");
}

async function* generateParametersType(
  typeUri: string,
  types: Record<string, TypeSchema>,
  parentheses = true,
  excludeProperties: string[] = [],
): AsyncIterable<string> {
  const type = types[typeUri];
  if (parentheses) yield "{\n";
  if (type.extends == null) {
    yield `id?: URL | null;\n`;
  } else {
    for await (
      const code of generateParametersType(type.extends, types, false, [
        ...excludeProperties,
        ...type.properties.map((p) => p.singularName),
      ])
    ) {
      yield code;
    }
  }
  for (const property of type.properties) {
    if (excludeProperties.includes(property.singularName)) continue;
    yield generateParameterType(property, types);
  }
  if (parentheses) yield "}\n";
}

function generateValidatedArrayCopy(
  name: string,
  typeNames: string,
  typeGuards: string,
): string {
  return `
    let copied!: (${typeNames})[];
    let valid = false;
    if (Array.isArray(values.${name})) {
      const array = values.${name};
      const test = (v: ${typeNames}): boolean => ${typeGuards};
      let checked: VocabArrayValidation | undefined;
      if (array.length < vocabSparseArrayMinimumLength
          ? array.every(test)
          : (checked = vocabValidatePropertyArray(array, test)).valid) {
        const input = values.${name};
        if (input.length < vocabSparseArrayMinimumLength && !checked?.sparse) {
          copied = input.slice();
          valid = true;
        } else {
          const result = vocabCopyValidatedPropertyArray(
            input, test, checked ?? { valid: true, sparse: false },
          );
          if (result.ok) {
            copied = result.array;
            valid = true;
          }
        }
      }
    }
    if (valid) {
  `.trimEnd() + "\n";
}

export async function* generateConstructor(
  typeUri: string,
  types: Record<string, TypeSchema>,
): AsyncIterable<string> {
  const type = types[typeUri];
  yield `
  /**
   * Constructs a new instance of ${type.name} with the given values.
   * @param values The values to initialize the instance with.
   * @param options The options to use for initialization.
   */
  constructor(
    values:
  `;
  for await (const code of generateParametersType(typeUri, types)) yield code;
  yield `,
    options: {
      documentLoader?: DocumentLoader,
      contextLoader?: DocumentLoader,
      tracerProvider?: TracerProvider,
      verifyPortableObject?: PortableObjectVerifier,
    } = {},
  ) {
  `;
  if (type.extends == null) {
    yield `
    this.#documentLoader = options.documentLoader;
    this.#contextLoader = options.contextLoader;
    this.#tracerProvider = options.tracerProvider;
    this.#verifyPortableObject = options.verifyPortableObject;
    const baseUrl = (options as { baseUrl?: URL }).baseUrl;
    this.#_baseUrl = baseUrl == null ? undefined : new URL(baseUrl.href);
    if ("$warning" in options) {
      this.#warning = options.$warning as unknown as {
        category: string[];
        message: string;
        values?: Record<string, unknown>;
      };
    }
    if (values.id == null || values.id instanceof URL) {
      this.id = values.id ?? null;
    } else {
      throw new TypeError("The id must be a URL.");
    }
    `;
  } else {
    yield "super(values, options);";
  }
  for (const property of type.properties) {
    const fieldName = await getFieldName(property.uri);
    const trustFieldName = await getFieldName(property.uri, "#_trust");
    const allScalarTypes = areAllScalarTypes(property.range, types);
    if (hasSingularAccessor(property)) {
      let typeGuards = getTypeGuards(
        property.range,
        types,
        `values.${property.singularName}`,
      );
      let typeNames = getTypeNames(property.range, types);
      const scalar = areAllScalarTypes(property.range, types);
      if (!scalar) {
        typeGuards =
          `${typeGuards} || values.${property.singularName} instanceof URL`;
        typeNames = `${typeNames} | URL`;
      }
      yield `
        if ("${property.singularName}" in values && \
            values.${property.singularName} != null) {
          if (${typeGuards}) {
            // @ts-ignore: type is checked above.
            this.${fieldName} = [values.${property.singularName}];
      `;
      if (!allScalarTypes) yield `this.${trustFieldName}.add(0);`;
      yield `
          } else {
            throw new TypeError(
              "The ${property.singularName} must be of type " +
              ${JSON.stringify(typeNames)} + ".",
            );
          }
        }
      `;
    }
    if (isNonFunctionalProperty(property)) {
      let typeGuards = getTypeGuards(property.range, types, `v`);
      let typeNames = getTypeNames(property.range, types);
      const scalar = areAllScalarTypes(property.range, types);
      if (!scalar) {
        typeGuards = `${typeGuards} || v instanceof URL`;
        typeNames = `${typeNames} | URL`;
      }
      yield `
        if ("${property.pluralName}" in values && \
            values.${property.pluralName} != null) {
      `;
      if (property && property.singularAccessor) {
        yield `
          if ("${property.singularName}" in values &&
              values.${property.singularName} != null) {
            throw new TypeError(
              "Cannot initialize both ${property.singularName} and " +
                "${property.pluralName} at the same time.",
            );
          }
        `;
      }
      yield generateValidatedArrayCopy(
        property.pluralName,
        typeNames,
        typeGuards,
      );
      yield `
            // @ts-ignore: type is checked above.
            this.${fieldName} = copied;
      `;
      if (!allScalarTypes) {
        yield `
            vocabSetTrustPrefix(this.${trustFieldName}, this.${fieldName}.length);
        `;
      }
      yield `
          } else {
            throw new TypeError(
              "The ${property.pluralName} must be an array of type " +
              ${JSON.stringify(typeNames)} + ".",
            );
          }
        }
      `;
    }
  }
  yield "}\n";
}

export async function* generateCloner(
  typeUri: string,
  types: Record<string, TypeSchema>,
): AsyncIterable<string> {
  const type = types[typeUri];
  yield `
  /**
   * Clones this instance, optionally updating it with the given values.
   *
   * This is a shallow copy: property arrays are copied, but nested objects
   * and URLs are shared with this instance.  Dereferencing accessors can cache
   * fetched objects in the instance whose accessor is called.  Hydrating a
   * shared nested object through the clone can affect the original as well,
   * and can change JSON-LD output when either is embedded in another
   * object.  Hydrating a top-level property of the clone does not update this
   * instance's property.
   *
   * To resolve properties without sharing nested objects, use
   * {@link ${type.name}.deepClone} before hydration.
   * See the [vocabulary manual](https://fedify.dev/manual/vocab#immutability)
   * for details, including how cached JSON-LD affects serialization.
   *
   * A clone never inherits a signed JSON-LD representation retained by
   * \`signObject()\`: the clone may differ from the document that the proof
   * covers, so embedding the original secured JSON in a parent document
   * would be wrong.  Sign the clone again if it has to be embedded as a
   * secured child.
   *
   * @param values The values to update the clone with.
   * @param options The options to use for cloning.
   * @returns The cloned instance with its own property arrays.  Nested objects
   *          and URLs are shared with this instance.
   */
  ${emitOverride(typeUri, types)} clone(
    values:
  `;
  for await (const code of generateParametersType(typeUri, types)) yield code;
  yield `
    = {},
    options: {
      documentLoader?: DocumentLoader,
      contextLoader?: DocumentLoader,
      verifyPortableObject?: PortableObjectVerifier,
    } = {}
  ): ${type.name} {
    if (this._warning != null) {
      getLogger(this._warning.category).warn(
        this._warning.message,
        this._warning.values
      );
      // @ts-ignore: $warning is not recognized as a property, but it is.
      options = { ...options, $warning: this._warning };
    }
  `;
  if (type.extends == null) {
    yield `
    // @ts-ignore: this.constructor is not recognized as a constructor, but it is.
    const clone: ${type.name} = new this.constructor(
      { id: values.id ?? this.id },
      options
    );
    copyPortableProvenance(this, clone);
    `;
  } else {
    yield `const clone = super.clone(values, options) as unknown as ${type.name};`;
  }
  for (const property of type.properties) {
    const fieldName = await getFieldName(property.uri);
    const trustFieldName = await getFieldName(property.uri, "#_trust");
    const allScalarTypes = areAllScalarTypes(property.range, types);
    yield `clone.${fieldName} = this.${fieldName}.length < vocabSparseArrayMinimumLength
      ? this.${fieldName}.slice() : vocabCopyPropertyArray(this.${fieldName});`;
    if (!allScalarTypes) {
      yield `clone.${trustFieldName} = vocabCopyTrustSet(
        this.${trustFieldName}, clone.${trustFieldName},
      );`;
    }
    if (hasSingularAccessor(property)) {
      let typeGuards = getTypeGuards(
        property.range,
        types,
        `values.${property.singularName}`,
      );
      let typeNames = getTypeNames(property.range, types);
      const scalar = areAllScalarTypes(property.range, types);
      if (!scalar) {
        typeGuards =
          `${typeGuards} || values.${property.singularName} instanceof URL`;
        typeNames = `${typeNames} | URL`;
      }
      yield `
        if ("${property.singularName}" in values && \
            values.${property.singularName} != null) {
          if (${typeGuards}) {
            // @ts-ignore: type is checked above.
            clone.${fieldName} = [values.${property.singularName}];
      `;
      if (!allScalarTypes) {
        yield `clone.${trustFieldName} = new Set();
          clone.${trustFieldName}[vocabTrustPrefix] = 1;`;
      }
      yield `
          } else {
            throw new TypeError(
              "The ${property.singularName} must be of type " +
              ${JSON.stringify(typeNames)} + ".",
            );
          }
        }
      `;
    }
    if (isNonFunctionalProperty(property)) {
      let typeGuards = getTypeGuards(property.range, types, `v`);
      let typeNames = getTypeNames(property.range, types);
      const scalar = areAllScalarTypes(property.range, types);
      if (!scalar) {
        typeGuards = `${typeGuards} || v instanceof URL`;
        typeNames = `${typeNames} | URL`;
      }
      yield `
        if ("${property.pluralName}" in values && \
            values.${property.pluralName} != null) {
      `;
      if (property.singularAccessor) {
        yield `
          if ("${property.singularName}" in values &&
              values.${property.singularName} != null) {
            throw new TypeError(
              "Cannot update both ${property.singularName} and " +
                "${property.pluralName} at the same time.",
            );
          }
        `;
      }
      yield generateValidatedArrayCopy(
        property.pluralName,
        typeNames,
        typeGuards,
      );
      yield `
            // @ts-ignore: type is checked above.
            clone.${fieldName} = copied;
      `;
      if (!allScalarTypes) {
        yield `
            clone.${trustFieldName} = new Set();
            vocabSetTrustPrefix(clone.${trustFieldName}, clone.${fieldName}.length);
        `;
      }
      yield `
          } else {
            throw new TypeError(
              "The ${property.pluralName} must be an array of type " +
              ${JSON.stringify(typeNames)} + ".",
            );
          }
        }
      `;
    }
  }
  yield `
    return clone;
  }
  `.trimEnd() + "\n";
}

export async function* generateDeepCloner(
  typeUri: string,
  types: Record<string, TypeSchema>,
): AsyncIterable<string> {
  const type = types[typeUri];
  yield `
  /**
   * Copies this instance and its nested vocabulary objects, optionally
   * replacing property values. Replacement values are copied too.
   *
   * Property arrays, URLs and byte arrays are independent of the source.
   * Repeated references remain shared within the copy. References to this
   * source in replacement values receive a separate copy of its pre-update
   * values, rather than referring back to the updated root.
   * Other scalar values, including opaque cryptographic keys, are shared.
   *
   * Each copied object retains its own default loaders, tracer, verifier
   * and base URL. Options override defaults only on the root instance.
   * This method does not fetch or serialize objects. Cached JSON-LD and
   * retained signed representations are not copied; unknown JSON-LD
   * properties and original formatting are not preserved. Sign the copy
   * again if it needs a valid proof.
   *
   * Trust and portable provenance follow clone() rules at every level.
   * Historical referrers within the graph are copied without replacements;
   * referrers outside the graph still point at the original external objects.
   * Custom clone() overrides must return fresh, compatible instances and
   * remain responsible for their own constructor and cloning side effects.
   * Large sparse property arrays with ordinary data entries are copied using
   * a snapshot of their length and present indices. Entries added after a
   * snapshot are not visited; deleted entries are skipped, and values changed
   * after the snapshot are read when reached. Custom
   * clone() overrides must avoid structurally changing a field being copied
   * if they need all its nested objects to be independent of the source.
   *
   * @param values The values to replace before copying the graph.
   * @param options Root loader and verifier overrides. Undefined options
   *                retain the corresponding defaults.
   * @returns An independent copy of the stored vocabulary graph.
   * @since 2.5.0
   */
  ${emitOverride(typeUri, types)} deepClone(values:
  `;
  for await (const code of generateParametersType(typeUri, types)) yield code;
  yield `= {}, options: {
    documentLoader?: DocumentLoader,
    contextLoader?: DocumentLoader,
    verifyPortableObject?: PortableObjectVerifier,
  } = {}): ${type.name} {
    const cloneOptions = {
      documentLoader: options.documentLoader ?? this._documentLoader,
      contextLoader: options.contextLoader ?? this._contextLoader,
      verifyPortableObject: options.verifyPortableObject ?? this._verifyPortableObject,
      tracerProvider: this._tracerProvider,
      baseUrl: this._baseUrl,
    };
    return deepCloneGraph(this, this.clone(values, cloneOptions));
  }\n`;
}
