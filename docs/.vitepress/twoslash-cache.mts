import { createFileSystemTypesCache } from "@shikijs/vitepress-twoslash/cache-fs";
import { createHash } from "node:crypto";
import {
  existsSync,
  type Dirent,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cacheFormatVersion = 1;
const docsDir = fileURLToPath(new URL("../", import.meta.url));
const repositoryDir = fileURLToPath(new URL("../../", import.meta.url));

function isDeclarationFile(path: string): boolean {
  return path.endsWith(".d.ts") ||
    path.endsWith(".d.mts") ||
    path.endsWith(".d.cts");
}

function collectDeclarationFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];

  const files: string[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDeclarationFiles(path));
    } else if (entry.isFile() && isDeclarationFile(path)) {
      files.push(path);
    }
  }
  return files;
}

function getPackageDirectories(): string[] {
  const packagesDir = join(repositoryDir, "packages");
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry: Dirent) => entry.isDirectory())
    .map((entry: Dirent) => join(packagesDir, entry.name));
}

function getTypeEnvironmentFiles(): string[] {
  const files = [
    fileURLToPath(import.meta.url),
    join(repositoryDir, "deno.json"),
    join(repositoryDir, "package.json"),
    join(repositoryDir, "pnpm-lock.yaml"),
    join(repositoryDir, "pnpm-workspace.yaml"),
    join(docsDir, "package.json"),
    join(docsDir, ".vitepress", "config.mts"),
  ];

  for (const packageDir of getPackageDirectories()) {
    const packageJson = join(packageDir, "package.json");
    if (existsSync(packageJson)) files.push(packageJson);
    files.push(...collectDeclarationFiles(join(packageDir, "dist")));
  }

  return files.sort();
}

export function getFedifyTwoslashCacheNamespace(): string {
  const hash = createHash("sha256");
  hash.update(`fedify-twoslash-cache:${cacheFormatVersion}\0`);
  hash.update(`${process.platform}:${process.arch}:${process.versions.node}\0`);

  for (const path of getTypeEnvironmentFiles()) {
    hash.update(relative(repositoryDir, path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }

  return hash.digest("hex");
}

function normalizeForCacheKey(
  value: unknown,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return value.toString();
  if (typeof value === "symbol") return value.toString();
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForCacheKey(item, seen));
  }
  if (value instanceof Map) {
    return Array.from(value.entries())
      .map(([key, item]) => [
        normalizeForCacheKey(key, seen),
        normalizeForCacheKey(item, seen),
      ])
      .sort(([left], [right]) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      );
  }
  if (value instanceof Set) {
    return Array.from(value.values())
      .map((item) => normalizeForCacheKey(item, seen))
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      );
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeForCacheKey(item, seen)]),
  );
}

function getEntryCacheKey(
  code: string,
  lang: string | undefined,
  options: unknown,
): string {
  return JSON.stringify(
    normalizeForCacheKey(
      { cacheFormatVersion, code, lang, options },
      new WeakSet(),
    ),
  );
}

export function createFedifyTwoslashCache(): ReturnType<
  typeof createFileSystemTypesCache
> {
  const namespace = getFedifyTwoslashCacheNamespace();
  const cacheRoot = resolve(docsDir, ".vitepress", "cache", "twoslash");
  const cacheDir = join(cacheRoot, namespace);

  // Restored CI caches can contain obsolete type environments.  Keeping only
  // the current one prevents the cache artifact from growing without bound.
  if (existsSync(cacheRoot)) {
    for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
      if (entry.name !== namespace) {
        rmSync(join(cacheRoot, entry.name), { recursive: true, force: true });
      }
    }
  }

  const cache = createFileSystemTypesCache({
    dir: cacheDir,
  });

  return {
    init: cache.init,
    read(code, lang, options, meta) {
      return cache.read(getEntryCacheKey(code, lang, options), lang, options, meta);
    },
    write(code, data, lang, options, meta) {
      cache.write(
        getEntryCacheKey(code, lang, options),
        data,
        lang,
        options,
        meta,
      );
    },
  };
}
