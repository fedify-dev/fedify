/**
 * Integration test for the oxlint plugin entry.
 *
 * Spawns the oxlint binary against a tmpdir fixture that violates
 * `actor-id-required`, parses the JSON diagnostics, and asserts the
 * `@fedify/lint/actor-id-required` rule fires.
 *
 * Runtime notes:
 *
 *  -  The test uses `node:child_process`, `node:fs`, `node:os`,
 *     `node:path`, and `node:process`. Under Deno these resolve via
 *     the Node compatibility layer, so the same source runs under both
 *     `pnpm test` (via `node:test`) and `deno task test` (via
 *     `Deno.test`) — `@fedify/fixture` dispatches the test definition
 *     to the appropriate runtime.
 *  -  Other rule tests in this package use the in-process linter APIs
 *     (`Deno.lint.runPlugin` / ESLint's `Linter`). This one is
 *     different on purpose: oxlint is a Rust binary, so we spawn it as
 *     a subprocess against a real config file. That's the only way to
 *     exercise the JS plugin loader end-to-end.
 *  -  Two preconditions are checked at module load. If either is
 *     missing, the test is skipped via `{ ignore }`:
 *      *  the built loader at `<package>/dist/oxlint.js`
 *      *  the oxlint binary, located under `<package>/node_modules/.bin`,
 *         the workspace root, or anywhere on `PATH`
 */
import { test } from "@fedify/fixture";
import { ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pluginPath = resolve(here, "../../dist/oxlint.js");
const pluginBuilt = existsSync(pluginPath);

function findOxlint(): string | null {
  const candidates = [
    resolve(here, "../../node_modules/.bin/oxlint"),
    resolve(here, "../../../../node_modules/.bin/oxlint"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const where = spawnSync(
    process.platform === "win32" ? "where" : "which",
    ["oxlint"],
    { encoding: "utf8" },
  );
  if (where.status === 0 && where.stdout) {
    return where.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

const oxlintBin = findOxlint();
const ignore = !pluginBuilt || !oxlintBin;

const BAD_CODE =
  `import { createFederation, InProcessMessageQueue, MemoryKvStore } from "@fedify/fedify";
import { Person } from "@fedify/vocab";

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});

federation.setActorDispatcher("/users/{identifier}", (_ctx, _identifier) => {
  return new Person({
    name: "Bad Actor",
  });
});
`;

interface OxlintJsonDiagnostic {
  code?: string;
  message?: string;
  severity?: string;
}

interface OxlintJsonReport {
  diagnostics?: OxlintJsonDiagnostic[];
}

test(
  "oxlint plugin: actor-id-required fires on missing id",
  { ignore },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "fedify-lint-oxlint-"));
    try {
      writeFileSync(
        join(dir, ".oxlintrc.json"),
        JSON.stringify({
          jsPlugins: [pluginPath],
          rules: {
            "@fedify/lint/actor-id-required": "error",
          },
        }),
      );
      writeFileSync(join(dir, "federation.ts"), BAD_CODE);

      const result = spawnSync(
        oxlintBin!,
        ["--format=json", "."],
        { cwd: dir, encoding: "utf8" },
      );

      ok(
        result.status !== 0,
        `Expected non-zero exit, got ${result.status}. stderr: ${result.stderr}`,
      );

      let payload: OxlintJsonReport;
      try {
        payload = JSON.parse(result.stdout) as OxlintJsonReport;
      } catch (err) {
        throw new Error(
          `Failed to parse oxlint JSON output: ${(err as Error).message}\n` +
            `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
        );
      }

      const codes = (payload.diagnostics ?? []).map((d) => d.code ?? "");
      const matched = codes.some((code) =>
        code === "@fedify/lint(actor-id-required)" ||
        code.includes("actor-id-required")
      );
      ok(
        matched,
        `Expected @fedify/lint(actor-id-required) diagnostic, got: ${
          codes.join(", ") || "(none)"
        }`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
