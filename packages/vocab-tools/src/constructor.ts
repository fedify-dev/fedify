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
      yield `
          if (Array.isArray(values.${property.pluralName}) &&
              values.${property.pluralName}.every(v => ${typeGuards})) {
            // @ts-ignore: type is checked above.
            this.${fieldName} = values.${property.pluralName}.slice();
      `;
      if (!allScalarTypes) {
        yield `
            for (let i = 0; i < values.${property.pluralName}.length; i++) {
              this.${trustFieldName}.add(i);
            }
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
   * To resolve properties without sharing nested objects, serialize and
   * re-parse the instance before hydration rather than using this method.
   * See the [vocabulary manual](https://fedify.dev/manual/vocab#immutability)
   * for details, including how cached JSON-LD affects serialization.
   *
   * A clone never inherits a signed JSON-LD representation retained by
   * \`signObject()\`: the clone may differ from the document that the proof
   * covers, so embedding the original secured JSON in a parent document
   * would be wrong.  Sign the clone again if it has to be embedded as a
   * secured child.
   *
   * The clone does not inherit this instance's default FEP-ef61 portable
   * object verifier, i.e., the \`verifyPortableObject\` option given when this
   * instance was constructed, parsed, or fetched by an accessor, nor its
   * \`documentLoader\` or \`contextLoader\`.  Without a verifier, the clone's
   * accessors no longer verify embedded portable objects, and refuse to
   * dereference portable references.  To keep verifying them, pass
   * \`verifyPortableObject\` in \`options\`, or serialize this instance and
   * re-parse it with \`fromJsonLd()\` and the verifier.  A verifier is only
   * a policy for dereferencing; passing one does not verify the clone itself.
   *
   * Cloning an instance that has a default verifier without passing
   * the \`verifyPortableObject\` option logs a warning in the
   * \`["fedify", "vocab", "portable"]\` category.  Pass
   * \`verifyPortableObject: undefined\` to drop the verifier deliberately
   * without the warning.  Either way, nested objects shared with this
   * instance keep their own defaults.
   *
   * @param values The values to update the clone with.
   * @param options The options to use for cloning.
   *
   *                - \`documentLoader\`: The document loader for the clone.
   *                - \`contextLoader\`: The JSON-LD context loader for
   *                  the clone.
   *                - \`verifyPortableObject\`: The default FEP-ef61 portable
   *                  object verifier for the clone.  It is not inherited from
   *                  this instance.  Pass \`undefined\` explicitly to clone
   *                  without a verifier and without a warning.
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
      verifyPortableObject?: PortableObjectVerifier | undefined,
    } = {}
  ): ${type.name} {
    if (this._warning != null) {
      getLogger(this._warning.category).warn(
        this._warning.message,
        this._warning.values
      );
      // Keep an explicit verifyPortableObject option, even an inherited or
      // non-enumerable one, since its presence decides whether to warn below:
      options = {
        ...options,
        ...("verifyPortableObject" in options
          ? { verifyPortableObject: options.verifyPortableObject }
          : {}),
        $warning: this._warning,
      } as typeof options;
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
    yield `clone.${fieldName} = this.${fieldName}.slice();`;
    if (!allScalarTypes) {
      yield `clone.${trustFieldName} = new Set(this.${trustFieldName});`;
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
        yield `clone.${trustFieldName} = new Set([0]);`;
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
      yield `
          if (Array.isArray(values.${property.pluralName}) &&
              values.${property.pluralName}.every(v => ${typeGuards})) {
            // @ts-ignore: type is checked above.
            clone.${fieldName} = values.${property.pluralName}.slice();
      `;
      if (!allScalarTypes) {
        yield `
            clone.${trustFieldName} = new Set();
            for (let i = 0; i < values.${property.pluralName}.length; i++) {
              clone.${trustFieldName}.add(i);
            }
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
  if (type.extends == null) {
    yield `
    if (
      this._verifyPortableObject != null &&
      !("verifyPortableObject" in options)
    ) {
      getLogger(["fedify", "vocab", "portable"]).warn(
        "Cloning {typeName} {objectId} drops its default portable object " +
          "verifier, since clone() does not inherit it.  Pass " +
          "the verifyPortableObject option to clone() to keep verifying " +
          "portable objects, or verifyPortableObject: undefined to drop " +
          "the verifier deliberately without this warning.",
        { typeName: this.constructor.name, objectId: this.id?.href ?? "(no id)" },
      );
    }
    `;
  }
  yield `
    return clone;
  }
  `;
}
