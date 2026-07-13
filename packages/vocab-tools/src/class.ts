import { generateDecoder, generateEncoder } from "./codec.ts";
import { generateCloner, generateConstructor } from "./constructor.ts";
import { generateFields } from "./field.ts";
import { generateInspector, generateInspectorPostClass } from "./inspector.ts";
import { generateProperties } from "./property.ts";
import {
  type PropertySchema,
  type TypeSchema,
  validateTypeSchemas,
} from "./schema.ts";
import { emitOverride } from "./type.ts";

const XSD_ANY_URI = "http://www.w3.org/2001/XMLSchema#anyURI";
const FEDIFY_URL = "fedify:url";
const INTERNAL_RUNTIME_IMPORTS = [
  "compactJsonLdCache",
  "getJsonLdContext",
  "isTrustedIriOrigin",
  "normalizeJsonLdIris",
].join(",\n    ");
const RUNTIME_IMPORTS = [
  "canParseDecimal",
  "decodeMultibase",
  "type Decimal",
  "type DocumentLoader",
  "encodeMultibase",
  "exportMultibaseKey",
  "exportSpki",
  "formatIri",
  "getDocumentLoader",
  "importMultibaseKey",
  "importPem",
  "isDecimal",
  "isGatewayUrl",
  "LanguageString",
  "parseDecimal",
  "parseGatewayUrl",
  "parseIri",
  "parseJsonLdId",
  "type RemoteDocument",
].join(",\n    ");

/**
 * Sorts the given types topologically so that the base types come before the
 * extended types.
 * @param types The types to sort.
 * @returns The sorted type URIs.
 */
export function sortTopologically(types: Record<string, TypeSchema>): string[] {
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  for (const node of Object.values(types)) {
    visit(node);
  }
  return sorted;

  function visit(node: TypeSchema) {
    if (visited.has(node.uri)) return;
    if (visiting.has(node.uri)) {
      throw new Error(`Detected cyclic inheritance: ${node.uri}`);
    }
    visiting.add(node.uri);
    if (node.extends) visit(types[node.extends]);
    visiting.delete(node.uri);
    visited.add(node.uri);
    sorted.push(node.uri);
  }
}

async function* generateClass(
  typeUri: string,
  types: Record<string, TypeSchema>,
  moduleVarNames: ReadonlyMap<string, string>,
): AsyncIterable<string> {
  const type = types[typeUri];
  yield `/** ${type.description.replaceAll("\n", "\n * ")}\n */\n`;
  if (type.extends) {
    const baseType = types[type.extends];
    yield `export class ${type.name} extends ${baseType.name} {\n`;
  } else {
    yield `export class ${type.name} {\n`;
  }
  if (type.extends == null) {
    yield `
    readonly #documentLoader?: DocumentLoader;
    readonly #contextLoader?: DocumentLoader;
    readonly #tracerProvider?: TracerProvider;
    readonly #warning?: {
      category: string[];
      message: string;
      values?: Record<string, unknown>;
    };
    #cachedJsonLd?: unknown;
    readonly #_baseUrl?: URL;
    #shouldCacheJsonLd = true;
    readonly id: URL | null;

    protected get _documentLoader(): DocumentLoader | undefined {
      return this.#documentLoader;
    }

    protected get _contextLoader(): DocumentLoader | undefined {
      return this.#contextLoader;
    }

    protected get _tracerProvider(): TracerProvider | undefined {
        return this.#tracerProvider;
    }

    protected get _warning(): {
        category: string[];
        message: string;
        values?: Record<string, unknown>;
      } | undefined {
      return this.#warning;
    }

    protected get _cachedJsonLd(): unknown | undefined {
      return this.#cachedJsonLd;
    }

    protected set _cachedJsonLd(value: unknown | undefined) {
      this.#cachedJsonLd = value;
    }

    protected get _baseUrl(): URL | undefined {
      return this.#_baseUrl;
    }

    protected get _shouldCacheJsonLd(): boolean {
      return this.#shouldCacheJsonLd;
    }

    protected set _shouldCacheJsonLd(value: boolean) {
      this.#shouldCacheJsonLd = value;
    }

    protected static _shouldCacheDecodedJsonLd(value: unknown): boolean {
      if (value == null || typeof value !== "object") return true;
      if (!("_shouldCacheJsonLd" in value)) return true;
      return (value as { _shouldCacheJsonLd: boolean })._shouldCacheJsonLd;
    }
    `;
  }
  yield `
    /**
     * The type URI of {@link ${type.name}}: \`${typeUri}\`.
     */
    static ${emitOverride(typeUri, types)} get typeId(): URL {
      return new URL(${JSON.stringify(typeUri)});
    }
  `;
  for await (const code of generateFields(typeUri, types)) yield code;
  for await (const code of generateConstructor(typeUri, types)) yield code;
  for await (const code of generateCloner(typeUri, types)) yield code;
  for await (const code of generateProperties(typeUri, types, moduleVarNames)) {
    yield code;
  }
  for await (const code of generateEncoder(typeUri, types)) yield code;
  for await (const code of generateDecoder(typeUri, types, moduleVarNames)) {
    yield code;
  }
  for await (const code of generateInspector(typeUri, types)) yield code;
  yield "}\n\n";
  for await (const code of generateInspectorPostClass(typeUri, types)) {
    yield code;
  }
}

function* generateEntityTypeHelpers(
  sortedTypeUris: string[],
  types: Record<string, TypeSchema>,
): Iterable<string> {
  const entityTypes = sortedTypeUris.filter((typeUri) => types[typeUri].entity)
    .map((typeUri) => ({ name: types[typeUri].name, uri: typeUri }));
  const entityTypeNames = entityTypes.map((entityType) => entityType.name);
  const entityTypeUnion = entityTypeNames.length < 1
    ? " never"
    : `\n  | typeof ${entityTypeNames.join("\n  | typeof ")}`;
  yield `/**
 * Constructor types for all generated vocabulary entity classes.
 */
export type $EntityType =${entityTypeUnion};

const entityTypes: readonly $EntityType[] = [
`;
  for (const entityTypeName of entityTypeNames) {
    yield `  ${entityTypeName},\n`;
  }
  yield `];

const entityTypeSet: ReadonlySet<$EntityType> = new Set(entityTypes);

const entityTypeIds: ReadonlyMap<string, $EntityType> = new Map<string, $EntityType>(
  [
`;
  for (const entityType of entityTypes) {
    yield `    [${JSON.stringify(entityType.uri)}, ${entityType.name}],\n`;
  }
  yield `  ],
);

/**
 * Checks whether the given value is a generated vocabulary entity class.
 */
export function isEntityType(value: unknown): value is $EntityType {
  return entityTypeSet.has(value as $EntityType);
}

/**
 * Gets the generated vocabulary entity class for the given type URI.
 */
export function getEntityTypeById(id: string | URL): $EntityType | undefined {
  return entityTypeIds.get(typeof id === "string" ? id : id?.href);
}

`;
}

function canContainIriValue(
  property: PropertySchema,
  types: Record<string, TypeSchema>,
): boolean {
  return property.range.some((typeUri) =>
    typeUri === XSD_ANY_URI || typeUri === FEDIFY_URL || types[typeUri]?.entity
  );
}

function addKeys(
  keys: Set<string>,
  property: { uri: string; compactName?: string },
): void {
  keys.add(property.uri);
  if (property.compactName != null) keys.add(property.compactName);
}

function addPortableIriKeys(
  keys: Set<string>,
  property: PropertySchema,
  types: Record<string, TypeSchema>,
): void {
  if (!canContainIriValue(property, types)) return;
  addKeys(keys, property);
  if (
    "redundantProperties" in property &&
    property.redundantProperties != null
  ) {
    for (const redundantProperty of property.redundantProperties) {
      addKeys(keys, redundantProperty);
    }
  }
}

/**
 * Generates the TypeScript classes from the given types.
 * @param types The types to generate classes from.
 * @returns The source code of the generated classes.
 */
export async function* generateClasses(
  types: Record<string, TypeSchema>,
): AsyncIterable<string> {
  validateTypeSchemas(types);
  yield "// deno-lint-ignore-file ban-unused-ignore no-explicit-any no-unused-vars prefer-const verbatim-module-syntax\n";
  yield 'import jsonld from "@fedify/vocab-runtime/jsonld";\n';
  yield 'import { getLogger } from "@logtape/logtape";\n';
  yield `import { type Span, SpanStatusCode, type TracerProvider, trace }
    from "@opentelemetry/api";\n`;
  yield `import {\n    ${RUNTIME_IMPORTS}\n} from "@fedify/vocab-runtime";\n`;
  yield `import {\n    ${INTERNAL_RUNTIME_IMPORTS}\n} from "@fedify/vocab-runtime/internal/jsonld-cache";\n`;
  yield `import {
    isTemporalDuration,
    isTemporalInstant,
} from "@fedify/vocab-runtime/temporal";\n`;
  yield `
function isValidLanguageTag(language: string): boolean {
  try {
    new Intl.Locale(language);
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}
`;
  yield "\n\n";
  const portableIriKeys = new Set(["@id", "id"]);
  for (const type of Object.values(types)) {
    for (const property of type.properties) {
      addPortableIriKeys(portableIriKeys, property, types);
    }
  }
  yield "const PORTABLE_IRI_PATTERN = /^ap(?:\\+ef61)?:\\/\\//i;\n";
  yield `const PORTABLE_IRI_KEYS: ReadonlySet<string> = new Set(${
    JSON.stringify([...portableIriKeys].sort())
  });\n\n`;
  const moduleVarNames = new Map<string, string>();
  const sorted = sortTopologically(types);
  for (const typeUri of sorted) {
    for (const property of types[typeUri].properties) {
      if (property.preprocessors == null) continue;
      for (const pp of property.preprocessors) {
        if (!moduleVarNames.has(pp.module)) {
          const name = `_ppM${moduleVarNames.size}`;
          moduleVarNames.set(pp.module, name);
        }
      }
    }
  }
  for (const [modulePath, varName] of moduleVarNames) {
    yield `import * as ${varName} from ${JSON.stringify(modulePath)};\n`;
  }
  if (moduleVarNames.size > 0) yield "\n";
  for (const typeUri of sorted) {
    for await (const code of generateClass(typeUri, types, moduleVarNames)) {
      yield code;
    }
  }
  for (const code of generateEntityTypeHelpers(sorted, types)) yield code;
}
