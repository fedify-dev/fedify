import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { gunzipSync } from "node:zlib";

// Use the repository's setting, but never let the negative control damage its
// installed dependencies. Run through mise; DENO_TEST_BINARY may select a
// different installed Deno without changing the pinned toolchain.
const config = JSON.parse(
  readFileSync(new URL("../deno.json", import.meta.url), "utf8"),
);
const deno = process.env.DENO_TEST_BINARY ?? "deno";
const root = mkdtempSync(join(tmpdir(), "fedify-pack-"));
function write(path, data) {
  writeFileSync(join(root, path), data);
}
function json(path, value) {
  write(path, JSON.stringify(value));
}
function run(command, args, cwd = root) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });
}
function links() {
  return [
    readlinkSync(join(root, "packages/adapter/node_modules/@fedify/pack-core")),
    readlinkSync(join(root, "packages/adapter/node_modules/chalk")),
    readdirSync(join(root, "node_modules")).sort(),
  ];
}
function packedManifest(path) {
  const tar = gunzipSync(readFileSync(path));
  for (let offset = 0; offset < tar.length;) {
    const name = tar.subarray(offset, offset + 100).toString().split("\0")[0];
    const size = parseInt(
      tar.subarray(offset + 124, offset + 136).toString().replace(/\0/g, ""),
      8,
    );
    if (!name) break;
    if (name === "package/package.json") {
      return JSON.parse(tar.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("Packed package.json not found");
}

try {
  mkdirSync(join(root, "packages/core"), { recursive: true });
  mkdirSync(join(root, "packages/adapter"), { recursive: true });
  json("package.json", { private: true });
  write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
  json("deno.json", {
    nodeModulesDir: config.nodeModulesDir,
    workspace: ["./packages/core", "./packages/adapter"],
    imports: { chalk: "npm:chalk@5.6.2" },
  });
  json("packages/core/deno.json", {
    name: "@fedify/pack-core",
    version: "1.2.3",
    exports: "./mod.js",
  });
  json("packages/core/package.json", {
    name: "@fedify/pack-core",
    version: "1.2.3",
    type: "module",
    exports: "./mod.js",
  });
  write("packages/core/mod.js", "export const value = 42;\n");
  json("packages/adapter/deno.json", { exports: "./mod.js" });
  json("packages/adapter/package.json", {
    name: "@fedify/pack-adapter",
    version: "1.2.3",
    type: "module",
    peerDependencies: { "@fedify/pack-core": "workspace:^" },
    devDependencies: { chalk: "5.6.2" },
    scripts: { prepack: "node prepack.js" },
  });
  write(
    "packages/adapter/mod.js",
    'import chalk from "chalk";\nimport { value } from "@fedify/pack-core";\nconsole.log(chalk.green(String(value)));\n',
  );
  write(
    "packages/adapter/prepack.js",
    'import "./mod.js";\nimport { writeFileSync } from "node:fs";\nwriteFileSync("lifecycle.txt", "prepack ran");\n',
  );
  run("pnpm", ["install", "--ignore-scripts", "--no-frozen-lockfile"]);
  const before = links();
  console.log(run(deno, ["--version"]).trim());
  run(deno, ["check", "packages/adapter/mod.js"]);
  deepStrictEqual(links(), before, "Deno changed pnpm's node_modules");
  run(
    "pnpm",
    ["pack", "--pack-destination", root],
    join(root, "packages/adapter"),
  );
  strictEqual(
    readFileSync(join(root, "packages/adapter/lifecycle.txt"), "utf8"),
    "prepack ran",
  );
  const manifest = packedManifest(join(root, "fedify-pack-adapter-1.2.3.tgz"));
  strictEqual(manifest.peerDependencies["@fedify/pack-core"], "^1.2.3");
  console.log(
    "Deno preserved pnpm links and lifecycle-enabled packing passed.",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
