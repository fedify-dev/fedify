import { pascalCase } from "es-toolkit";
import metadata from "../../deno.json" with { type: "json" };
import { getFieldName } from "./field.ts";
import { hasSingularAccessor, isNonFunctionalProperty } from "./schema.ts";
import type { PropertySchema, TypeSchema } from "./schema.ts";
import { areAllScalarTypes, getTypeNames } from "./type.ts";

function emitOverride(
  typeUri: string,
  types: Record<string, TypeSchema>,
  property: PropertySchema,
): string {
  const type = types[typeUri];
  let supertypeUri = type.extends;
  while (supertypeUri != null) {
    const st = types[supertypeUri];
    if (st.properties.find((p) => p.singularName === property.singularName)) {
      return "override";
    }
    supertypeUri = st.extends;
  }
  return "";
}

async function* generateProperty(
  type: TypeSchema,
  property: PropertySchema,
  types: Record<string, TypeSchema>,
): AsyncIterable<string> {
  const override = emitOverride(type.uri, types, property);
  const doc = `\n/** ${property.description.replaceAll("\n", "\n * ")}\n */\n`;
  if (areAllScalarTypes(property.range, types)) {
    if (hasSingularAccessor(property)) {
      yield doc;
      yield `${override} get ${property.singularName}(): (${
        getTypeNames(property.range, types)
      } | null) {
        if (this._warning != null) {
          getLogger(this._warning.category).warn(
            this._warning.message,
            this._warning.values
          );
        }
        if (this.${await getFieldName(property.uri)}.length < 1) return null;
        return this.${await getFieldName(property.uri)}[0];
      }
      `;
    }
    if (isNonFunctionalProperty(property)) {
      yield doc;
      yield `get ${property.pluralName}(): (${
        getTypeNames(property.range, types, true)
      })[] {
        return this.${await getFieldName(property.uri)};
      }
      `;
    }
  } else {
    yield `
    async #fetch${pascalCase(property.singularName)}(
      url: URL,
      options: {
        documentLoader?: DocumentLoader,
        contextLoader?: DocumentLoader,
        suppressError?: boolean,
        tracerProvider?: TracerProvider,
        crossOrigin?: "ignore" | "throw" | "trust";
      } = {},
    ): Promise<${getTypeNames(property.range, types)} | null> {
      const documentLoader =
        options.documentLoader ?? this._documentLoader ?? getDocumentLoader();
      const contextLoader =
        options.contextLoader ?? this._contextLoader ?? getDocumentLoader();
      const tracerProvider = options.tracerProvider ??
        this._tracerProvider ?? trace.getTracerProvider();
      const tracer = tracerProvider.getTracer(
        ${JSON.stringify(metadata.name)},
        ${JSON.stringify(metadata.version)},
      );
      return await tracer.startActiveSpan("activitypub.lookup_object", async (span) => {
        let fetchResult: RemoteDocument;
        try {
          fetchResult = await documentLoader(url.href);
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: String(error),
          });
          span.end();
          if (options.suppressError) {
            getLogger(["fedify", "vocab"]).error(
              "Failed to fetch {url}: {error}",
              { error, url: url.href }
            );
            return null;
          }
          throw error;
        }
        const { document, documentUrl } = fetchResult;
        const baseUrl = new URL(documentUrl);
        try {
          const obj = await this.#${property.singularName}_fromJsonLd(
            document,
            { documentLoader, contextLoader, tracerProvider, baseUrl }
          );
          if (options.crossOrigin !== "trust" && obj?.id != null &&
              obj.id.origin !== baseUrl.origin) {
            if (options.crossOrigin === "throw") {
              throw new Error(
                "The object's @id (" + obj.id.href + ") has a different origin " +
                "than the document URL (" + baseUrl.href + "); refusing to return " +
                "the object.  If you want to bypass this check and are aware of" +
                'the security implications, set the crossOrigin option to "trust".'
              );
            }
            getLogger(["fedify", "vocab"]).warn(
              "The object's @id ({objectId}) has a different origin than the document " +
              "URL ({documentUrl}); refusing to return the object.  If you want to " +
              "bypass this check and are aware of the security implications, " +
              'set the crossOrigin option to "trust".',
              { ...fetchResult, objectId: obj.id.href },
            );
            return null;
          }
          span.setAttribute("activitypub.object.id", (obj.id ?? url).href);
          span.setAttribute(
            "activitypub.object.type",
            // @ts-ignore: obj.constructor always has a typeId.
            obj.constructor.typeId.href
          );
          return obj;
        } catch (e) {
          if (options.suppressError) {
            getLogger(["fedify", "vocab"]).error(
              "Failed to parse {url}: {error}",
              { error: e, url: url.href }
            );
            return null;
          }
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: String(e),
          });
          throw e;
        } finally {
          span.end();
        }
      });
    }

    async #${property.singularName}_fromJsonLd(
      jsonLd: unknown,
      options: {
        documentLoader?: DocumentLoader,
        contextLoader?: DocumentLoader,
        tracerProvider?: TracerProvider,
        baseUrl?: URL
      }
    ): Promise<${getTypeNames(property.range, types)}> {
      const documentLoader =
        options.documentLoader ?? this._documentLoader ?? getDocumentLoader();
      const contextLoader =
        options.contextLoader ?? this._contextLoader ?? getDocumentLoader();
      const tracerProvider = options.tracerProvider ??
        this._tracerProvider ?? trace.getTracerProvider();
      const baseUrl = options.baseUrl;
    `;
    for (const range of property.range) {
      if (!(range in types)) continue;
      const rangeType = types[range];
      yield `
        try {
          return await ${rangeType.name}.fromJsonLd(
            jsonLd,
            { documentLoader, contextLoader, tracerProvider, baseUrl },
          );
        } catch (e) {
          if (!(e instanceof TypeError)) throw e;
        }
      `;
    }
    yield `
      throw new TypeError("Expected an object of any type of: " +
        ${JSON.stringify(property.range)}.join(", "));
    }

    `;
    if (hasSingularAccessor(property)) {
      yield `
      /**
       * Similar to
       * {@link ${type.name}.get${pascalCase(property.singularName)}},
       * but returns its \`@id\` URL instead of the object itself.
       */
      ${override} get ${property.singularName}Id(): URL | null {
        if (this._warning != null) {
          getLogger(this._warning.category).warn(
            this._warning.message,
            this._warning.values
          );
        }
        if (this.${await getFieldName(property.uri)}.length < 1) return null;
        const v = this.${await getFieldName(property.uri)}[0];
        if (v instanceof URL) return v;
        return v.id;
      }
      `;
      yield doc;
      yield `
      ${override} async get${pascalCase(property.singularName)}(
        options: {
          documentLoader?: DocumentLoader,
          contextLoader?: DocumentLoader,
          suppressError?: boolean,
          tracerProvider?: TracerProvider,
          crossOrigin?: "ignore" | "throw" | "trust";
        } = {}
      ): Promise<${getTypeNames(property.range, types)} | null> {
        if (this._warning != null) {
          getLogger(this._warning.category).warn(
            this._warning.message,
            this._warning.values
          );
        }
        if (this.${await getFieldName(property.uri)}.length < 1) return null;
        let v = this.${await getFieldName(property.uri)}[0];
        if (options.crossOrigin !== "trust" && !(v instanceof URL) &&
            v.id != null && v.id.origin !== this.id?.origin &&
            !this.${await getFieldName(property.uri, "#_trust")}.has(0)) {
          v = v.id;
        }
        if (v instanceof URL) {
          const fetched =
            await this.#fetch${pascalCase(property.singularName)}(v, options);
          if (fetched == null) return null;
          this.${await getFieldName(property.uri)}[0] = fetched;
          this.${await getFieldName(property.uri, "#_trust")}.add(0);
          this._cachedJsonLd = undefined;
          return fetched;
        }
      `;
      if (property.compactName != null) {
        yield `
        if (
          this._cachedJsonLd != null &&
          typeof this._cachedJsonLd === "object" &&
          "@context" in this._cachedJsonLd &&
          ${JSON.stringify(property.compactName)} in this._cachedJsonLd
        ) {
          const prop = this._cachedJsonLd[
            ${JSON.stringify(property.compactName)}];
          const doc = Array.isArray(prop) ? prop[0] : prop;
          if (doc != null && typeof doc === "object" && "@context" in doc) {
            v = await this.#${property.singularName}_fromJsonLd(doc, options);
          }
        }
        `;
      }
      yield `
        if (options.crossOrigin !== "trust" && v?.id != null &&
            this.id != null && v.id.origin !== this.id.origin &&
            !this.${await getFieldName(property.uri, "#_trust")}.has(0)) {
          if (options.crossOrigin === "throw") {
            throw new Error(
              "The property object's @id (" + v.id.href + ") has a different " +
              "origin than the property owner's @id (" + this.id.href + "); " +
              "refusing to return the object.  If you want to bypass this " +
              "check and are aware of the security implications, set the " +
              'crossOrigin option to "trust".'
            );
          }
          getLogger(["fedify", "vocab"]).warn(
            "The property object's @id ({objectId}) has a different origin " +
            "than the property owner's @id ({parentObjectId}); refusing to " +
            "return the object.  If you want to bypass this check and are " +
            "aware of the security implications, set the crossOrigin option " +
            'to "trust".',
            { objectId: v.id.href, parentObjectId: this.id.href },
          );
          return null;
        }
        return v;
      }
      `;
    }
    if (isNonFunctionalProperty(property)) {
      yield `
      /**
       * Similar to
       * {@link ${type.name}.get${pascalCase(property.pluralName)}},
       * but returns their \`@id\`s instead of the objects themselves.
       */
      ${override} get ${property.singularName}Ids(): URL[] {
        if (this._warning != null) {
          getLogger(this._warning.category).warn(
            this._warning.message,
            this._warning.values
          );
        }
        return this.${await getFieldName(property.uri)}.map((v) =>
          v instanceof URL ? v : v.id!
        ).filter(id => id !== null);
      }
      `;
      yield doc;
      yield `
      ${override} async* get${pascalCase(property.pluralName)}(
        options: {
          documentLoader?: DocumentLoader,
          contextLoader?: DocumentLoader,
          suppressError?: boolean,
          tracerProvider?: TracerProvider,
          crossOrigin?: "ignore" | "throw" | "trust";
        } = {}
      ): AsyncIterable<${getTypeNames(property.range, types)}> {
        if (this._warning != null) {
          getLogger(this._warning.category).warn(
            this._warning.message,
            this._warning.values
          );
        }
        const vs = this.${await getFieldName(property.uri)};
        for (let i = 0; i < vs.length; i++) {
          let v = vs[i];
          if (options.crossOrigin !== "trust" && !(v instanceof URL) &&
              v.id != null && v.id.origin !== this.id?.origin &&
              !this.${await getFieldName(property.uri, "#_trust")}.has(i)) {
            v = v.id;
          }
          if (v instanceof URL) {
            const fetched =
              await this.#fetch${pascalCase(property.singularName)}(v, options);
            if (fetched == null) continue;
            vs[i] = fetched;
            this.${await getFieldName(property.uri, "#_trust")}.add(i);
            this._cachedJsonLd = undefined;
            yield fetched;
            continue;
          }
      `;
      if (property.compactName != null) {
        yield `
          if (
            this._cachedJsonLd != null &&
            typeof this._cachedJsonLd === "object" &&
            "@context" in this._cachedJsonLd &&
            ${JSON.stringify(property.compactName)} in this._cachedJsonLd
          ) {
            const prop = this._cachedJsonLd[
              ${JSON.stringify(property.compactName)}];
            const obj = Array.isArray(prop) ? prop[i] : prop;
            if (obj != null && typeof obj === "object" && "@context" in obj) {
              v = await this.#${property.singularName}_fromJsonLd(obj, options);
            }
          }
        `;
      }
      yield `
          if (options.crossOrigin !== "trust" && v?.id != null &&
              this.id != null && v.id.origin !== this.id.origin &&
              !this.${await getFieldName(property.uri, "#_trust")}.has(0)) {
            if (options.crossOrigin === "throw") {
              throw new Error(
                "The property object's @id (" + v.id.href + ") has a different " +
                "origin than the property owner's @id (" + this.id.href + "); " +
                "refusing to return the object.  If you want to bypass this " +
                "check and are aware of the security implications, set the " +
                'crossOrigin option to "trust".'
              );
            }
            getLogger(["fedify", "vocab"]).warn(
              "The property object's @id ({objectId}) has a different origin " +
              "than the property owner's @id ({parentObjectId}); refusing to " +
              "return the object.  If you want to bypass this check and are " +
              "aware of the security implications, set the crossOrigin " +
              'option to "trust".',
              { objectId: v.id.href, parentObjectId: this.id.href },
            );
            continue;
          }
          yield v;
        }
      }
      `;
    }
  }
}

export async function* generateProperties(
  typeUri: string,
  types: Record<string, TypeSchema>,
): AsyncIterable<string> {
  const type = types[typeUri];
  for (const property of type.properties) {
    yield* generateProperty(type, property, types);
  }
}
