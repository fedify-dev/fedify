import { ok } from "node:assert/strict";
import test from "node:test";
import webFrameworks from "./webframeworks.ts";

test("Nitro template loads LogTape during server startup", async () => {
  const { files } = await webFrameworks.nitro.init({
    projectName: "test-app",
    dir: ".",
    command: "init",
    packageManager: "npm",
    kvStore: "in-memory",
    messageQueue: "in-process",
    webFramework: "nitro",
    testMode: false,
    dryRun: true,
  });

  ok(files);
  ok("server/plugins/logging.ts" in files);
  const plugin = files["server/plugins/logging.ts"];
  ok(plugin);
  ok(plugin.includes('import "../logging";'));
});

test("Next.js template loads LogTape through instrumentation", async () => {
  const { files } = await webFrameworks.next.init({
    projectName: "test-app",
    dir: ".",
    command: "init",
    packageManager: "npm",
    kvStore: "in-memory",
    messageQueue: "in-process",
    webFramework: "next",
    testMode: false,
    dryRun: true,
  });

  ok(files);
  ok("instrumentation.ts" in files);
  const instrumentation = files["instrumentation.ts"];
  ok(instrumentation);
  ok(instrumentation.includes("export async function register()"));
  ok(instrumentation.includes("NEXT_RUNTIME"));
  ok(instrumentation.includes('await import("./logging")'));
});
