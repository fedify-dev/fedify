import { deepStrictEqual, match } from "node:assert";
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
