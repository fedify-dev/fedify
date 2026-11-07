// Run after a Windows bootstrap failure to isolate native formatter crashes.
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  appendFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { startCommand } from "./tooling_process.ts";

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
const mixedFiles = Object.keys(sources);
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
const focused = process.argv[3] === "--mixed";
const selected = focused
  ? [
      ["mixed-default", mixedFiles],
      ["mixed-serial", mixedFiles],
    ]
  : cases;
const childEnv = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [
    key,
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|HOME|APPDATA|LOCALAPPDATA|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|RUNNER_TRACKING_ID)$/i.test(
      key,
    )
      ? value
      : "",
  ]),
);
const dumpDir = join(scratch, "dumps");
let captureAttempted = false;
try {
  for (const [name, files] of selected) {
    const cwd = join(scratch, name.replaceAll("/", "-").replaceAll("\\", "-"));
    await mkdir(cwd, { recursive: true });
    await writeFile(join(cwd, ".oxfmtrc.json"), config);
    const extraArgs = name === "mixed-serial" ? ["--threads=1"] : [];
    for (let attempt = 1; attempt <= (focused ? 20 : 3); attempt++) {
      for (const file of [...files, ...ignored]) {
        await mkdir(dirname(join(cwd, file)), { recursive: true });
        await writeFile(
          join(cwd, file),
          sources[file] ?? "intentionally not formatter input  {\n",
        );
      }
      for (const mode of ["--write", "--write", "--check"]) {
        const args = [cli, ...extraArgs, "-c", ".oxfmtrc.json", mode, "."];
        const started = new Date();
        const result = spawnSync(process.execPath, args, {
          cwd,
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 2 * 1024 * 1024,
          env: focused ? childEnv : process.env,
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
        const procDump = process.env.FEDIFY_FORMATTER_PROCDUMP;
        if (focused && !captureAttempted && result.status !== 0 && procDump) {
          captureAttempted = true;
          await mkdir(dumpDir);
          for (let capture = 1; capture <= 10; capture++) {
            const debuggerArgs = [
              "-accepteula",
              "-e",
              "-mm",
              "-k",
              "-x",
              dumpDir,
              process.execPath,
              ...args,
            ];
            const child = startCommand(procDump, debuggerArgs, {
              cwd,
              // Keep the ordinary heap layout when launching under a debugger.
              env: { ...childEnv, _NO_DEBUG_HEAP: "1" },
            });
            let stopping;
            const deadline = setTimeout(() => {
              stopping = child.stop();
            }, 30_000);
            let debuggerResult;
            try {
              const [status, stdout, stderr] = await Promise.all([
                child.status,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
              ]);
              debuggerResult = { status: status.code, stdout, stderr };
            } catch (error) {
              debuggerResult = { status: null, error: String(error) };
            } finally {
              clearTimeout(deadline);
              await stopping;
            }
            const captureLine = JSON.stringify({
              debugger: true,
              noDebugHeap: "1",
              capture,
              args: debuggerArgs,
              debuggerStatus: debuggerResult.status,
              error: debuggerResult.error,
              stdout: debuggerResult.stdout,
              stderr: debuggerResult.stderr,
            });
            console.log(captureLine);
            await appendFile(log, captureLine + "\n");
            if ((await readdir(dumpDir)).some((file) => file.endsWith(".dmp")))
              break;
          }
        }
      }
    }
  }
} finally {
  if (output == null) await rm(scratch, { recursive: true, force: true });
}
// Every failed process remains a failure, even if later probes succeed.
process.exitCode = failed ? 1 : 0;
