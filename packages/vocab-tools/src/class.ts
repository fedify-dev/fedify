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

function addPortableIriKeys(
  keys: Set<string>,
  property: PropertySchema,
  types: Record<string, TypeSchema>,
): void {
  if (!canContainIriValue(property, types)) return;
  keys.add(property.uri);
  if (property.compactName != null) keys.add(property.compactName);
  if (
    "redundantProperties" in property &&
    property.redundantProperties != null
  ) {
    for (const redundantProperty of property.redundantProperties) {
      keys.add(redundantProperty.uri);
      if (redundantProperty.compactName != null) {
        keys.add(redundantProperty.compactName);
      }
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
  const runtimeImports = [
    "canParseDecimal",
    "canParseIri",
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
    "LanguageString",
    "parseDecimal",
    "parseIri",
    "type RemoteDocument",
  ];
  yield "// deno-lint-ignore-file ban-unused-ignore no-explicit-any no-unused-vars prefer-const verbatim-module-syntax\n";
  yield 'import jsonld from "@fedify/vocab-runtime/jsonld";\n';
  yield 'import { getLogger } from "@logtape/logtape";\n';
  yield `import { type Span, SpanStatusCode, type TracerProvider, trace }
    from "@opentelemetry/api";\n`;
  yield `import {\n    ${
    runtimeImports.join(",\n    ")
  }\n} from "@fedify/vocab-runtime";\n`;
  yield `import {
    isTemporalDuration,
    isTemporalInstant,
} from "@fedify/vocab-runtime/temporal";\n`;
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
  yield `function isPortableIriValuePosition(
  key: string,
  parentKey?: string,
  portableIriKeys: ReadonlySet<string> = PORTABLE_IRI_KEYS,
): boolean {
  return portableIriKeys.has(key) ||
    ((key === "@value" || key === "@list" || key === "@set") &&
      parentKey != null && portableIriKeys.has(parentKey));
}\n\n`;
  yield `function normalizePortableIris(
  value: unknown,
  key?: string,
  depth = 0,
  parentKey?: string,
  portableIriKeys: ReadonlySet<string> = PORTABLE_IRI_KEYS,
): unknown {
  if (depth > 32 || key === "@context") return value;
  if (typeof value === "string") {
    if (
      key != null &&
      isPortableIriValuePosition(key, parentKey, portableIriKeys) &&
      PORTABLE_IRI_PATTERN.test(value)
    ) {
      return formatIri(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    let clone: unknown[] | undefined;
    for (let i = 0; i < value.length; i++) {
      const result = normalizePortableIris(
        value[i],
        key,
        depth + 1,
        parentKey,
        portableIriKeys,
      );
      if (result !== value[i]) {
        clone ??= value.slice(0, i);
        clone.push(result);
      } else if (clone != null) {
        clone.push(value[i]);
      }
    }
    return clone ?? value;
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  const object = value as Record<string, unknown>;
  let clone: Record<string, unknown> | undefined;
  for (const entryKey of globalThis.Object.keys(object)) {
    const result = normalizePortableIris(
      object[entryKey],
      entryKey,
      depth + 1,
      key,
      portableIriKeys,
    );
    if (result !== object[entryKey]) {
      clone ??= { ...object };
      clone[entryKey] = result;
    }
  }
  return clone ?? object;
}\n\n`;
  yield `function getTopLevelJsonLdTerms(value: unknown): ReadonlySet<string> {
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
}\n\n`;
  yield `async function mergeUnmappedJsonLdTerms(
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
    key !== "@context" && !(key in result)
  );
  if (unmappedKeys.length < 1) return result;
  const compactedTerms = getTopLevelJsonLdTerms(await jsonld.expand(compacted, {
    documentLoader,
  }));
  const dummyPrefix = "urn:fedify:dummy:";
  const dummy: Record<string, unknown> = { "@context": context };
  for (let i = 0; i < unmappedKeys.length; i++) {
    dummy[unmappedKeys[i]] = \`\${dummyPrefix}\${i}\`;
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
      const value = JSON.stringify(termValue);
      for (let i = 0; i < unmappedKeys.length; i++) {
        if (value.includes(\`\${dummyPrefix}\${i}\`)) {
          representedKeys.add(unmappedKeys[i]);
        }
      }
    }
  }
  for (const key of unmappedKeys) {
    if (!representedKeys.has(key)) {
      const value = (original as Record<string, unknown>)[key];
      result[key] = structuredClone(value);
    }
  }
  return result;
}\n\n`;
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
