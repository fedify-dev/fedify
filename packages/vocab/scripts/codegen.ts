import $ from "@david/dax";
import type { Path } from "@david/dax";
import { generateVocab } from "@fedify/vocab-tools";

const LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes
const LOCK_RETRY_MS = 100;
const LOCK_TIMEOUT_MS = 60 * 1000; // 1 minute

/**
 * Get the latest mtime from all YAML files in the schema directory.
 */
async function getLatestSourceMtime(schemaDir: Path): Promise<number> {
  let latestMtime = 0;
  for await (const entry of schemaDir.readDir()) {
    if (!entry.isFile) continue;
    if (!entry.name.match(/\.ya?ml$/i)) continue;
    if (entry.name === "schema.yaml") continue;
    const fileStat = await schemaDir.join(entry.name).stat();
    if (fileStat?.mtime && fileStat.mtime.getTime() > latestMtime) {
      latestMtime = fileStat.mtime.getTime();
    }
  }
  return latestMtime;
}

/**
 * Check if the generated file is up to date compared to source files.
 */
async function isUpToDate(
  schemaDir: Path,
  generatedPath: Path,
): Promise<boolean> {
  try {
    const [sourceMtime, generatedStat] = await Promise.all([
      getLatestSourceMtime(schemaDir),
      generatedPath.stat(),
    ]);
    if (!generatedStat?.mtime) return false;
    return generatedStat.mtime.getTime() >= sourceMtime;
  } catch {
    // If generated file doesn't exist, it's not up to date
    return false;
  }
}

interface Lock {
  release(): Promise<void>;
}

/**
 * Acquire a directory-based lock. mkdir is atomic on POSIX systems.
 */
async function acquireLock(lockPath: Path): Promise<Lock> {
  const startTime = Date.now();

  while (true) {
    try {
      // Use Deno.mkdir directly because dax's mkdir() is recursive by default
      await Deno.mkdir(lockPath.toString());
      // Write PID and timestamp for stale lock detection
      const infoPath = lockPath.join("info");
      await infoPath.writeJsonPretty({ pid: Deno.pid, timestamp: Date.now() });
      return {
        async release() {
          try {
            await lockPath.remove({ recursive: true });
          } catch {
            // Ignore errors during cleanup
          }
        },
      };
    } catch (e) {
      if (!(e instanceof Deno.errors.AlreadyExists)) {
        throw e;
      }

      // Check if lock is stale
      try {
        const infoPath = lockPath.join("info");
        const infoStat = await infoPath.stat();
        if (
          infoStat?.mtime &&
          Date.now() - infoStat.mtime.getTime() > LOCK_STALE_MS
        ) {
          console.warn("Removing stale lock:", lockPath.toString());
          await lockPath.remove({ recursive: true });
          continue;
        }
      } catch {
        // If we can't read the info file, try to remove the lock
        try {
          await lockPath.remove({ recursive: true });
          continue;
        } catch {
          // Ignore
        }
      }

      // Check timeout
      if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
        throw new Error(`Timeout waiting for lock: ${lockPath}`);
      }

      // Wait and retry
      await $.sleep(LOCK_RETRY_MS);
    }
  }
}

async function codegen() {
  const scriptsDir = $.path(import.meta.dirname!);
  const packageDir = scriptsDir.parent()!;
  const schemaDir = packageDir.join("src");
  const realPath = schemaDir.join("vocab.ts");
  const lockPath = packageDir.join(".vocab-codegen.lock");

  // Acquire lock to prevent concurrent codegen
  const lock = await acquireLock(lockPath);
  try {
    // Check if regeneration is needed (after acquiring lock)
    if (await isUpToDate(schemaDir, realPath)) {
      $.log("vocab.ts is up to date, skipping codegen");
      return;
    }

    $.logStep("Generating", "vocab.ts...");

    // Generate to a temporary file first
    const generatedPath = schemaDir.join(`vocab-${crypto.randomUUID()}.ts`);
    try {
      await generateVocab(schemaDir.toString(), generatedPath.toString());
      await generatedPath.rename(realPath);
    } catch (e) {
      // Clean up temp file on error
      await generatedPath.remove().catch(() => {});
      throw e;
    }

    $.logStep("Formatting", "vocab.ts...");
    await $`deno fmt ${realPath}`;

    $.logStep("Caching", "vocab.ts...");
    await $`deno cache ${realPath}`;

    $.logStep("Type checking", "vocab.ts...");
    await $`deno check ${realPath}`;

    $.logStep("Codegen", "completed successfully");
  } finally {
    await lock.release();
  }
}

if (import.meta.main) {
  await codegen();
}
