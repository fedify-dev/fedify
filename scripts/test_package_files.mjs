// Check the publisher's actual file lists, rather than duplicating its glob rules.
// Run through mise after building; lifecycle hooks are skipped while packing.
import { ok } from "node:assert/strict";
import { checkExports } from "./package_exports.mjs";
import spawn from "cross-spawn";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
function run(command, args, cwd = repo) {
  const result = spawn.sync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: "pipe",
  });
  if (result.error || result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw result.error ?? new Error(`${command} failed: ${result.status}`);
  }
  return result.stdout + result.stderr;
}
function checkFiles(name, files) {
  ok(files.length > 0, `${name}: no files found`);
  for (const file of files) {
    // *.test.ts.tpl is a runtime initializer template, not a repository test.
    ok(
      !/(?:^|\/)(?:__snapshots__|__fixtures__|fixtures|testdata|test|tests|dist-tests)\//.test(
        file,
      ) &&
        !/\.(?:test|bench)\.(?:[cm]?[jt]s|d\.[cm]?ts)(?:\.map)?$/.test(file) &&
        !/\.snap$/.test(file),
      `${name}: repository test asset was packed: ${file}`,
    );
  }
}

const options = process.argv.slice(2);
ok(
  options.every((arg) => arg === "--npm" || arg === "--jsr"),
  "expected --npm or --jsr",
);
const npm = options.length === 0 || options.includes("--npm");
const jsr = options.length === 0 || options.includes("--jsr");
const scratch = mkdtempSync(join(tmpdir(), "fedify-package-files-"));
try {
  if (jsr) {
    const dryRun = run("deno", [
      "publish",
      "--dry-run",
      "--allow-dirty",
      "--allow-slow-types",
      "--no-check",
    ]);
    const jsrFiles = new Map();
    for (const line of dryRun.split("\n")) {
      // The pinned Deno CLI prints each file URL followed by a size in parentheses.
      // If that format changes, checkFiles() rejects the resulting empty lists.
      const match = line.match(/^\s+(file:\/\/.+) \([^()]+\)$/);
      if (!match) continue;
      const relative = fileURLToPath(match[1])
        .slice(repo.length)
        .replaceAll("\\", "/");
      const [, directory, ...segments] = relative.split("/");
      if (!jsrFiles.has(directory)) jsrFiles.set(directory, []);
      jsrFiles.get(directory).push(segments.join("/"));
    }
    const workspace = JSON.parse(readFileSync(join(repo, "deno.json"), "utf8"));
    for (const member of workspace.workspace.filter((path) =>
      path.startsWith("./packages/"),
    )) {
      const manifest = JSON.parse(
        readFileSync(join(repo, member, "deno.json"), "utf8"),
      );
      if (manifest.publish === false) continue;
      const directory = member.split("/").at(-1);
      const files = jsrFiles.get(directory) ?? [];
      checkFiles(manifest.name, files);
      checkExports(manifest.name, files, manifest);
      if (directory === "init")
        ok(files.includes("src/templates/defaults/smoke.test.ts.tpl"));
      if (directory === "cli") ok(files.includes("src/bench/mod.ts"));
      console.log(`JSR ${manifest.name}: ${files.length} files checked`);
    }
  }
  if (npm) {
    run("pnpm", [
      "--recursive",
      "--workspace-concurrency=1",
      "--filter=!./examples/**",
      "--config.ignore-scripts=true",
      "pack",
      "--pack-destination",
      scratch,
    ]);
    for (const directory of readdirSync(join(repo, "packages"))) {
      const cwd = join(repo, "packages", directory);
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (manifest.private) continue;
      const tarball = join(
        scratch,
        `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`,
      );
      ok(
        existsSync(tarball),
        `${manifest.name}: tarball not found: ${tarball}`,
      );
      const files = run("tar", ["-tzf", tarball])
        .trim()
        .split("\n")
        .filter((file) => !file.endsWith("/"))
        .map((file) => file.replace(/^package\//, ""));
      checkFiles(manifest.name, files);
      checkExports(manifest.name, files, manifest, cwd);
      if (directory === "init") {
        ok(files.includes("dist/templates/defaults/smoke.test.ts.tpl"));
      }
      if (directory === "cli") {
        ok(
          files.includes("dist/bench/mod.js"),
          "CLI benchmark module was not packed",
        );
      }
      if (directory === "vocab-tools") ok(files.includes("dist/schema.yaml"));
      console.log(`npm ${manifest.name}: ${files.length} files checked`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
