import { generateDecoder, generateEncoder } from "./codec.ts";
import { generateCloner, generateConstructor } from "./constructor.ts";
import { generateFields } from "./field.ts";
import { generateInspector } from "./inspector.ts";
import { generateProperties } from "./property.ts";
import type { TypeSchema } from "./schema.ts";
import { emitOverride } from "./type.ts";

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
  for await (const code of generateProperties(typeUri, types)) yield code;
  for await (const code of generateEncoder(typeUri, types)) yield code;
  for await (const code of generateDecoder(typeUri, types)) yield code;
  for await (const code of generateInspector(typeUri, types)) yield code;
  yield "}\n\n";
}

/**
 * Generates the TypeScript classes from the given types.
 * @param types The types to generate classes from.
 * @returns The source code of the generated classes.
 */
export async function* generateClasses(
  types: Record<string, TypeSchema>,
  runtimePath: string,
): AsyncIterable<string> {
  runtimePath = runtimePath.replace(/\/+$/, "");
  yield "// deno-lint-ignore-file ban-unused-ignore prefer-const\n";
  yield "// @ts-ignore TS7016\n";
  yield 'import jsonld from "jsonld";\n';
  yield 'import { getLogger } from "@logtape/logtape";\n';
  yield `import { type Span, SpanStatusCode, type TracerProvider, trace }
    from "@opentelemetry/api";\n`;
  yield `import { LanguageTag, parseLanguageTag }
    from "@phensley/language-tag";\n`;
  yield `import { decode as decodeMultibase, encode as encodeMultibase }
    from "${runtimePath}/multibase/index.ts";`;
  yield `import { type DocumentLoader, getDocumentLoader, type RemoteDocument }
    from "${runtimePath}/docloader.ts";\n`;
  yield `import {
    exportSpki,
    exportMultibaseKey,
    importPem,
    importMultibaseKey,
  } from "${runtimePath}/key.ts";\n`;
  yield `import { LanguageString } from "${runtimePath}/langstr.ts";\n`;
  yield "\n\n";
  const sorted = sortTopologically(types);
  for (const typeUri of sorted) {
    for await (const code of generateClass(typeUri, types)) yield code;
  }
}
