// Run after a Windows bootstrap failure to isolate native formatter crashes.
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  appendFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "node_modules", "oxfmt", "bin", "oxfmt");
const config = await readFile(join(root, ".oxfmtrc.json"), "utf8");
const sources = {
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
const frameworks = Object.keys(sources).filter((p) =>
  /\.(astro|vue|svelte)$/.test(p),
);
const cases = [
  ...Object.keys(sources).map((file) => [file, [file]]),
  ["mixed", Object.keys(sources)],
  ["frameworks", frameworks],
  ...frameworks.map((file) => [
    "without-" + file,
    Object.keys(sources).filter((p) => p !== file),
  ]),
];
for (const file of frameworks) {
  const path = file.replace("Page.", "Static.");
  sources[path] = "<div>hello</div>\n";
  cases.push([path, [path]]);
}
console.log(
  JSON.stringify({
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  }),
);
let failed = false;
const output = process.argv[2];
if (output != null) await mkdir(output, { recursive: true });
const scratch = await mkdtemp(
  join(output ?? tmpdir(), "fedify formatter diagnosis "),
);
const log = join(scratch, "processes.jsonl");
try {
  for (const [name, files] of cases) {
    const cwd = join(scratch, name.replaceAll("/", "-").replaceAll("\\", "-"));
    await mkdir(cwd, { recursive: true });
    await writeFile(join(cwd, ".oxfmtrc.json"), config);
    for (let attempt = 1; attempt <= 3; attempt++) {
      for (const file of [...files, ...ignored]) {
        await mkdir(dirname(join(cwd, file)), { recursive: true });
        await writeFile(
          join(cwd, file),
          sources[file] ?? "intentionally not formatter input  {\n",
        );
      }
      for (const mode of ["--write", "--write", "--check"]) {
        const args = [cli, "-c", ".oxfmtrc.json", mode, "."];
        const started = new Date();
        const result = spawnSync(process.execPath, args, {
          cwd,
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        const entry = {
          executable: process.execPath,
          cwd,
          case: name,
          attempt,
          started: started.toISOString(),
          durationMs: Date.now() - started.getTime(),
          pid: result.pid,
          args,
          status: result.status,
          statusHex:
            result.status == null
              ? null
              : `0x${(result.status >>> 0).toString(16)}`,
          signal: result.signal,
          error: result.error?.message,
          stdout: result.stdout,
          stderr: result.stderr,
        };
        const line = JSON.stringify(entry);
        console.log(line);
        await appendFile(log, line + "\n");
        if (result.status !== 0 || result.error != null) failed = true;
      }
    }
  }
} finally {
  if (output == null) await rm(scratch, { recursive: true, force: true });
}
// Every failed process remains a failure, even if later probes succeed.
process.exitCode = failed ? 1 : 0;
