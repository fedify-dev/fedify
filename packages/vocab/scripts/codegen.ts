import $ from "@david/dax";
import type { Path } from "@david/dax";
import { generateVocab } from "@fedify/vocab-tools";

const LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes
const LOCK_RETRY_MS = 100;
const LOCK_TIMEOUT_MS = 60 * 1000; // 1 minute

/**
 * Get the latest mtime among files under a directory tree (recursively),
 * limited to the given file extensions.  Returns 0 if the directory is absent.
 */
async function getLatestMtimeUnder(
  dir: Path,
  exts: readonly string[],
): Promise<number> {
  if (!(await dir.exists())) return 0;
  let latestMtime = 0;
  for await (const entry of Deno.readDir(dir.toString())) {
    const child = dir.join(entry.name);
    if (entry.isDirectory) {
      const mtime = await getLatestMtimeUnder(child, exts);
      if (mtime > latestMtime) latestMtime = mtime;
    } else if (entry.isFile && exts.some((ext) => entry.name.endsWith(ext))) {
      const fileStat = await child.stat();
      const mtime = fileStat?.mtime?.getTime() ?? 0;
      if (mtime > latestMtime) latestMtime = mtime;
    }
  }
  return latestMtime;
}

/**
 * Check if the generated file is up to date compared to its source files,
 * including the generator itself (`@fedify/vocab-tools` and this codegen
 * script): changing the generator changes the generated output, so the
 * generated file must be at least as new as those too.
 */
async function isUpToDate(
  schemaDir: Path,
  generatedPath: Path,
  generatorMtime: number,
): Promise<boolean> {
  try {
    const [sourceMtime, generatedStat] = await Promise.all([
      getLatestMtimeUnder(schemaDir, [".yaml"]),
      generatedPath.stat(),
    ]);
    if (!generatedStat?.mtime) return false;
    return generatedStat.mtime.getTime() >=
      Math.max(sourceMtime, generatorMtime);
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
    // The generated vocab.ts depends not only on the YAML schemas but on the
    // generator itself: @fedify/vocab-tools and this codegen script.  Sample
    // its mtime inside the lock so that a generator edit made while we were
    // waiting for the lock is not missed by the freshness check below.
    const generatorMtime = Math.max(
      await getLatestMtimeUnder(
        packageDir.parent()!.join("vocab-tools", "src"),
        [".ts", ".yaml"],
      ),
      await getLatestMtimeUnder(scriptsDir, [".ts"]),
    );

    // Check if regeneration is needed (after acquiring lock)
    if (await isUpToDate(schemaDir, realPath, generatorMtime)) {
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
