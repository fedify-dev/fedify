import { getFieldName } from "./field.ts";
import type { TypeSchema } from "./schema.ts";
import { hasSingularAccessor, isNonFunctionalProperty } from "./schema.ts";
import { emitOverride } from "./type.ts";

export async function* generateInspector(
  typeUri: string,
  types: Record<string, TypeSchema>,
): AsyncIterable<string> {
  const type = types[typeUri];
  yield `
  protected ${
    emitOverride(typeUri, types)
  } _getCustomInspectProxy(): Record<string, unknown> {
  `;
  if (type.extends == null) {
    yield `
    const proxy: Record<string, unknown> = {};
    if (this.id != null) {
      proxy.id = {
        [Symbol.for("Deno.customInspect")]: (
          inspect: typeof Deno.inspect,
          options: Deno.InspectOptions,
        ): string => "URL " + inspect(this.id!.href, options),
        [Symbol.for("nodejs.util.inspect.custom")]: (
          _depth: number,
          options: unknown,
          inspect: (value: unknown, options: unknown) => string,
        ): string => "URL " + inspect(this.id!.href, options),
      };
    }
    `;
  } else {
    yield "const proxy: Record<string, unknown> = super._getCustomInspectProxy();";
  }
  for (const property of type.properties) {
    const fieldName = await getFieldName(property.uri);
    const localName = await getFieldName(property.uri, "");
    yield `
      const ${localName} = this.${fieldName}
        // deno-lint-ignore no-explicit-any
        .map((v: any) => v instanceof URL
          ? {
              [Symbol.for("Deno.customInspect")]: (
                inspect: typeof Deno.inspect,
                options: Deno.InspectOptions,
              ): string => "URL " + inspect(v.href, options),
              [Symbol.for("nodejs.util.inspect.custom")]: (
                _depth: number,
                options: unknown,
                inspect: (value: unknown, options: unknown) => string,
              ): string => "URL " + inspect(v.href, options),
            }
          : v);
    `;
    if (hasSingularAccessor(property)) {
      yield `
      if (${localName}.length == 1) {
        proxy.${property.singularName} = ${localName}[0];
      }
      `;
    }
    if (isNonFunctionalProperty(property)) {
      yield `
      if (${localName}.length > 1
          || !(${JSON.stringify(property.singularName)} in proxy)
          && ${localName}.length > 0) {
        proxy.${property.pluralName} = ${localName};
      }
      `;
    }
  }
  yield `
    return proxy;
  }
  `;
}

/**
 * Generates code that must appear *after* the class closing brace: prototype
 * assignments for the Deno and Node.js custom-inspect hooks.
 *
 * These are emitted outside the class body because computed property names
 * using `Symbol.for()` are incompatible with `isolatedDeclarations` mode.
 */
export async function* generateInspectorPostClass(
  typeUri: string,
  types: Record<string, TypeSchema>,
): AsyncIterable<string> {
  const type = types[typeUri];
  const className = type.name;
  yield `
// deno-lint-ignore no-explicit-any
(${className}.prototype as any)[Symbol.for("Deno.customInspect")] =
  function (
    this: ${className},
    inspect: typeof Deno.inspect,
    options: Deno.InspectOptions,
  ): string {
    const proxy = this._getCustomInspectProxy();
    return ${JSON.stringify(type.name + " ")} + inspect(proxy, options);
  };

// deno-lint-ignore no-explicit-any
(${className}.prototype as any)[Symbol.for("nodejs.util.inspect.custom")] =
  function (
    this: ${className},
    _depth: number,
    options: unknown,
    inspect: (value: unknown, options: unknown) => string,
  ): string {
    const proxy = this._getCustomInspectProxy();
    return ${JSON.stringify(type.name + " ")} + inspect(proxy, options);
  };
  `;
}
