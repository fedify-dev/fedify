/**
 * Integration test for the oxlint plugin entry.
 *
 * Spawns the oxlint binary against a tmpdir fixture that violates
 * `actor-id-required`, parses the JSON diagnostics, and asserts the
 * `@fedify/lint/actor-id-required` rule fires.
 *
 * Runtime notes:
 *
 *  -  The shared helpers in `../lib/oxlint.ts` use `node:child_process`,
 *     `node:fs`, `node:os`, `node:path`, and `node:process`. Under Deno
 *     these resolve via the Node compatibility layer, so the same source
 *     runs under both `pnpm test` (via `node:test`) and `deno task test`
 *     (via `Deno.test`) — `@fedify/fixture` dispatches the test definition
 *     to the appropriate runtime.
 *  -  Other rule tests in this package use the in-process linter APIs
 *     (`Deno.lint.runPlugin` / ESLint's `Linter`). This one is
 *     different on purpose: oxlint is a Rust binary, so we spawn it as
 *     a subprocess against a real config file. That's the only way to
 *     exercise the JS plugin loader end-to-end.
 *  -  Two preconditions are checked at module load (see {@link
 *     oxlintUnavailable}). If either is missing, the test is skipped via
 *     `{ ignore }`:
 *      *  the built loader at `<package>/dist/oxlint.js`
 *      *  the oxlint binary, located under `<package>/node_modules/.bin`,
 *         the workspace root, or anywhere on `PATH`
 */
import { test } from "@fedify/fixture";
import { ok } from "node:assert/strict";
import {
  oxlintUnavailable,
  runOxlint,
  warnOxlintSkipped,
} from "../lib/oxlint.ts";

if (oxlintUnavailable) warnOxlintSkipped();

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

test(
  "oxlint plugin: actor-id-required fires on missing id",
  { ignore: oxlintUnavailable },
  () => {
    const { status, diagnostics, stderr } = runOxlint(
      BAD_CODE,
      { rules: { "@fedify/lint/actor-id-required": "error" } },
      "federation.ts",
    );

    ok(
      status !== 0,
      `Expected non-zero exit, got ${status}. stderr: ${stderr}`,
    );

    const codes = diagnostics.map((d) => d.code ?? "");
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
  },
);
