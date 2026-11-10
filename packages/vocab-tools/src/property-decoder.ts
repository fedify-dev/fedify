import type {
  PropertySchema,
  PropertyPreprocessorSchema,
  TypeSchema,
} from "./schema.ts";
import { isNonFunctionalProperty } from "./schema.ts";
import {
  areAllScalarTypes,
  getDataCheck,
  getDecoder,
  getTypeNames,
  skipsUnparsable,
} from "./type.ts";

function* generatePreprocessorBlock(
  property: { preprocessors?: PropertyPreprocessorSchema[] },
  rangeTypeName: string,
  variable: string,
  baseUrlExpr: string,
  moduleVarNames: ReadonlyMap<string, string>,
): Iterable<string> {
  if (property.preprocessors == null || property.preprocessors.length === 0) {
    return;
  }
  yield `
      {
        let _handled: ${rangeTypeName} | undefined;
      `;
  for (const pp of property.preprocessors) {
    const varName = moduleVarNames.get(pp.module);
    if (varName == null) {
      throw new Error(
        `Preprocessor module "${pp.module}" is not registered ` +
          `in the generated imports. Ensure all preprocessor ` +
          `modules used in property schemas are available.`,
      );
    }
    yield `
        if (_handled === undefined) {
          const _result = await ${varName}[${JSON.stringify(pp.function)}](v, {
            documentLoader: options.documentLoader,
            contextLoader: options.contextLoader,
            tracerProvider: options.tracerProvider,
            verifyPortableObject: options.verifyPortableObject,
            baseUrl: ${baseUrlExpr},
          });
          if (_result instanceof Error) throw _result;
          if (_result !== undefined) {
            _handled = (isRawPropertyWrite(options) && _result != null &&
                typeof _result === "object" && RAW_PROPERTY_PROTOCOL in _result
              ? await isolatePreprocessedRawPropertyObject(_result, v) : _result) as ${rangeTypeName};
            if (!isRawPropertyWrite(options)) retainPreprocessedRawProperties(_handled, v);
          }
        }
      `;
  }
  yield `
        if (_handled !== undefined) {
          // The document does not describe what a preprocessor made of it:
          skipReceivedJsonLd(_handled);
          ${variable}.push(_handled);
          continue;
        }
      }
      `;
}

/** Scalar decoders may normalize metadata, but cannot keep node payloads. */
function checkedDecoderInput(
  typeUri: string,
  types: Record<string, TypeSchema>,
): string {
  const check = getDataCheck(typeUri, types, "v");
  if (typeUri in types) return check;
  return `(${check}) && (!isRawPropertyWrite(options) || "@value" in v ||
    globalThis.Object.keys(v).every(key => key === "@id" || key === "@type" || key === "@index"))`;
}

/** Emits the shared ordinary/strict property decoder loop. */
export function* generatePropertyDecoder(
  property: PropertySchema,
  types: Record<string, TypeSchema>,
  variable: string,
  arrayVariable: string,
  moduleVarNames: ReadonlyMap<string, string>,
  cacheCheck?: string,
): Iterable<string> {
  if (!isNonFunctionalProperty(property) || property.container !== "list") {
    yield `
      if (isRawPropertyWrite(options) && ${arrayVariable}?.some(
          (value: unknown) => value != null && typeof value === "object" && "@list" in value)) {
        throw new TypeError("This known property does not support a list container.");
      }
    `;
  }
  yield `
    if (isRawPropertyWrite(options) && ${arrayVariable}?.length === 1 &&
        "@list" in ${arrayVariable}[0] && ${arrayVariable}[0]["@list"].length === 0) {
      throw new TypeError("An empty known list cannot be represented; use an empty values array to remove the property.");
    }
  `;
  let itemsExpression = `${arrayVariable}.length === 1 && "@list" in ${arrayVariable}[0]
        ? ${arrayVariable}[0]["@list"]
        : ${arrayVariable}`;
  if (isNonFunctionalProperty(property) && property.container === "graph") {
    itemsExpression = `(${itemsExpression}).flatMap((item: unknown) => {
          if (item != null && typeof item === "object" && "@graph" in item &&
              Array.isArray((item as { "@graph": unknown })["@graph"])) {
            const graph = (item as { "@graph": unknown[] })["@graph"];
            if (isRawPropertyWrite(options) && globalThis.Object.keys(item).some(
                key => key !== "@graph" && key !== "@index")) {
              throw new TypeError("The known graph container cannot represent wrapper data.");
            }
            if (isRawPropertyWrite(options) && graph.length === 0) {
              throw new TypeError("An empty known graph cannot be represented; use an empty values array to remove the property.");
            }
            return graph;
          }
          return [item];
        })`;
  }
  yield `
    for (
      const v of ${arrayVariable} == null
        ? []
        : ${itemsExpression}
    ) {
      if (v == null) {
        if (isRawPropertyWrite(options)) throw new TypeError("Cannot decode a supplied raw property value.");
        continue;
      }
    `;
  yield `
      if (isRawPropertyWrite(options) && typeof v === "object" && "@graph" in v) {
        throw new TypeError("This known property cannot represent a remaining graph wrapper.");
      }
  `;
  const propertyBaseUrl = "options.baseUrl";
  yield* generatePreprocessorBlock(
    property,
    getTypeNames(property.range, types),
    variable,
    propertyBaseUrl,
    moduleVarNames,
  );
  if (!areAllScalarTypes(property.range, types)) {
    yield `
      if (typeof v === "object" && "@id" in v && !("@type" in v)
          && globalThis.Object.keys(v).length === 1) {
        if (v["@id"].startsWith("_:")) {
          if (isRawPropertyWrite(options)) throw new TypeError("Cannot decode a blank node reference.");
          continue;
        }
        ${variable}.push(parseIri(v["@id"], ${propertyBaseUrl}));
        continue;
      }
      `;
  }
  if (property.range.length === 1) {
    yield `if (isRawPropertyWrite(options) && !(`;
    yield checkedDecoderInput(property.range[0], types);
    if (property.range[0] in types) {
      // A typeless node is accepted by the ordinary object decoder.
      yield ` || (typeof v === "object" && !("@value" in v) && !("@list" in v) && !("@type" in v))`;
    }
    yield `)) throw new TypeError("Cannot decode a supplied raw property value.");`;
  }
  yield `
      const decoded =
    `;
  const lenient =
    property.range.length == 1 && skipsUnparsable(property.range[0]);
  if (property.range.length == 1) {
    if (lenient) {
      yield checkedDecoderInput(property.range[0], types);
      yield " ? ";
    }
    yield getDecoder(property.range[0], types, "v", "options", propertyBaseUrl);
    if (lenient) yield " : undefined";
  } else {
    for (const typeUri of property.range) {
      yield checkedDecoderInput(typeUri, types);
      yield " ? ";
      yield getDecoder(typeUri, types, "v", "options", propertyBaseUrl);
      yield " : ";
    }
    yield "undefined";
  }
  yield `
      ;
    `;
  yield `
      if (typeof decoded === "undefined") {
        if (isRawPropertyWrite(options)) throw new TypeError("Cannot decode a supplied raw property value.");
        shouldCacheJsonLd = false;
        continue;
      }
    `;
  if (cacheCheck != null)
    yield `
      if (!${cacheCheck}) {
        shouldCacheJsonLd = false;
      }
  `;
  yield `
      keepReceivedJsonLd(decoded, v, options);
      ${variable}.push(decoded);
    `;
  yield `\n    }\n`;
}
