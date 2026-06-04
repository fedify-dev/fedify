import { type Schema, Validator } from "@cfworker/json-schema";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseSuiteText } from "./scenario/load.ts";
import { SCHEMA_DIR, serializeSchema } from "./schema-paths.ts";
import { PUBLISHED_SCHEMAS } from "./schemas.ts";

const REPO_ROOT = join(SCHEMA_DIR, "..", "..");
const FIXTURES = join(import.meta.dirname!, "__fixtures__");

function collectRefs(node: unknown, refs: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
  } else if (node != null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") refs.push(value);
      else collectRefs(value, refs);
    }
  }
  return refs;
}

// Guard 1: meta-schema / structural validation.
for (const { name, fileName, schema } of PUBLISHED_SCHEMAS) {
  test(`schema guard - ${name} is structurally well-formed`, () => {
    assert.strictEqual(
      schema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
    );
    assert.ok(
      typeof schema.$id === "string" && schema.$id.endsWith(`/${fileName}`),
      `$id must end with /${fileName}`,
    );
    const defs = (schema.$defs ?? {}) as Record<string, unknown>;
    for (const ref of collectRefs(schema)) {
      if (!ref.startsWith("#/$defs/")) continue;
      const defName = ref.slice("#/$defs/".length);
      assert.ok(
        Object.hasOwn(defs, defName),
        `dangling $ref ${ref}`,
      );
    }
    // Constructing the validator dereferences the schema; it must not throw.
    assert.doesNotThrow(() =>
      new Validator(schema as unknown as Schema, "2020-12")
    );
  });
}

// Guard 2: example-fixture validation.
const scenarioSchema = PUBLISHED_SCHEMAS.find((s) => s.name === "scenario")!;
const scenarioValidator = new Validator(
  scenarioSchema.schema as unknown as Schema,
  "2020-12",
);

function fixtureFiles(dir: string): string[] {
  return readdirSync(join(FIXTURES, dir))
    .filter((f) => /\.(ya?ml|json)$/.test(f))
    .map((f) => join(FIXTURES, dir, f));
}

for (const file of fixtureFiles("scenarios")) {
  test(`schema guard - valid fixture ${file.split("/").pop()}`, () => {
    const suite = parseSuiteText(readFileSync(file, "utf-8"));
    const result = scenarioValidator.validate(suite);
    assert.ok(
      result.valid,
      `expected valid, got: ${JSON.stringify(result.errors)}`,
    );
  });
}

for (const file of fixtureFiles("invalid")) {
  test(`schema guard - invalid fixture ${file.split("/").pop()}`, () => {
    const suite = parseSuiteText(readFileSync(file, "utf-8"));
    assert.ok(!scenarioValidator.validate(suite).valid, "expected invalid");
  });
}

// Guard 3: drift between embedded schema and the published file.
for (const { name, fileName, schema } of PUBLISHED_SCHEMAS) {
  test(`schema guard - ${name} embedded schema matches published file`, () => {
    const published = readFileSync(join(SCHEMA_DIR, fileName), "utf-8");
    assert.strictEqual(
      published,
      serializeSchema(schema),
      `schema/bench/${fileName} is out of sync; run ` +
        `scripts/generate-bench-schema.ts`,
    );
  });
}

// Guard 4: immutability of already-published schema versions.
for (const { name, fileName } of PUBLISHED_SCHEMAS) {
  test(`schema guard - ${name} published file is unchanged from HEAD`, () => {
    let committed: string;
    try {
      committed = execFileSync(
        "git",
        ["show", `HEAD:schema/bench/${fileName}`],
        { cwd: REPO_ROOT, encoding: "utf-8" },
      );
    } catch {
      // Not yet committed (a brand-new version file): nothing to guard.
      return;
    }
    const current = readFileSync(join(SCHEMA_DIR, fileName), "utf-8");
    assert.strictEqual(
      current,
      committed,
      `schema/bench/${fileName} is published and immutable; publish a new ` +
        `version file instead of editing it`,
    );
  });
}
