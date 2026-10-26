// Run only in a fresh clone or an independent git-init copy, never a worktree.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
for (
  const path of [
    "node_modules",
    "packages/vocab/src/vocab.ts",
    ...((await readdir(join(root, "packages"))).flatMap((name) => [
      `packages/${name}/dist`,
      `packages/${name}/dist-tests`,
    ])),
  ]
) {
  await assert.rejects(access(join(root, path)), { code: "ENOENT" }, path);
}
// The existing tool-install hook writes .git/hooks by literal path.
await access(join(root, ".git/hooks"));
const scratch = await mkdtemp(join(tmpdir(), "fedify-bootstrap-"));
try {
  const bin = join(scratch, "bin");
  const cache = join(scratch, "deno-cache");
  const log = join(scratch, "deno-invocations.log");
  await mkdir(bin);
  await mkdir(cache);
  await writeFile(
    join(bin, "deno"),
    '#!/bin/sh\nprintf "Deno invoked\\n" >> "$FEDIFY_DENO_INVOCATIONS"\nexit 97\n',
  );
  await chmod(join(bin, "deno"), 0o755);
  await writeFile(
    join(bin, "deno.cmd"),
    '@echo off\r\necho Deno invoked>>"%FEDIFY_DENO_INVOCATIONS%"\r\nexit /b 97\r\n',
  );
  const env = {
    ...process.env,
    CI: "true",
    MISE_DISABLE_TOOLS: "deno",
    DENO_DIR: cache,
    FEDIFY_DENO_INVOCATIONS: log,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
  };
  const run = (command, args, cwd = root) => {
    const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${command} ${args.join(" ")}`);
  };
  run("mise", ["trust", join(root, "mise.toml")]);
  // Tool installation exercises the real postinstall/deps/prepare path.
  run("mise", ["install"]);
  // Check postinstall before explicit tasks could conceal skipped hooks.
  await access(join(root, "packages/vocab/src/vocab.ts"));
  run("mise", ["deps"]);
  run("mise", ["run", "build"]);
  run("mise", ["run", "test:codegen"]);
  // Every library package with build:self must have emitted its dist/ output.
  for (const name of await readdir(join(root, "packages"))) {
    let metadata;
    try {
      metadata = JSON.parse(
        await readFile(join(root, "packages", name, "package.json"), "utf8"),
      );
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (metadata.scripts?.["build:self"]) {
      await access(join(root, "packages", name, "dist"));
    }
  }
  assert.equal(
    await realpath(join(root, "packages/fedify/node_modules/@fedify/vocab")),
    await realpath(join(root, "packages/vocab")),
  );
  run("mise", [
    "exec",
    "--",
    "node",
    "--input-type=module",
    "-e",
    'await import("@fedify/vocab"); await import("@fedify/vocab-runtime");',
  ], join(root, "packages/fedify"));
  await assert.rejects(access(log), { code: "ENOENT" });
  assert.deepEqual(await readdir(cache), []);
  console.log("Fresh bootstrap passed without Deno or a Deno cache.");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
