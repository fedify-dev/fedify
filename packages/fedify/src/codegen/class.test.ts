import { assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { assertSnapshot } from "@std/testing/snapshot";
import metadata from "../../deno.json" with { type: "json" };
import { test } from "../testing/mod.ts";
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
  assertEquals(
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

test("generateClasses()", async (t) => {
  const schemaDir = join(dirname(import.meta.dirname!), "vocab");
  const runtimePath = "../runtime/";
  const types = await loadSchemaFiles(schemaDir);
  let entireCode = "";
  for await (const code of generateClasses(types, runtimePath)) {
    entireCode += code;
  }
  entireCode = entireCode.replaceAll(
    JSON.stringify(metadata.version),
    '"0.0.0"',
  );
  await assertSnapshot(t, entireCode);
});
