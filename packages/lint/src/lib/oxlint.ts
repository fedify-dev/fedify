/**
 * Shared helpers for the oxlint-based tests.
 *
 * oxlint is a Rust binary, so the only way to exercise the JS plugin loader
 * end-to-end is to spawn it as a subprocess against a real config file.  Both
 * `tests/oxlint.test.ts` and the oxlint lane of `tests/integration.test.ts`
 * need the same setup — locating the built loader and the binary, writing a
 * tmpdir fixture, running oxlint, and parsing its JSON diagnostics — so that
 * logic lives here once.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the built oxlint plugin loader (`dist/oxlint.js`). */
export const oxlintPluginPath: string = resolve(here, "../../dist/oxlint.js");

/** Whether the built loader exists. */
export const pluginBuilt: boolean = existsSync(oxlintPluginPath);

/**
 * Locate the oxlint binary: prefer the package- and workspace-local
 * `node_modules/.bin`, then fall back to whatever is on `PATH`.  Returns
 * `null` when it cannot be found.
 */
export function findOxlint(): string | null {
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

/** The resolved oxlint binary path, or `null` when it is unavailable. */
export const oxlintBin: string | null = findOxlint();

/**
 * `true` when either the built loader or the oxlint binary is missing, in
 * which case the oxlint-based tests should be skipped via `{ ignore }`.
 */
export const oxlintUnavailable: boolean = !pluginBuilt || oxlintBin == null;

/**
 * Print a single warning explaining why the oxlint tests are being skipped.
 * Call this only when {@link oxlintUnavailable} is `true`.
 */
export function warnOxlintSkipped(): void {
  const missing: string[] = [];
  if (!pluginBuilt) missing.push(`built loader at ${oxlintPluginPath}`);
  if (oxlintBin == null) {
    missing.push("oxlint binary on PATH or in node_modules");
  }
  console.warn(
    `Skipping oxlint tests — missing: ${missing.join(", ")}.\n` +
      "To enable them, run `mise install && mise run prepare-each lint` " +
      "from the repository root so both the loader and the oxlint binary " +
      "are available. Prefer `mise run test` (full suite) or " +
      "`mise run test-each lint` (this package) to run tests — those tasks " +
      "build the prerequisites for you.",
  );
}

/** A single diagnostic as reported by oxlint's `--format=json` output. */
export interface OxlintDiagnostic {
  code?: string;
  message?: string;
  severity?: string;
}

/** The result of running oxlint over a fixture. */
export interface OxlintRunResult {
  /** Process exit status (`null` if terminated by a signal). */
  status: number | null;
  /** Parsed diagnostics. */
  diagnostics: OxlintDiagnostic[];
  /** Raw stdout, kept for assertion messages. */
  stdout: string;
  /** Raw stderr, kept for assertion messages. */
  stderr: string;
}

/**
 * Run oxlint over a single source file inside a throwaway tmpdir.
 *
 * Writes `.oxlintrc.json` (always wiring up the built plugin loader and
 * merging in `config`) plus a source file named `fileName` containing `code`,
 * spawns oxlint with `--format=json`, parses the JSON report, and removes the
 * tmpdir before returning.
 *
 * Callers must ensure {@link oxlintBin} is non-null first.
 */
export function runOxlint(
  code: string,
  config: Record<string, unknown>,
  fileName = "code.ts",
): OxlintRunResult {
  const dir = mkdtempSync(join(tmpdir(), "fedify-lint-oxlint-"));
  try {
    writeFileSync(
      join(dir, ".oxlintrc.json"),
      JSON.stringify({ jsPlugins: [oxlintPluginPath], ...config }),
    );
    writeFileSync(join(dir, fileName), code);

    const result = spawnSync(oxlintBin!, ["--format=json", fileName], {
      cwd: dir,
      encoding: "utf8",
    });

    let payload: { diagnostics?: OxlintDiagnostic[] };
    try {
      payload = JSON.parse(result.stdout);
    } catch (err) {
      throw new Error(
        `Failed to parse oxlint JSON output: ${(err as Error).message}\n` +
          `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    }

    return {
      status: result.status,
      diagnostics: payload.diagnostics ?? [],
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
