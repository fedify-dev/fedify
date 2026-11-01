import { deepStrictEqual, doesNotMatch, match } from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

async function withProject(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "fedify maintenance "));
  try {
    await mkdir(join(root, "scripts"));
    await mkdir(join(root, "packages", "fedify", "src", "testing"), {
      recursive: true,
    });
    await mkdir(join(root, "changes.d"));
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      join(root, "deno.json"),
      JSON.stringify({ workspace: ["packages/fedify"] }),
    );
    await writeFile(
      join(root, "packages", "fedify", "deno.json"),
      JSON.stringify({ name: "@fedify/fedify", version: "1.0.0" }),
    );
    await writeFile(
      join(root, "packages", "fedify", "package.json"),
      JSON.stringify({ name: "@fedify/fedify", version: "1.0.0" }),
    );
    await writeFile(
      join(root, "pnpm-workspace.yaml"),
      "packages:\n  - packages/fedify\n",
    );
    await writeFile(join(root, "changes.d", "next.txt"), "1.0.0\n");
    await symlink(
      resolve(scriptsDir, "..", "node_modules"),
      join(root, "node_modules"),
      "junction",
    );
    for (
      const name of [
        "check_versions.ts",
        "check_fixture_usage.ts",
        "check_workspace_protocol.ts",
        "generate_packages_table.ts",
        "tooling_main.ts",
        "tooling_fs.ts",
      ]
    ) {
      await copyFile(join(scriptsDir, name), join(root, "scripts", name));
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function runScript(root: string, script: string, args: string[] = []) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const node = "deno" in process.versions ? "node" : process.execPath;
      const child = spawn(node, [
        "--experimental-strip-types",
        join(root, "scripts", script),
        ...args,
      ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => stdout += chunk);
      child.stderr.setEncoding("utf8").on("data", (chunk) => stderr += chunk);
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}

test("version CLI preserves read-only checks, fixes and --skip-next", async () => {
  await withProject(async (root) => {
    deepStrictEqual((await runScript(root, "check_versions.ts")).code, 0);
    const manifest = join(root, "packages", "fedify", "package.json");
    const mismatched = '{"name":"@fedify/fedify","version":"0.9.0"}';
    await writeFile(manifest, mismatched);
    const failure = await runScript(root, "check_versions.ts");
    deepStrictEqual(failure.code, 1);
    match(failure.stderr, /Version mismatch/);
    deepStrictEqual(await readFile(manifest, "utf8"), mismatched);
    const fixed = await runScript(root, "check_versions.ts", ["--fix"]);
    deepStrictEqual(fixed.code, 0);
    deepStrictEqual(
      JSON.parse(await readFile(manifest, "utf8")).version,
      "1.0.0",
    );
    await writeFile(join(root, "changes.d", "next.txt"), "2.0.0\n");
    deepStrictEqual((await runScript(root, "check_versions.ts")).code, 1);
    deepStrictEqual(
      (await runScript(root, "check_versions.ts", ["--skip-next"])).code,
      0,
    );
  });
});

test("scanner CLIs report violations and succeed after correction", async () => {
  await withProject(async (root) => {
    const source = join(root, "packages", "fedify", "src", "violation.ts");
    await writeFile(source, 'import "@fedify/fixture";');
    const fixtureFailure = await runScript(root, "check_fixture_usage.ts");
    deepStrictEqual(fixtureFailure.code, 1);
    match(fixtureFailure.stderr, /violation\.ts/);
    await rm(source);
    deepStrictEqual((await runScript(root, "check_fixture_usage.ts")).code, 0);
    const manifest = join(root, "packages", "fedify", "package.json");
    await writeFile(manifest, '{"dependencies":{"example":"workspace:"}}');
    const workspaceFailure = await runScript(
      root,
      "check_workspace_protocol.ts",
    );
    deepStrictEqual(workspaceFailure.code, 1);
    match(workspaceFailure.stderr, /example/);
    doesNotMatch(workspaceFailure.stdout, /All workspace/);
    await writeFile(manifest, '{"dependencies":{"example":"workspace:*"}}');
    const success = await runScript(root, "check_workspace_protocol.ts");
    deepStrictEqual(success.code, 0);
    match(success.stdout, /All workspace/);
  });
});

test("scanner CLI runs through a symlinked directory", async () => {
  await withProject(async (root) => {
    await writeFile(
      join(root, "packages", "fedify", "src", "violation.ts"),
      'import "@fedify/fixture";',
    );
    await symlink(join(root, "scripts"), join(root, "linked"), "junction");
    const result = await runScript(root, "../linked/check_fixture_usage.ts");
    deepStrictEqual(result.code, 1);
    match(result.stderr, /violation\.ts/);
  });
});

test("scanner CLI runs through a symlinked entry file", {
  skip: process.platform === "win32",
}, async () => {
  await withProject(async (root) => {
    await writeFile(
      join(root, "packages", "fedify", "src", "violation.ts"),
      'import "@fedify/fixture";',
    );
    await symlink(
      join(root, "scripts", "check_fixture_usage.ts"),
      join(root, "scripts", "linked.ts"),
    );
    const result = await runScript(root, "linked.ts");
    deepStrictEqual(result.code, 1);
    match(result.stderr, /violation\.ts/);
  });
});

test("package table CLI keeps table and link formats separate", async () => {
  await withProject(async (root) => {
    const table = await runScript(root, "generate_packages_table.ts", [
      "--format=table",
      "1.0.0+abc",
    ]);
    deepStrictEqual(table.code, 0);
    match(table.stdout, /\| @fedify\/fedify \| 1\.0\.0\+abc \|/);
    doesNotMatch(table.stdout, /https:\/\//);
    const links = await runScript(root, "generate_packages_table.ts", [
      "--format=links",
      "1.0.0+abc",
    ]);
    deepStrictEqual(links.code, 0);
    match(
      links.stdout,
      /https:\/\/www\.npmjs\.com\/package\/@fedify\/fedify\/v\/1\.0\.0\n/,
    );
    doesNotMatch(links.stdout, /\| Package/);
    deepStrictEqual(
      (await runScript(root, "generate_packages_table.ts", [
        "--format=invalid",
        "1.0.0",
      ])).code,
      1,
    );
    deepStrictEqual(
      (await runScript(root, "generate_packages_table.ts")).code,
      1,
    );
    deepStrictEqual(
      (await runScript(root, "generate_packages_table.ts", ["--help"])).code,
      0,
    );
  });
});
