import { type Schema as JsonSchema, Validator } from "@cfworker/json-schema";
import { readFile } from "node:fs/promises";
import { join, posix as url } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { readDirRecursive } from "./fs.ts";

/**
 * The qualified URI of a type.  It is used as the range of a property.
 */
export type TypeUri =
  | `https://${string}`
  | `http://${string}`
  | `fedify:${string}`;

/**
 * The schema of a type.  It is used to generate a class.
 */
export interface TypeSchema {
  /**
   * The type name.  It is used as the name of the generated class.
   */
  name: string;

  /**
   * The qualified URI of the type.
   */
  uri: TypeUri;

  /**
   * The qualified URIs of the base type of the type (if any).
   */
  extends?: TypeUri;

  /**
   * The type name used in the compacted JSON-LD document.  It is used as the
   * value of the `type` field.
   */
  compactName?: string;

  /**
   * Marks the type an entity type rather than a value type.  Turning on this
   * flag will make property accessors for the type asynchronous, so that they
   * can load the values of the properties from the remote server.
   *
   * The extended subtypes must have the consistent value of this flag.
   */
  entity: boolean;

  /**
   * The description of the type.  It is used as the doc comment of
   * the generated class.
   */
  description: string;

  /**
   * The possible properties of the type.
   */
  properties: PropertySchema[];

  /**
   * The default JSON-LD context of the type.  It is used as the default
   * context of the generated `toJsonLd()` method.
   */
  defaultContext: Context;
}

export interface PropertySchemaBase {
  /**
   * The singular form of the property name.  It is used as the name of the
   * generated property accessors.
   */
  singularName: string;

  /**
   * The qualified URI of the property.
   */
  uri: string;

  /**
   * The property name used in the compacted JSON-LD document.  It is used as
   * the key of the property.
   */
  compactName?: string;

  /**
   * The qualified URI of the superproperty of the property (if any).
   * It means that the property is a specialization of the referenced property.
   */
  subpropertyOf?: string;

  /**
   * The description of the property.  It is used as the doc comment of
   * the generated property accessors.
   */
  description: string;

  /**
   * Whether the enclosed object should have its own context when the document
   * is compacted.
   */
  embedContext?: {
    /**
     * The compact name of the property that contains the context.
     */
    compactName: string;

    /**
     * Whether the embedded context should be the same as the context of
     * the enclosing document.
     */
    inherit: true;
  };
}

export type PropertySchemaTyping = {
  /**
   * Whether the property value has `@type` field.  If `true`, the `range` must
   * have only one element.
   */
  untyped?: false;

  /**
   * The qualified URIs of all possible types of the property values.
   */
  range: [TypeUri] | [TypeUri, ...TypeUri[]];
} | {
  /**
   * Whether the property value has `@type` field.  If `true`, the `range` must
   * have only one element.
   */
  untyped: true;

  /**
   * The qualified URIs of all possible types of the property values.
   */
  range: [TypeUri];
};

/**
 * The schema of a property.  It is used to generate property accessors of
 * a class.
 */
export type PropertySchema =
  | PropertySchemaBase & PropertySchemaTyping & {
    /**
     * Marks the property that it can have only one value.  Turning on this
     * flag will generate only singular property accessors, so `pluralName`
     * and `singularAccessor` should not be specified.
     */
    functional?: false;

    /**
     * The plural form of the property name.  It is used as the name of the
     * generated property accessors.
     */
    pluralName: string;

    /**
     * Whether to generate singular property accessors.  Regardless of this
     * flag, plural property accessors are generated (unless `functional` is
     * turned on).
     */
    singularAccessor?: boolean;

    /**
     * The container type of the property values.  It can be unspecified.
     */
    container?: "graph" | "list";
  }
  | PropertySchemaBase & PropertySchemaTyping & {
    /**
     * Marks the property that it can have only one value.  Turning on this
     * flag will generate only singular property accessors, so `pluralName`
     * and `singularAccessor` should not be specified.
     */
    functional: true;

    /**
     * If it's present, those redundant properties are also filled with
     * the same value altogether when the object is serialized into
     * JSON-LD.  When it's deserialized from JSON-LD, it tries to
     * parse the values of the specified properties in order.
     */
    redundantProperties?: {
      /**
       * The qualified URI of the property.
       */
      uri: string;

      /**
       * The property name used in the compacted JSON-LD document.  It is used
       * as the key of the property.
       */
      compactName?: string;
    }[];
  };

/**
 * A JSON-LD context, which is placed in the `@context` property of a JSON-LD
 * document.
 */
export type Context = Uri | EmbeddedContext | (Uri | EmbeddedContext)[];

type Uri = "http://{string}" | "https://{string}";
type EmbeddedContext = Record<string, TermDefinition>;
type TermDefinition = Uri | Record<string, Uri | "@id">;

/**
 * Type guard to check if a property is not functional (has pluralName).
 */
export function isNonFunctionalProperty(
  property: PropertySchema,
): property is PropertySchemaBase & PropertySchemaTyping & {
  functional?: false;
  pluralName: string;
  singularAccessor?: boolean;
  container?: "graph" | "list";
} {
  return property.functional !== true;
}

/**
 * Type guard to check if a property has singular accessor.
 */
export function hasSingularAccessor(property: PropertySchema): boolean {
  if (property.functional === true) return true;
  return isNonFunctionalProperty(property) &&
    property.singularAccessor === true;
}

/**
 * An error that occurred while loading a schema file.
 */
export class SchemaError extends Error {
  /**
   * The path of the schema file.
   */
  readonly path: string;

  /**
   * Constructs a new `SchemaError`.
   * @param path The path of the schema file.
   * @param message The error message.
   */
  constructor(path: string, message?: string) {
    super(message);
    this.path = path;
  }
}

async function loadSchemaValidator(): Promise<Validator> {
  const thisFile = import.meta.url;
  const schemaFile = new URL(url.join(url.dirname(thisFile), "schema.yaml"));
  let content: string;
  if (schemaFile.protocol !== "file:") {
    const response = await fetch(schemaFile);
    content = await response.text();
  } else {
    content = await readFile(fileURLToPath(schemaFile), { encoding: "utf-8" });
  }
  const schemaObject = parse(content);
  return new Validator(schemaObject as JsonSchema);
}

let schemaValidator: Validator | undefined = undefined;

async function loadSchema(path: string): Promise<TypeSchema> {
  const content = await readFile(path, { encoding: "utf-8" });
  const schema = parse(content);
  if (schemaValidator == null) schemaValidator = await loadSchemaValidator();
  const result = schemaValidator.validate(schema);
  const errors: SchemaError[] = [];
  if (result.valid) return schema as TypeSchema;
  for (const e of result.errors) {
    errors.push(
      new SchemaError(path, `${path}:${e.instanceLocation}: ${e.error}`),
    );
  }
  throw new AggregateError(errors);
}

/**
 * Loads all schema files in the directory.
 * @param dir The path of the directory to load schema files from.
 * @returns A map from the qualified URI of a type to its {@link TypeSchema}.
 * @throws {@link AggregateError} if any schema file is invalid.  It contains
 *         all {@link SchemaError}s of the invalid schema files.
 */
export async function loadSchemaFiles(
  dir: string,
): Promise<Record<string, TypeSchema>> {
  if (typeof dir !== "string") {
    throw new TypeError("Expected a directory path in string");
  }
  const result: Record<string, TypeSchema> = {};
  const errors: SchemaError[] = [];
  for await (const relPath of readDirRecursive(dir)) {
    if (!relPath.match(/\.ya?ml$/i)) continue;
    if (relPath.match(/(^|[/\\])schema.yaml$/i)) continue;
    const path = join(dir, relPath);
    let schema: TypeSchema;
    try {
      schema = await loadSchema(path);
    } catch (e) {
      if (
        e instanceof AggregateError && e.errors.length > 0 &&
        e.errors[0] instanceof SchemaError
      ) {
        errors.push(...e.errors);
        continue;
      }
      throw e;
    }
    result[schema.uri] = schema;
  }
  if (errors.length > 0) throw new AggregateError(errors);
  const entries = Object.entries(result);
  entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return Object.fromEntries(entries);
}
