import $ from "@david/dax";
import { join } from "@fxts/core";
import { values } from "@optique/core";
import { createWriteStream, type WriteStream } from "node:fs";
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
import {
  ensurePortReleased,
  findFreePort,
  killProcessOnPort,
  replacePortInApp,
} from "./port.ts";

const HANDLE = "john";
const STARTUP_TIMEOUT = 30000; // 30 seconds
const CWD = join(import.meta.dirname!, "..");
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
  "solidstart,deno,*,*": "SolidStart on Deno is not supported for now",
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

const sendLookup = async (port: number) => {
  const serverUrl = `http://localhost:${port}`;
  const lookupTarget = `${serverUrl}/users/${HANDLE}`;
  // Wait for server to be ready
  printMessage`    Waiting for server to start at ${serverUrl}...`;

  const isReady = await waitForServer(serverUrl, STARTUP_TIMEOUT);

  if (!isReady) {
    printErrorMessage`Server did not start within \
${String(STARTUP_TIMEOUT)}ms`;
    return false;
  }

  printMessage`    Server is ready. Running lookup command...`;

  // Run lookup command from original directory
  try {
    const res = await $`deno task cli lookup ${lookupTarget} -p`
      .cwd(CWD)
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
};

/**
 * Wait for the server to be ready by checking if it responds to requests.
 */
async function waitForServer(url: string, timeout: number): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      const ok = response.ok;
      await response.body?.cancel();
      if (ok) {
        return true;
      }
    } catch {
      // Server not ready yet, continue waiting
    }

    // Wait 500ms before next attempt
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

async function serverClosure<T>(
  dir: string,
  cmd: string,
  defaultPort: number,
  callback: (port: number) => Promise<T>,
): Promise<Awaited<T>> {
  const devCommand = cmd.split(" ");
  const serverProcess = $`${devCommand}`
    .cwd(dir)
    .env("PORT", String(defaultPort))
    .stdin("null")
    .stdout("piped")
    .stderr("piped")
    .noThrow()
    .spawn();

  // Prevent unhandled rejection when the process is killed
  serverProcess.catch(() => {});

  const [stdoutForFile, stdoutForPort] = serverProcess.stdout().tee();
  const [stderrForFile, stderrForPort] = serverProcess.stderr().tee();

  // Shared signal to cancel all background stream readers on cleanup
  const cleanup = new AbortController();

  // Append stdout and stderr to files
  const outFile = createWriteStream(joinPath(dir, "out.txt"), { flags: "a" });
  const errFile = createWriteStream(joinPath(dir, "err.txt"), { flags: "a" });
  const pipeOutDone = pipeStream(stdoutForFile, outFile, cleanup.signal);
  const pipeErrDone = pipeStream(stderrForFile, errFile, cleanup.signal);

  let port = defaultPort;
  try {
    port = await determinePort(
      stdoutForPort,
      stderrForPort,
      cleanup.signal,
    ).catch((err) => {
      printErrorMessage`Failed to determine server port: ${err.message}`;
      printErrorMessage`Use default port ${String(defaultPort)} for lookup.`;
      return defaultPort;
    });
    return await callback(port);
  } finally {
    try {
      serverProcess.kill("SIGKILL");
    } catch {
      // Process already exited
    }

    // Cancel all background stream readers
    cleanup.abort();
    await Promise.all([pipeOutDone, pipeErrDone]).catch(() => {});

    // Kill any remaining child processes still listening on the port
    await killProcessOnPort(port);

    // Close file streams
    outFile.end();
    errFile.end();

    // Ensure port is released before next test
    await ensurePortReleased(port);
  }
}

function determinePort(
  stdout: ReadableStream<Uint8Array>,
  stderr: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error("Timeout: Could not determine port from server output"),
      );
    }, STARTUP_TIMEOUT);

    let stdoutData = "";
    let stderrData = "";
    let streamsEnded = 0;

    // Common patterns for port detection
    const portPatterns = [
      /listening on.*:(\d+)/i,
      /server.*:(\d+)/i,
      /port\s*:?\s*(\d+)/i,
      /https?:\/\/localhost:(\d+)/i,
      /https?:\/\/0\.0\.0\.0:(\d+)/i,
      /https?:\/\/127\.0\.0\.1:(\d+)/i,
      /https?:\/\/[^:]+:(\d+)/i,
    ];

    const checkForPort = (data: string) => {
      for (const pattern of portPatterns) {
        const match = data.match(pattern);
        if (match && match[1]) {
          const port = Number.parseInt(match[1], 10);
          if (port > 0 && port < 65536) {
            clearTimeout(timeout);
            return port;
          }
        }
      }
      return null;
    };

    const onStreamEnd = () => {
      streamsEnded++;
      if (streamsEnded === 2) {
        clearTimeout(timeout);
        reject(
          new Error("Server exited before port could be determined"),
        );
      }
    };

    const readStream = async (
      stream: ReadableStream<Uint8Array>,
      onData: (chunk: string) => void,
    ) => {
      const reader = stream.getReader();
      const onAbort = () => void reader.cancel().catch(() => {});
      signal?.addEventListener("abort", onAbort, { once: true });
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          onData(decoder.decode(value, { stream: true }));
        }
      } catch {
        // Stream may be cancelled when process is killed
      } finally {
        signal?.removeEventListener("abort", onAbort);
        reader.releaseLock();
        onStreamEnd();
      }
    };

    void readStream(stdout, (chunk) => {
      stdoutData += chunk;
      const port = checkForPort(stdoutData);
      if (port) resolve(port);
    });

    void readStream(stderr, (chunk) => {
      stderrData += chunk;
      const port = checkForPort(stderrData);
      if (port) resolve(port);
    });
  });
}

async function pipeStream(
  readable: ReadableStream<Uint8Array>,
  writable: WriteStream,
  signal?: AbortSignal,
): Promise<void> {
  const reader = readable.getReader();
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writable.write(value);
    }
  } catch {
    // Stream may be cancelled when process is killed
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
