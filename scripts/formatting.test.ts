import { deepStrictEqual, equal, match, notEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { format, type OxfmtConfig } from "oxfmt";
import { formatGenerated } from "../packages/vocab/scripts/codegen_lib.ts";
import { generateVocab } from "../packages/vocab-tools/src/mod.ts";
import { commandOutput } from "./tooling_process.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const configText = await readFile(join(root, ".oxfmtrc.json"), "utf8");
const config = JSON.parse(configText) as OxfmtConfig;
const nodeExecutable =
  process.versions.deno != null || process.versions.bun != null
    ? "node"
    : process.execPath;
const cli = join(root, "node_modules", "oxfmt", "bin", "oxfmt");

it("preserves source order, quoted keys and embedded template contents", async () => {
  const source = [
    'import z from "z";',
    'import a from "a";',
    'import { zed, alpha, type Z, type A } from "members";',
    'export const value={"quoted":z,bare:a};',
    'export const template=html`<div   class="test">  text </div>`;',
    'export const component=<div className="text-red-500 p-2 block"/>;',
  ].join("\n");
  const result = await format("example.tsx", source, config);
  deepStrictEqual(result.errors, []);
  match(result.code, /import z from "z";\nimport a from "a";/);
  match(result.code, /import \{ zed, alpha, type Z, type A \} from "members";/);
  match(result.code, /"quoted": z/);
  match(result.code, /bare: a/);
  match(result.code, /html`<div {3}class="test"> {2}text <\/div>`/);
  match(result.code, /className="text-red-500 p-2 block"/);
  equal((await format("example.tsx", result.code, config)).code, result.code);
  const manifest = await format(
    "package.json",
    '{"scripts":{"z":"z","a":"a"},"name":"example"}',
    config,
  );
  deepStrictEqual(manifest.errors, []);
  deepStrictEqual(Object.keys(JSON.parse(manifest.code)), ["scripts", "name"]);
  deepStrictEqual(Object.keys(JSON.parse(manifest.code).scripts), ["z", "a"]);
});

it("formats owned languages and preserves excluded files through the real CLI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify formatting "));
  const owned: Record<string, string> = {
    "source.ts": "export const value={answer:42}\n",
    "settings.jsonc": '// comment\n{"answer":42}\n',
    "styles.css": ".sample{color:red}\n",
    "compose.yaml": "services:\n app: {image: example}\n",
    "schema/example.json": '{"answer":42}\n',
    "examples/astro/Page.astro":
      "---\nconst value={answer:42};\n---\n<div>{value.answer}</div>\n",
    "examples/nuxt/Page.vue":
      '<script setup lang="ts">\nconst value={answer:42};\n</script>\n<template><div>{{value.answer}}</div></template>\n',
    "examples/svelte/Page.svelte":
      '<script lang="ts">\nconst value={answer:42};\n</script>\n<div>{value.answer}</div>\n',
  };
  const ignored = [
    "README.md",
    "CHANGES.md",
    "changes.d/entry.md",
    "docs/example.ts",
    ".github/settings.json",
    ".agents/skills/example.ts",
    "claude-plugin/example.ts",
    "tools/example.ts",
    "pnpm-workspace.yaml",
    "packages/init/src/templates/example.ts",
    "packages/cli/src/init/templates/example.ts",
    "packages/relay/src/init/templates/example.ts",
    "packages/fedify/src/cfworkers/fixtures/example.ts",
    "packages/fedify/src/cfworkers/server.ts",
    "packages/cfworkers/test/example.ts",
    "packages/vocab/src/object.yaml",
    "packages/vocab-tools/src/schema.yaml",
    "schema/bench/scenario-v1.json",
    "schema/bench/scenario-v2.json",
    "schema/bench/report-v1.json",
    "schema/bench/report-v2.json",
    "schema/bench/report-v3.json",
    "schema/bench/compare-report-v1.json",
    "packages/example/dist/example.ts",
  ];
  const untouched = "intentionally not formatter input  {\n";
  try {
    await writeFile(join(dir, ".oxfmtrc.json"), configText);
    for (const [path, source] of [
      ...Object.entries(owned),
      ...ignored.map((path) => [path, untouched]),
    ]) {
      const file = join(dir, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, source);
    }
    const run = async (mode: "--write" | "--check") => {
      const result = await commandOutput(
        nodeExecutable,
        // This tiny fixture tests ownership and output, not worker concurrency.
        // Repository-wide checks still exercise the default parallel run.
        [cli, "--threads=1", "-c", ".oxfmtrc.json", mode, "."],
        { cwd: dir },
      );
      equal(
        result.code,
        0,
        new TextDecoder().decode(result.stdout) +
          new TextDecoder().decode(result.stderr),
      );
    };
    await run("--write");
    const formatted = new Map<string, string>();
    for (const [path, original] of Object.entries(owned)) {
      const actual = await readFile(join(dir, path), "utf8");
      notEqual(actual, original, `${path} must be formatted`);
      formatted.set(path, actual);
    }
    for (const path of ignored) {
      equal(await readFile(join(dir, path), "utf8"), untouched, path);
    }
    await run("--write");
    for (const [path, expected] of formatted) {
      equal(await readFile(join(dir, path), "utf8"), expected, path);
    }
    await run("--check");
    // Editors pass a buffer through stdin, including for excluded templates.
    const stdin = spawnSync(
      nodeExecutable,
      [
        cli,
        "-c",
        ".oxfmtrc.json",
        "--stdin-filepath",
        "packages/init/src/templates/example.ts",
      ],
      { cwd: dir, encoding: "utf8", input: untouched },
    );
    equal(stdin.status, 0, stdin.stderr);
    equal(stdin.stdout, untouched);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("formats actual generated vocabulary identically through the API and CLI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify generated formatting "));
  const schemaDir = join(dir, "packages/vocab/src");
  const generatedPath = join(schemaDir, "vocab.ts");
  try {
    await mkdir(schemaDir, { recursive: true });
    await writeFile(join(dir, ".oxfmtrc.json"), configText);
    await writeFile(join(schemaDir, ".gitignore"), "vocab.ts\n");
    await writeFile(
      join(schemaDir, "sample.yaml"),
      [
        "name: Sample",
        "uri: https://example.com/Sample",
        "entity: true",
        'description: "A formatter parity fixture."',
        "defaultContext: {}",
        "properties: []",
        "",
      ].join("\n"),
    );
    await generateVocab(schemaDir, generatedPath);
    const raw = await readFile(generatedPath, "utf8");
    const expected = await formatGenerated(raw);
    const result = await commandOutput(
      nodeExecutable,
      [cli, "-c", ".oxfmtrc.json", "--write", "packages/vocab/src/vocab.ts"],
      { cwd: dir },
    );
    equal(
      result.code,
      0,
      new TextDecoder().decode(result.stdout) +
        new TextDecoder().decode(result.stderr),
    );
    equal(await readFile(generatedPath, "utf8"), expected);
    equal(await formatGenerated(expected), expected);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
