import { deepStrictEqual, match, rejects } from "node:assert";
import { basename, dirname, extname, join } from "node:path";
import { test } from "node:test";
import metadata from "../deno.json" with { type: "json" };
import { generateClasses, sortTopologically } from "./class.ts";
import { getDataCheck } from "./type.ts";
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

test("generateClasses() imports Decimal helpers for xsd:decimal", async () => {
  const entireCode = await getDecimalFixtureCode();
  match(entireCode, /canParseDecimal,/);
  match(entireCode, /isDecimal,/);
  match(entireCode, /type Decimal,/);
  match(entireCode, /parseDecimal/);
  match(entireCode, /amount\?: Decimal \| null;/);
  match(entireCode, /isDecimal\(values\.amount\)/);
  match(entireCode, /parseDecimal\(v\["@value"\]\)/);
});

test("generateClasses() emits $EntityType helpers for fedify:vocabEntityType", async () => {
  const entireCode = await getEntityTypeFixtureCode();
  match(
    entireCode,
    /export type \$EntityType =\s+\| typeof Entity\s+\| typeof ChildEntity\s+\| typeof Tombstone;/s,
  );
  match(
    entireCode,
    /const entityTypes: readonly \$EntityType\[\] = \[\s*Entity,\s*ChildEntity,\s*Tombstone,\s*\];/s,
  );
  match(
    entireCode,
    /const entityTypeSet: ReadonlySet<\$EntityType> = new Set\(entityTypes\);/,
  );
  match(
    entireCode,
    /export function isEntityType\(value: unknown\): value is \$EntityType/,
  );
  match(
    entireCode,
    /export function getEntityTypeById\(id: string \| URL\): \$EntityType \| undefined/,
  );
  match(
    entireCode,
    /const entityTypeIds: ReadonlyMap<string, \$EntityType> = new Map<string, \$EntityType>\(\s*\[\s*\["https:\/\/example.com\/entity", Entity\],\s*\["https:\/\/example.com\/child-entity", ChildEntity\],\s*\["https:\/\/example.com\/tombstone", Tombstone\],\s*\],\s*\);/s,
  );
  match(
    entireCode,
    /return entityTypeIds\.get\(typeof id === "string" \? id : id\.href\);/,
  );
});

test("generateClasses() uses entity type helpers for fedify:vocabEntityType", async () => {
  const entireCode = await getEntityTypeFixtureCode();
  match(entireCode, /formerType\?: \$EntityType \| null;/);
  match(entireCode, /formerTypes\?: \(\$EntityType\)\[\];/);
  match(entireCode, /isEntityType\(values\.formerType\)/);
  match(entireCode, /v\.typeId\.href/);
  match(entireCode, /getEntityTypeById\(v\["@id"\]\)/);
});

test("getDataCheck() uses canParseDecimal() for xsd:decimal", () => {
  const check = getDataCheck(
    "http://www.w3.org/2001/XMLSchema#decimal",
    {},
    "v",
  );
  match(check, /canParseDecimal\(v\["@value"\]\)/);
});

test("generateClasses() rejects xsd:string and xsd:decimal unions", async () => {
  await rejects(
    Array.fromAsync(generateClasses({
      "https://example.com/measure": {
        name: "Measure",
        uri: "https://example.com/measure",
        compactName: "Measure",
        entity: false,
        description: "A measure.",
        properties: [
          {
            singularName: "amount",
            functional: true,
            compactName: "amount",
            uri: "https://example.com/amount",
            description: "An exact decimal amount.",
            range: [
              "http://www.w3.org/2001/XMLSchema#decimal",
              "http://www.w3.org/2001/XMLSchema#string",
            ],
          },
        ],
        defaultContext:
          "https://example.com/context" as TypeSchema["defaultContext"],
      },
    })),
    /cannot have both xsd:string and xsd:decimal in its range/,
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

async function getDecimalFixtureCode() {
  const types: Record<string, TypeSchema> = {
    "https://example.com/measure": {
      name: "Measure",
      uri: "https://example.com/measure",
      compactName: "Measure",
      entity: false,
      description: "A measure.",
      properties: [
        {
          singularName: "amount",
          functional: true,
          compactName: "amount",
          uri: "https://example.com/amount",
          description: "An exact decimal amount.",
          range: ["http://www.w3.org/2001/XMLSchema#decimal"],
        },
      ],
      defaultContext:
        "https://example.com/context" as TypeSchema["defaultContext"],
    },
  };
  return (await Array.fromAsync(generateClasses(types))).join("");
}

async function getEntityTypeFixtureCode() {
  const types: Record<string, TypeSchema> = {
    "https://example.com/entity": {
      name: "Entity",
      uri: "https://example.com/entity",
      compactName: "Entity",
      entity: true,
      description: "An entity.",
      properties: [],
      defaultContext:
        "https://example.com/context" as TypeSchema["defaultContext"],
    },
    "https://example.com/child-entity": {
      name: "ChildEntity",
      uri: "https://example.com/child-entity",
      compactName: "ChildEntity",
      extends: "https://example.com/entity",
      entity: true,
      description: "A child entity.",
      properties: [],
      defaultContext:
        "https://example.com/context" as TypeSchema["defaultContext"],
    },
    "https://example.com/value": {
      name: "Value",
      uri: "https://example.com/value",
      compactName: "Value",
      entity: false,
      description: "A value type.",
      properties: [],
      defaultContext:
        "https://example.com/context" as TypeSchema["defaultContext"],
    },
    "https://example.com/tombstone": {
      name: "Tombstone",
      uri: "https://example.com/tombstone",
      compactName: "Tombstone",
      extends: "https://example.com/entity",
      entity: true,
      description: "A tombstone.",
      properties: [
        {
          singularName: "formerType",
          pluralName: "formerTypes",
          singularAccessor: true,
          compactName: "formerType",
          uri: "https://example.com/formerType",
          description: "The former type.",
          range: ["fedify:vocabEntityType"],
        },
      ],
      defaultContext:
        "https://example.com/context" as TypeSchema["defaultContext"],
    },
  };
  return (await Array.fromAsync(generateClasses(types))).join("");
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
