import $ from "@david/dax";
import { join } from "@fxts/core";
import { values } from "@optique/core";
import { join as joinPath, sep } from "node:path";
import {
  getDevCommand,
  kvStores,
  messageQueues,
  packageManagers,
} from "../lib.ts";
import type {
  KvStore,
  MessageQueue,
  PackageManager,
  WebFramework,
} from "../types.ts";
import { printErrorMessage, printMessage } from "../utils.ts";
import webFrameworks from "../webframeworks/mod.ts";
import { findFreePort, replacePortInApp } from "./port.ts";
import { serverClosure, STARTUP_TIMEOUT, waitForServer } from "./server.ts";

const HANDLE = "john";
const BASE_PORT = 10000;
type LookupCase = [WebFramework, PackageManager, KvStore, MessageQueue];
type LookupCasePattern = [
  WebFramework | "*",
  PackageManager | "*",
  KvStore | "*",
  MessageQueue | "*",
];
const BANNED_LOOKUP_REASONS: Record<string, string> = {
  "next,*,*,*": "Next.js doesn't support remote packages",
  "solidstart,deno,*,*": "Error occurred while loading submodules in Deno",
  "astro,deno,*,*": "Astro doesn't support remote packages in Deno",
};
const BANNED_LOOKUP_CASES: LookupCasePattern[] = Object.keys(
  BANNED_LOOKUP_REASONS,
)
  .map((key) => key.split(",") as LookupCasePattern);

/**
 * Run servers for all generated apps and test them with the lookup command.
 *
 * @param dirs - Array of paths to generated app directories
 */
export default async function runServerAndLookupUser(
  dirs: string[],
): Promise<void> {
  const valid = dirs.filter(Boolean).filter(isTestable);
  printSkippedCases(dirs);

  if (valid.length === 0) {
    printErrorMessage`\nNo directories to lookup test.`;
  }

  printMessage``;
  printMessage`Lookup Test start for ${String(valid.length)} app(s)!`;

  const results = await Array.fromAsync(valid, testApp);

  const successCount = results.filter(Boolean).length;
  const failCount = results.length - successCount;

  printMessage`Lookup Test Results:
  Total: ${String(results.length)}
  Passed: ${String(successCount)}
  Failed: ${String(failCount)}\n\n`;

  printFailedCases(valid, results);
}

export const parseLookupCase = (dir: string): LookupCase =>
  dir.split(sep).slice(-4) as LookupCase;

export const matchesLookupCasePattern =
  (target: LookupCase) => (pattern: LookupCasePattern): boolean =>
    pattern.every((value, index) => value === "*" || value === target[index]);

export const isTestable = (dir: string): boolean =>
  !BANNED_LOOKUP_CASES.some(matchesLookupCasePattern(parseLookupCase(dir)));

function printSkippedCases(dirs: string[]): void {
  const matchedPatterns = new Set<string>(
    dirs.filter(Boolean).flatMap((dir) =>
      BANNED_LOOKUP_CASES
        .filter(matchesLookupCasePattern(parseLookupCase(dir)))
        .map(join(","))
    ),
  );
  if (matchedPatterns.size > 0) {
    printMessage``;
    printMessage`Skipped the following lookup cases due to known issues:`;
  }
  for (const key of matchedPatterns) {
    const reason = BANNED_LOOKUP_REASONS[key] ?? "unknown reason";
    const labels = Array.from(getLabels(key.split(",") as LookupCasePattern));
    printMessage`  - ${values(labels)}: ${reason}`;
  }
}

function* getLabels([wf, pm, kv, mq]: LookupCasePattern): Generator<string> {
  if (wf !== "*") yield webFrameworks[wf].label;
  if (pm !== "*") yield packageManagers[pm].label;
  if (kv !== "*") yield kvStores[kv].label;
  if (mq !== "*") yield messageQueues[mq].label;
}

function printFailedCases(valid: string[], results: boolean[]): void {
  if (results.every(Boolean)) return;
  printMessage`Failed cases:`;
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      const dir = valid[i];
      const label = values(parseLookupCase(dir));
      printMessage`  - ${label}: ${dir}`;
    }
  }
}

/**
 * Run the dev server and test with lookup command.
 */
async function testApp(dir: string, index: number): Promise<boolean> {
  const [wf, pm, kv, mq] = parseLookupCase(dir);

  printMessage`  Testing ${values([wf, pm, kv, mq])}...`;

  const defaultPort = webFrameworks[wf].defaultPort;
  const assignedPort = await findFreePort(BASE_PORT + index);
  await replacePortInApp(dir, wf, defaultPort, assignedPort);
  printMessage`    Using port ${String(assignedPort)}`;

  const result = await serverClosure(
    dir,
    getDevCommand(pm),
    assignedPort,
    sendLookup,
  ).catch(() => false);

  printMessage`    Lookup ${result ? "successful" : "failed"} for ${
    values([wf, pm, kv, mq])
  }!`;
  if (!result) {
    printMessage`    Check out these files for more details: \
${joinPath(dir, "out.txt")} and \
${joinPath(dir, "err.txt")}\n`;
  }
  printMessage`\n`;

  return result;
}

async function sendLookup(port: number): Promise<boolean> {
  const serverUrl = `http://localhost:${port}`;
  const lookupTarget = `${serverUrl}/users/${HANDLE}`;
  // Wait for server to be ready
  printMessage`    Waiting for server to start at ${serverUrl}...`;

  const isReady = await waitForServer(serverUrl);

  if (!isReady) {
    printErrorMessage`Server did not start within ${String(STARTUP_TIMEOUT)}ms`;
    return false;
  }

  printMessage`    Server is ready. Running lookup command...`;

  // Run lookup command from original directory
  try {
    const res = await $`deno task cli lookup ${lookupTarget} -p`
      .stdin("null")
      .stdout("piped")
      .stderr("piped")
      .noThrow()
      .spawn();

    return res.stdout.includes(`id: URL '${lookupTarget}',`);
  } catch (error) {
    if (error instanceof Error) {
      printErrorMessage`${error.message}`;
    }
  }
  return false;
}
