import { getFieldName } from "./field.ts";
import { hasSingularAccessor, isNonFunctionalProperty } from "./schema.ts";
import type { TypeSchema } from "./schema.ts";
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

  // @ts-ignore: suppressing TS4127
  ${emitOverride(typeUri, types)} [Symbol.for("Deno.customInspect")](
    inspect: typeof Deno.inspect,
    options: Deno.InspectOptions,
  ): string {
    const proxy = this._getCustomInspectProxy();
    return ${JSON.stringify(type.name + " ")} + inspect(proxy, options);
  }

  // @ts-ignore: suppressing TS4127
  ${emitOverride(typeUri, types)} [Symbol.for("nodejs.util.inspect.custom")](
    _depth: number,
    options: unknown,
    inspect: (value: unknown, options: unknown) => string,
  ): string {
    const proxy = this._getCustomInspectProxy();
    return ${JSON.stringify(type.name + " ")} + inspect(proxy, options);
  }
  `;
}
