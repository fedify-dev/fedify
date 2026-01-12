import { deepStrictEqual } from "node:assert";
import { basename, dirname, extname, join } from "node:path";
import { test } from "node:test";
import metadata from "../deno.json" with { type: "json" };
import { generateClasses, sortTopologically } from "./class.ts";
import { loadSchemaFiles } from "./schema.ts";

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

if ("Deno" in globalThis) {
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
