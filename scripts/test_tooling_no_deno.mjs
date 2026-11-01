import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "fedify-tooling-no-deno-"));
try {
  const bin = join(scratch, "bin");
  const cache = join(scratch, "deno-cache");
  const calls = join(scratch, "deno-calls.log");
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
    FEDIFY_DENO_INVOCATIONS: calls,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
  };
  const tasks = [
    ["check-versions"],
    ["check:fixture-usage"],
    ["check:workspace-protocol"],
    ["test:tooling"],
    ["test:temporal-polyfill"],
    ["generate:packages-table", "--", "--format=table", "2.5.0"],
    [
      "test:init",
      "--",
      "-w",
      "hono",
      "-p",
      "npm",
      "-k",
      "in-memory",
      "-m",
      "in-process",
      "--no-hyd-run",
    ],
  ];
  for (const args of tasks) {
    console.log(`\nChecking without Deno: mise run ${args.join(" ")}`);
    const result = spawnSync("mise", ["run", ...args], {
      cwd: root,
      env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `mise run ${args.join(" ")}`);
  }
  assert.deepEqual(await readdir(cache), [], "no Deno cache was prepared");
  assert.equal(
    (await readdir(scratch)).includes("deno-calls.log"),
    false,
    "a Node-only task invoked Deno",
  );
  console.log(
    "Node-only tooling completed without invoking Deno or preparing its cache.",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
