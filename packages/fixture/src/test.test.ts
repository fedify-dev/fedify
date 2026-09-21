import { doesNotMatch, match, strictEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { test as nodeTest } from "node:test";

// Register independently: using the fixture here could hide its own failure.
const skip = "Deno" in globalThis;

function fixtureRoot(): string {
  // The Node script runs from dist-tests; avoid import.meta in the CJS build.
  for (let dir = process.cwd();; dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (
      existsSync(manifest) &&
      JSON.parse(readFileSync(manifest, "utf8")).name === "@fedify/fixture"
    ) return dir;
    if (dir === dirname(dir)) throw new Error("Cannot find @fedify/fixture");
  }
}

for (const format of ["module", "commonjs"] as const) {
  // Bun 1.2 ignores node:test's skip option; these probes require Node.
  if ("Bun" in globalThis) break;
  const load = format === "module"
    ? 'const { test, testDefinitions } = await import("@fedify/fixture");'
    : 'const { test, testDefinitions } = require("@fedify/fixture");';
  const resolve = format === "module"
    ? 'import.meta.resolve("@fedify/fixture")'
    : 'require.resolve("@fedify/fixture")';
  const patch = `
    const { createRequire } = await import("node:module");
    createRequire(process.cwd() + "/")("node:test").test = () => {
      throw new Error("REGISTRATION_FAILURE");
    };
  `;

  const probe = (body: string, setup = "") => {
    const env = { ...process.env };
    // A nested Node runner otherwise inherits the parent's binary reporter.
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_OPTIONS;
    const result = spawnSync(
      process.execPath,
      [
        `--input-type=${format}`,
        "--test-reporter=tap",
        "--eval",
        `(async () => {
          ${setup}
          ${load}
          console.log("ENTRY:", ${resolve});
          ${body}
        })().catch(error => { console.error(error); process.exitCode = 1; });`,
      ],
      { cwd: fixtureRoot(), env, encoding: "utf8", timeout: 30_000 },
    );
    if (result.error) throw result.error;
    strictEqual(result.signal, null, result.stderr);
    match(
      result.stdout.replaceAll("\\", "/"),
      format === "module"
        ? /ENTRY: .*\/dist\/mod\.js/
        : /ENTRY: .*\/dist\/mod\.cjs/,
    );
    return { ...result, output: result.stdout + result.stderr };
  };

  nodeTest(`${format} fixture registers tests and steps`, { skip }, () => {
    const result = probe(`
      test("external test", async t => {
        console.log("TEST_EXECUTED");
        await t.step("external step", () => console.log("STEP_EXECUTED"));
      });
    `);
    strictEqual(result.status, 0, result.output);
    match(result.stdout, /ok \d+ - external test/);
    match(result.stdout, /ok \d+ - external step/);
    match(result.stdout, /TEST_EXECUTED/);
    match(result.stdout, /STEP_EXECUTED/);
    match(result.stdout, /# fail 0/);
  });

  nodeTest(`${format} fixture propagates test failures`, { skip }, () => {
    const result = probe(`
      test("failing test", () => { throw new Error("CALLBACK_FAILURE"); });
    `);
    strictEqual(result.status, 1, result.output);
    match(result.stdout, /not ok \d+ - failing test/);
    match(result.stdout, /CALLBACK_FAILURE/);
  });

  nodeTest(`${format} fixture propagates step failures`, { skip }, () => {
    const result = probe(`
      test("parent test", async t => {
        await t.step("failing step", () => { throw new Error("STEP_FAILURE"); });
      });
    `);
    strictEqual(result.status, 1, result.output);
    match(result.stdout, /not ok \d+ - failing step/);
    match(result.stdout, /STEP_FAILURE/);
  });

  nodeTest(`${format} fixture skips ignored tests`, { skip }, () => {
    const result = probe(`
      test("ignored test", { ignore: true }, () => {
        throw new Error("IGNORED_CALLBACK_EXECUTED");
      });
    `);
    strictEqual(result.status, 0, result.output);
    match(result.stdout, /ok \d+ - ignored test # SKIP/);
    doesNotMatch(result.output, /IGNORED_CALLBACK_EXECUTED/);
  });

  nodeTest(`${format} fixture surfaces registration errors`, { skip }, () => {
    const result = probe('test("registration test", () => {});', patch);
    strictEqual(result.status, 1, result.output);
    match(result.stderr, /REGISTRATION_FAILURE/);
  });

  nodeTest(`${format} fixture only collects tests in Workers`, { skip }, () => {
    const result = probe(
      `
        test("Workers test", () => console.log("WORKERS_CALLBACK_EXECUTED"));
        console.log("DEFINITIONS:", testDefinitions.length);
      `,
      patch + `
        Object.defineProperty(globalThis, "navigator", {
          value: { userAgent: "Cloudflare-Workers" }, configurable: true,
        });
      `,
    );
    strictEqual(result.status, 0, result.output);
    match(result.stdout, /DEFINITIONS: 1/);
    doesNotMatch(result.output, /WORKERS_CALLBACK_EXECUTED|# Subtest:/);
  });
}
