/**
 * Automatically updates third-party dependency versions in `fedify init`
 * templates to their latest releases.
 *
 * Updates:
 *   - packages/init/src/json/deps.json (web framework & common dependencies)
 *   - packages/init/src/json/kv.json   (key-value store dependencies)
 *   - packages/init/src/json/mq.json   (message queue dependencies)
 *
 * Usage:
 *   deno run -A scripts/update_init_deps.ts
 */
import { dirname, fromFileUrl, join } from "@std/path";

const scriptDir = dirname(fromFileUrl(import.meta.url));
const jsonDir = join(scriptDir, "..", "src", "json");

// --- Registry helpers --------------------------------------------------------

/** Strip the `npm:` prefix that some keys carry (e.g. `npm:express`). */
function npmName(key: string): string {
  return key.startsWith("npm:") ? key.slice(4) : key;
}

/**
 * For deps.json keys like `@types/node@22`, return the bare package name
 * (`@types/node`) and, optionally, the pinned major (`22`).
 */
function parseKey(key: string): { pkg: string; major: number | undefined } {
  const match = key.match(/^(.+)@(\d+)$/);
  if (match) {
    return { pkg: match[1], major: Number(match[2]) };
  }
  return { pkg: key, major: undefined };
}

/** Extract the major version number from a caret-range string like `^4.5.0`. */
function majorOf(version: string): number {
  const v = version.replace(/^\^/, "");
  return Number(v.split(".")[0]);
}

async function fetchLatestNpm(
  packageName: string,
): Promise<string | undefined> {
  const url = `https://registry.npmjs.org/${
    encodeURIComponent(packageName).replace("%40", "@")
  }/latest`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return undefined;
    const data = await resp.json() as { version: string };
    return data.version;
  } catch {
    return undefined;
  }
}

async function fetchLatestJsr(
  packageName: string,
): Promise<string | undefined> {
  // packageName is e.g. "@std/dotenv" → scope=std, name=dotenv
  const match = packageName.match(/^@([^/]+)\/(.+)$/);
  if (!match) return undefined;
  const [, scope, name] = match;
  const url = `https://jsr.io/api/scopes/${scope}/packages/${name}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return undefined;
    const data = await resp.json() as { latestVersion: string };
    return data.latestVersion;
  } catch {
    return undefined;
  }
}

/**
 * Fetch the latest version of a package from the appropriate registry,
 * returning it only when it falls within the same major as `currentRange`.
 */
async function getLatestVersion(
  key: string,
  currentRange: string,
): Promise<string | undefined> {
  const { pkg, major: pinnedMajor } = parseKey(key);
  const cleanPkg = npmName(pkg);
  const currentMajor = pinnedMajor ?? majorOf(currentRange);

  const latest = pkg.startsWith("npm:")
    ? await fetchLatestNpm(cleanPkg)
    : await fetchLatestJsr(cleanPkg);

  if (!latest) return undefined;

  const latestMajor = Number(latest.split(".")[0]);
  if (latestMajor !== currentMajor) {
    console.warn(
      `  ⚠  ${cleanPkg}: latest ${latest} has different major ` +
        `(current ^${currentMajor}.x)—skipped`,
    );
    return undefined;
  }

  return `^${latest}`;
}

// --- File update helpers -----------------------------------------------------

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(path));
}

async function writeJson(
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2) + "\n");
}

// --- deps.json ---------------------------------------------------------------

async function updateDepsJson(): Promise<void> {
  const path = join(jsonDir, "deps.json");
  const deps = await readJson(path) as Record<string, string>;
  let changed = 0;

  for (const [key, currentRange] of Object.entries(deps)) {
    const latest = await getLatestVersion(key, currentRange);
    if (latest && latest !== currentRange) {
      const { pkg } = parseKey(key);
      console.log(`  ${npmName(pkg)}: ${currentRange} → ${latest}`);
      deps[key] = latest;
      changed++;
    }
  }

  if (changed > 0) {
    await writeJson(path, deps);
    console.log(`  Updated ${changed} entries in deps.json\n`);
  } else {
    console.log("  deps.json is up to date\n");
  }
}

// --- kv.json / mq.json ------------------------------------------------------

interface StoreEntry {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

async function updateStoreJson(fileName: string): Promise<void> {
  const path = join(jsonDir, fileName);
  const stores = await readJson(path) as Record<string, StoreEntry>;
  let changed = 0;

  for (const [storeName, entry] of Object.entries(stores)) {
    for (const field of ["dependencies", "devDependencies"] as const) {
      const deps = entry[field];
      if (!deps) continue;
      for (const [key, currentRange] of Object.entries(deps)) {
        const latest = await getLatestVersion(key, currentRange);
        if (latest && latest !== currentRange) {
          console.log(
            `  ${storeName}.${field}[${
              npmName(key)
            }]: ${currentRange} → ${latest}`,
          );
          deps[key] = latest;
          changed++;
        }
      }
    }
  }

  if (changed > 0) {
    await writeJson(path, stores);
    console.log(`  Updated ${changed} entries in ${fileName}\n`);
  } else {
    console.log(`  ${fileName} is up to date\n`);
  }
}

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Updating deps.json ...");
  await updateDepsJson();

  console.log("Updating kv.json ...");
  await updateStoreJson("kv.json");

  console.log("Updating mq.json ...");
  await updateStoreJson("mq.json");

  console.log("Done.");
}

main();
