import { createContext } from "@dprint/formatter";
import { getPath } from "@dprint/typescript";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
// Use source before any workspace package has been built on a fresh checkout.
import { generateVocab } from "../../vocab-tools/src/mod.ts";

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/** Find the newest matching input, including nested directories. */
export async function getLatestMtimeUnder(
  dir: string,
  exts: readonly string[],
): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) return 0;
    throw error;
  }
  let latest = 0;
  for (const entry of entries) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, await getLatestMtimeUnder(child, exts));
    } else if (
      entry.isFile() &&
      exts.some((ext) => entry.name.toLowerCase().endsWith(ext))
    ) {
      latest = Math.max(latest, (await stat(child)).mtimeMs);
    }
  }
  return latest;
}

/** Check freshness after taking the generation lock. */
export async function isUpToDate(
  schemaDir: string,
  generatedPath: string,
  generatorMtime: number,
): Promise<boolean> {
  try {
    const [sourceMtime, generatedStat] = await Promise.all([
      getLatestMtimeUnder(schemaDir, [".yaml", ".yml"]),
      stat(generatedPath),
    ]);
    return generatedStat.mtimeMs >= Math.max(sourceMtime, generatorMtime);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

interface LockOptions {
  staleMs: number;
  initializationMs: number;
  retryMs: number;
  timeoutMs: number;
}

/** Acquire the same directory lock used by Node and Deno generation. */
export async function acquireLock(
  lockPath: string,
  options: Partial<LockOptions> = {},
): Promise<{ release(): Promise<void> }> {
  const {
    staleMs = 5 * 60 * 1000,
    initializationMs = 10 * 1000,
    retryMs = 100,
    timeoutMs = 60 * 1000,
  } = options;
  const startTime = Date.now();
  while (true) {
    try {
      // Non-recursive mkdir is atomic, including on Windows.
      await mkdir(lockPath);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      try {
        let age: number;
        let threshold: number;
        try {
          age = Date.now() - (await stat(join(lockPath, "info"))).mtimeMs;
          threshold = staleMs;
        } catch (infoError) {
          if (!hasCode(infoError, "ENOENT")) throw infoError;
          // Another process may still be writing info after its mkdir.
          age = Date.now() - (await stat(lockPath)).mtimeMs;
          threshold = initializationMs;
        }
        if (age > threshold) {
          console.warn("Removing stale lock:", lockPath);
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (!hasCode(statError, "ENOENT")) throw statError;
        continue; // The holder released the lock while we inspected it.
      }
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Timeout waiting for lock: ${lockPath}`);
      }
      await setTimeout(retryMs);
      continue;
    }

    try {
      await writeFile(
        join(lockPath, "info"),
        JSON.stringify({ pid: process.pid, timestamp: Date.now() }) + "\n",
      );
    } catch (error) {
      await rm(lockPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return {
      async release() {
        await rm(lockPath, { recursive: true, force: true }).catch(() => {});
      },
    };
  }
}

let formatter: Promise<ReturnType<typeof createContext>> | undefined;

/**
 * Preserve Deno's generated-code formatting without requiring Deno at bootstrap.
 *
 * TODO(#1285): Replace dprint with Oxfmt when migrating repository formatting.
 * Switch the generated-code checks and formatting exclusions together so Deno
 * and Oxfmt never compete over vocab.ts, then remove the dprint dependencies
 * and Deno-version coupling in mise.toml.  The vocab-tools code snapshots record
 * unformatted generator output, so a formatter change alone need not alter them.
 * https://github.com/fedify-dev/fedify/issues/1285
 */
export async function formatGenerated(source: string): Promise<string> {
  formatter ??= (async () => {
    const context = createContext({
      lineWidth: 80,
      indentWidth: 2,
      useTabs: false,
      newLineKind: "lf",
    });
    context.addPlugin(await readFile(getPath()), { deno: true });
    return context;
  })();
  const context = await formatter;
  // Like Deno's format_ensure_stable(), keep formatting until the result is
  // stable. Some long generated expressions need more than one dprint pass.
  let current = source;
  for (let pass = 0; pass < 6; pass++) {
    const next = context.formatText({
      filePath: "vocab.ts",
      fileText: current,
    });
    if (next === current) return current;
    current = next;
  }
  throw new Error("Generated vocabulary formatting did not stabilize");
}

interface CodegenOptions {
  packageDir?: string;
  generate?: typeof generateVocab;
  format?: (source: string) => string | Promise<string>;
  lockOptions?: Partial<LockOptions>;
}

/** Generate and format vocabulary atomically, or leave a fresh output alone. */
export async function codegen(options: CodegenOptions = {}): Promise<void> {
  const packageDir = options.packageDir ?? resolve(import.meta.dirname!, "..");
  const scriptsDir = join(packageDir, "scripts");
  const schemaDir = join(packageDir, "src");
  const generatedPath = join(schemaDir, "vocab.ts");
  const toolsDir = resolve(packageDir, "../vocab-tools");
  const lock = await acquireLock(
    join(packageDir, ".vocab-codegen.lock"),
    options.lockOptions,
  );
  try {
    // Keep these inputs aligned with [deps.codegen].sources in mise.toml.
    const generatorMtime = Math.max(
      await getLatestMtimeUnder(join(toolsDir, "src"), [
        ".ts",
        ".yaml",
        ".yml",
      ]),
      await getLatestMtimeUnder(scriptsDir, [".ts"]),
      (await stat(join(toolsDir, "deno.json"))).mtimeMs,
      (await stat(join(packageDir, "package.json"))).mtimeMs,
    );
    if (await isUpToDate(schemaDir, generatedPath, generatorMtime)) {
      console.log("vocab.ts is up to date, skipping codegen");
      return;
    }

    console.log("Generating vocab.ts...");
    const temporaryPath = join(schemaDir, `vocab-${randomUUID()}.ts`);
    try {
      await (options.generate ?? generateVocab)(schemaDir, temporaryPath);
      const formatted = await (options.format ?? formatGenerated)(
        await readFile(temporaryPath, "utf8"),
      );
      await writeFile(temporaryPath, formatted);
      // Publish only a complete, formatted file. Failed runs preserve vocab.ts.
      await rename(temporaryPath, generatedPath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => {});
    }
    console.log("Codegen completed successfully");
  } finally {
    await lock.release();
  }
}
