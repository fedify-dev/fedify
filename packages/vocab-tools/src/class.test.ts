import { deepStrictEqual, match, strictEqual } from "node:assert";
import { basename, dirname, extname, join } from "node:path";
import { test } from "node:test";
import metadata from "../deno.json" with { type: "json" };
import { generateClasses, sortTopologically } from "./class.ts";
import { loadSchemaFiles, type TypeSchema } from "./schema.ts";

test("sortTopologically()", () => {
  const sorted = sortTopologically({
    "https://example.com/quux": {
      uri: "https://example.com/quux",
      name: "Foo",
      extends: "https://example.com/qux",
      entity: true,
      description: "",
      properties: [],
      defaultContext: {},
    },
    "https://example.com/qux": {
      uri: "https://example.com/qux",
      name: "Foo",
      extends: "https://example.com/bar",
      entity: true,
      description: "",
      properties: [],
      defaultContext: {},
    },
    "https://example.com/baz": {
      uri: "https://example.com/baz",
      name: "Foo",
      extends: "https://example.com/foo",
      entity: true,
      description: "",
      properties: [],
      defaultContext: {},
    },
    "https://example.com/bar": {
      uri: "https://example.com/bar",
      name: "Foo",
      extends: "https://example.com/foo",
      entity: true,
      description: "",
      properties: [],
      defaultContext: {},
    },
    "https://example.com/foo": {
      uri: "https://example.com/foo",
      name: "Foo",
      entity: true,
      description: "",
      properties: [],
      defaultContext: {},
    },
  });
  deepStrictEqual(
    sorted,
    [
      "https://example.com/foo",
      "https://example.com/bar",
      "https://example.com/qux",
      "https://example.com/quux",
      "https://example.com/baz",
    ],
  );
});

test("generateClasses() imports the browser-safe jsonld entrypoint", async () => {
  const entireCode = await getEntireCode();
  match(entireCode, /import jsonld from "@fedify\/vocab-runtime\/jsonld";/);
});

if ("Deno" in globalThis) {
  Deno.test("generateClasses() resolves mixed references through the parent's type scope", async () => {
    const context = "https://www.w3.org/ns/activitystreams";
    const uri = `${context}#Widget`;
    const types: Record<string, TypeSchema> = {
      [uri]: {
        uri,
        name: "Widget",
        compactName: "Widget",
        entity: true,
        description: "",
        defaultContext: [context, {
          ref: "https://example.com/unscoped/",
          Widget: {
            "@id": uri,
            "@context": { ref: "https://example.com/scoped/" },
          },
          parts: { "@id": `${context}#parts`, "@type": "@id" },
        }] as unknown as TypeSchema["defaultContext"],
        properties: [{
          uri: `${context}#parts`,
          singularName: "part",
          pluralName: "parts",
          compactName: "parts",
          range: [uri],
          description: "",
        }],
      },
    };
    const { Widget } = await importGeneratedClasses(types);
    const json = await new Widget({
      parts: [new Widget({}), new URL("ref:item")],
    }).toJsonLd();
    deepStrictEqual(json.parts[1].id, "https://example.com/scoped/item");
  });
  Deno.test("generateClasses() repairs the effective type-scoped property mapping", async () => {
    const [{ default: jsonld }, { getDocumentLoader }] = await Promise.all([
      import("../../vocab-runtime/src/jsonld.ts"),
      import("../../vocab-runtime/src/docloader.ts"),
    ]);
    const parts = "https://example.com/scoped/parts";
    const types = getScopedWidgetTypes({
      ref: "https://example.com/scoped/",
      parts: { "@id": parts, "@type": "@id", "@container": "@list" },
    }, { propertyUri: parts, ordered: true, security: true });
    const { Widget } = await importGeneratedClasses(types);
    const source = {
      "@context": ["https://www.w3.org/ns/activitystreams", {
        proof: "https://example.com/custom-proof",
      }],
      type: "Note",
      proof: "extension",
    };
    const child = new Widget({});
    child.toJsonLd = () => Promise.resolve(source);
    const json = await new Widget({
      parts: [child, new URL("ref:item")],
    }).toJsonLd();
    strictEqual(json.parts[0], source);
    const expanded = await jsonld.expand(json, {
      documentLoader: getDocumentLoader(),
    });
    deepStrictEqual(expanded[0][parts][0]["@list"][1], {
      "@id": "https://example.com/scoped/item",
    });
    deepStrictEqual(
      expanded[0][parts][0]["@list"][0][
        "https://example.com/custom-proof"
      ],
      [{ "@value": "extension" }],
    );
  });
  for (const propagate of [false, true]) {
    Deno.test(`generateClasses() preserves contextless siblings with type scope propagation ${propagate}`, async () => {
      const [{ default: jsonld }, { getDocumentLoader }] = await Promise.all([
        import("../../vocab-runtime/src/jsonld.ts"),
        import("../../vocab-runtime/src/docloader.ts"),
      ]);
      const types = getScopedWidgetTypes({
        ...(propagate ? { "@propagate": true } : {}),
        ref: "https://example.com/scoped/",
      });
      const { Widget } = await importGeneratedClasses(types);
      const source = Object.freeze({
        "@id": "ref:contextless",
        "ref:detail": [{ "@value": "detail" }],
      });
      const contextless = new Widget({});
      contextless.toJsonLd = () => Promise.resolve(source);
      const reference = Object.freeze({ "@id": "ref:reference" });
      const referenceOnly = new Widget({});
      referenceOnly.toJsonLd = () => Promise.resolve(reference);
      const context = Object.values(types)[0].defaultContext;
      const original = {
        "@context": context,
        type: "Widget",
        parts: [await new Widget({}).toJsonLd(), source, reference, "ref:item"],
      };
      const json = await new Widget({
        parts: [
          new Widget({}),
          contextless,
          referenceOnly,
          new URL("ref:item"),
        ],
      }).toJsonLd();
      const loader = getDocumentLoader();
      deepStrictEqual(
        await jsonld.expand(json, { documentLoader: loader }),
        await jsonld.expand(original, { documentLoader: loader }),
      );
      deepStrictEqual(source, {
        "@id": "ref:contextless",
        "ref:detail": [{ "@value": "detail" }],
      });
      deepStrictEqual(
        json.parts[3].id,
        "https://example.com/scoped/item",
      );
    });
  }
  Deno.test("generateClasses() keeps equal child contexts isolated from propagating type scopes", async () => {
    const [{ default: jsonld }, { getDocumentLoader }] = await Promise.all([
      import("../../vocab-runtime/src/jsonld.ts"),
      import("../../vocab-runtime/src/docloader.ts"),
    ]);
    const types = getScopedWidgetTypes({
      "@propagate": true,
      extra: "https://example.com/extra",
    });
    const { Widget } = await importGeneratedClasses(types);
    const context = Object.values(types)[0].defaultContext;
    const source = { "@context": context, type: "Note", extra: "ignored" };
    const child = new Widget({});
    child.toJsonLd = () => Promise.resolve(source);
    const json = await new Widget({ parts: [child] }).toJsonLd();
    const loader = getDocumentLoader();
    const standalone = await jsonld.expand(source, { documentLoader: loader });
    const inherited = await jsonld.expand({
      "@context": context,
      type: "Widget",
      parts: source,
    }, { documentLoader: loader });
    deepStrictEqual(
      inherited[0]["https://www.w3.org/ns/activitystreams#parts"][0][
        "https://example.com/extra"
      ],
      [{ "@value": "ignored" }],
    );
    const expanded = await jsonld.expand(json, { documentLoader: loader });
    const part = expanded[0]["https://www.w3.org/ns/activitystreams#parts"][0];
    deepStrictEqual(part, standalone[0]);
    strictEqual(json.parts, source);
  });
  Deno.test("generateClasses() leaves protected type-scoped definitions unchanged", async () => {
    const types = getScopedWidgetTypes({ ref: "https://example.com/scoped/" });
    const context = Object.values(types)[0].defaultContext as unknown as [
      string,
      Record<string, Record<string, unknown>>,
    ];
    context[1].Widget["@protected"] = true;
    const { Widget } = await importGeneratedClasses(types);
    const child = new Widget({});
    const json = await new Widget({
      parts: [child, new URL("ref:item")],
    }).toJsonLd();
    deepStrictEqual(json["@context"], context);
    strictEqual(json.parts[1], "ref:item");
  });
  Deno.test("generateClasses() preserves array and remote type scopes", async () => {
    const { getDocumentLoader } = await import(
      "../../vocab-runtime/src/docloader.ts"
    );
    const remote = "https://example.com/widget-context";
    const builtinLoader = getDocumentLoader();
    const contextLoader: typeof builtinLoader = (url, options) =>
      url === remote
        ? Promise.resolve({
          contextUrl: null,
          documentUrl: remote,
          document: { "@context": { ref: "https://example.com/remote/" } },
        })
        : builtinLoader(url, options);
    for (
      const [scope, expected] of [
        [[
          { ref: "https://example.com/first/" },
          { ref: "https://example.com/last/" },
        ], "https://example.com/last/item"],
        [remote, "https://example.com/remote/item"],
      ] as const
    ) {
      const { Widget } = await importGeneratedClasses(
        getScopedWidgetTypes(scope),
      );
      const json = await new Widget({
        parts: [new Widget({}), new URL("ref:item")],
      }).toJsonLd({ contextLoader });
      strictEqual(json.parts[1].id, expected);
    }
  });
  Deno.test("generateClasses() retains unprotected properties inside protected type scopes", async () => {
    const { Widget } = await importGeneratedClasses(getScopedWidgetTypes({
      "@protected": true,
      ref: "https://example.com/scoped/",
      parts: {
        "@id": "https://www.w3.org/ns/activitystreams#parts",
        "@type": "@id",
        "@protected": false,
      },
    }));
    const json = await new Widget({
      parts: [new Widget({}), new URL("ref:item")],
    }).toJsonLd();
    strictEqual(json.parts[1].id, "https://example.com/scoped/item");
    strictEqual(
      json["@context"].at(-1).Widget["@context"].parts["@protected"],
      false,
    );
  });
  // Deno can compile a generated TypeScript module directly from a data URL.
  Deno.test("generateClasses() preserves prefix terms when adding a scope", async () => {
    const [{ default: jsonld }, { getDocumentLoader }] = await Promise.all([
      import("../../vocab-runtime/src/jsonld.ts"),
      import("../../vocab-runtime/src/docloader.ts"),
    ]);
    const context = "https://www.w3.org/ns/activitystreams";
    const uri = `${context}#Widget`;
    const types: Record<string, TypeSchema> = {
      [uri]: {
        uri,
        name: "Widget",
        compactName: "as:Widget",
        entity: true,
        description: "",
        defaultContext: context as TypeSchema["defaultContext"],
        properties: [{
          uri: `${context}#`,
          singularName: "part",
          pluralName: "parts",
          compactName: "as",
          range: [uri],
          description: "",
        }],
      },
    };
    const code = (await Array.fromAsync(generateClasses(types))).join("")
      .replace(
        /from\s+"([^"]+)"/g,
        (_match, specifier: string) =>
          `from ${JSON.stringify(import.meta.resolve(specifier))}`,
      );
    const { Widget } = await import(
      `data:application/typescript;base64,${btoa(code)}`
    );
    const json = await new Widget({ parts: [new Widget({})] }).toJsonLd();
    const expanded = await jsonld.expand(json, {
      documentLoader: getDocumentLoader(),
    });
    deepStrictEqual(expanded[0]["@type"], [uri]);
    await Widget.fromJsonLd(json);
  });
  const { assertSnapshot } = await import("@std/testing/snapshot");
  Deno.test("generateClasses()", async (t) => {
    const entireCode = await getEntireCode();
    await assertSnapshot(t, entireCode, {
      path: getDenoSnapshotPath(),
    });
  });
} else if ("Bun" in globalThis) {
  const { test, expect } = await import("bun:test");
  test("generateClasses()", async () => {
    const entireCode = await getEntireCode();
    expect(entireCode).toMatchSnapshot();
  });
} else {
  await changeNodeSnapshotPath();
  test("generateClasses()", async (t) => {
    const entireCode = await getEntireCode();
    t.assert.snapshot(entireCode);
  });
}

async function importGeneratedClasses(types: Record<string, TypeSchema>) {
  const code = (await Array.fromAsync(generateClasses(types))).join("")
    .replace(
      /from\s+"([^"]+)"/g,
      (_match, specifier: string) =>
        `from ${JSON.stringify(import.meta.resolve(specifier))}`,
    );
  return await import(`data:application/typescript;base64,${btoa(code)}`);
}

function getScopedWidgetTypes(
  scope: unknown,
  options: { propertyUri?: string; ordered?: boolean; security?: boolean } = {},
): Record<string, TypeSchema> {
  const context = "https://www.w3.org/ns/activitystreams";
  const uri = `${context}#Widget`;
  const definitions = {
    ref: "https://example.com/unscoped/",
    Widget: { "@id": uri, "@context": scope },
    parts: {
      "@id": `${context}#parts`,
      "@type": "@id",
      ...(options.ordered ? { "@container": "@list" } : {}),
    },
  };
  return {
    [uri]: {
      uri,
      name: "Widget",
      compactName: "Widget",
      entity: true,
      description: "",
      defaultContext: [
        context,
        ...(options.security
          ? ["https://w3id.org/security/data-integrity/v1"]
          : []),
        definitions,
      ] as unknown as TypeSchema["defaultContext"],
      properties: [{
        uri: options.propertyUri ?? `${context}#parts`,
        singularName: "part",
        pluralName: "parts",
        compactName: "parts",
        range: [uri],
        ...(options.ordered ? { container: "list" as const } : {}),
        description: "",
      }],
    },
  };
}

async function getEntireCode() {
  const packagesDir = dirname(dirname(import.meta.dirname!));
  const schemaDir = join(packagesDir, "vocab", "src");
  const types = await loadSchemaFiles(schemaDir);
  const entireCode = (await Array.fromAsync(generateClasses(types)))
    .join("")
    .replaceAll(JSON.stringify(metadata.version), '"0.0.0"');
  return entireCode;
}

async function changeNodeSnapshotPath() {
  const { snapshot } = await import("node:test");
  snapshot.setResolveSnapshotPath(
    (path) => {
      if (!path) {
        throw new Error("path is undefined");
      }
      return join(
        dirname(path),
        "__snapshots__",
        basename(path.replace(extname(path), ".ts")) + ".node.snap",
      );
    },
  );
  snapshot.setDefaultSnapshotSerializers([
    (value) => JSON.stringify(value, null, 2),
    (value) => value.replaceAll("\\n", "\n"),
  ]);
}

function getDenoSnapshotPath() {
  const pf = import.meta.filename!;
  return join(dirname(pf), "__snapshots__", basename(pf) + ".deno.snap");
}
