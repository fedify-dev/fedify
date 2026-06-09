import { type Schema, Validator } from "@cfworker/json-schema";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseSuiteText } from "./scenario/load.ts";
import { SCHEMA_DIR, serializeSchema } from "./schema-paths.ts";
import { PUBLISHED_SCHEMAS } from "./schemas.ts";

const REPO_ROOT = join(SCHEMA_DIR, "..", "..");
// `import.meta.dirname` needs Node >= 20.11; derive it from the URL instead.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

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
const validators = new Map(
  PUBLISHED_SCHEMAS.map((
    s,
  ) => [s.name, new Validator(s.schema as unknown as Schema, "2020-12")]),
);

interface FixtureGroup {
  readonly dir: string;
  readonly schema: string;
  readonly valid: boolean;
}

const FIXTURE_GROUPS: readonly FixtureGroup[] = [
  { dir: "scenarios", schema: "scenario", valid: true },
  { dir: "invalid", schema: "scenario", valid: false },
  { dir: "reports", schema: "report", valid: true },
];

function fixtureFiles(dir: string): string[] {
  return readdirSync(join(FIXTURES, dir))
    .filter((f) => /\.(ya?ml|json)$/.test(f))
    .map((f) => join(FIXTURES, dir, f));
}

for (const group of FIXTURE_GROUPS) {
  const validator = validators.get(group.schema)!;
  for (const file of fixtureFiles(group.dir)) {
    const label = `${group.dir}/${file.split("/").pop()}`;
    test(
      `schema guard - fixture ${label} is ${group.valid ? "valid" : "invalid"}`,
      () => {
        const value = parseSuiteText(readFileSync(file, "utf-8"));
        const result = validator.validate(value);
        assert.strictEqual(
          result.valid,
          group.valid,
          group.valid
            ? `expected valid, got: ${JSON.stringify(result.errors)}`
            : "expected invalid",
        );
      },
    );
  }
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

// Guard 4: immutability of already-published schema versions.  A published
// version file must not differ from its content on the main branch; compare
// against the merge-base so a committed edit on a feature branch is caught
// (not just an uncommitted one).  The check is skipped when no base ref is
// available (e.g. a shallow clone) or the file is new since the base.
function publishedBaseCommit(): string | null {
  for (const ref of ["origin/main", "main"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], {
        cwd: REPO_ROOT,
        stdio: "ignore",
      });
      return execFileSync("git", ["merge-base", "HEAD", ref], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
      }).trim();
    } catch {
      // Ref unavailable; try the next.
    }
  }
  return null;
}

const baseCommit = publishedBaseCommit();
for (const { name, fileName } of PUBLISHED_SCHEMAS) {
  test(`schema guard - ${name} published file is immutable`, () => {
    if (baseCommit == null) return;
    let published: string;
    try {
      published = execFileSync(
        "git",
        ["show", `${baseCommit}:schema/bench/${fileName}`],
        {
          cwd: REPO_ROOT,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
    } catch {
      // Not published at the base (a brand-new version file): nothing to guard.
      return;
    }
    const current = readFileSync(join(SCHEMA_DIR, fileName), "utf-8");
    assert.strictEqual(
      current,
      published,
      `schema/bench/${fileName} is published and immutable; ship a new ` +
        `version file instead of editing it`,
    );
  });
}
