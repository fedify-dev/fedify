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
    } = {},
  ) {
  `;
  if (type.extends == null) {
    yield `
    this.#documentLoader = options.documentLoader;
    this.#contextLoader = options.contextLoader;
    this.#tracerProvider = options.tracerProvider;
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
            this.${fieldName} = values.${property.pluralName};
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
   * @param values The values to update the clone with.
   * @options The options to use for cloning.
   * @returns The cloned instance.
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
    `;
  } else {
    yield `const clone = super.clone(values, options) as unknown as ${type.name};`;
  }
  for (const property of type.properties) {
    const fieldName = await getFieldName(property.uri);
    yield `clone.${fieldName} = this.${fieldName};`;
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
            clone.${fieldName} = values.${property.pluralName};
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
  `;
}
