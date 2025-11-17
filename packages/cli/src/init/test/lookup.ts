import { isEmpty } from "@fxts/core/index.js";
import { values } from "@optique/core";
import type { ChildProcessByStdio } from "node:child_process";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join, sep } from "node:path";
import process from "node:process";
import type Stream from "node:stream";
import { printErrorMessage, printMessage, runSubCommand } from "../../utils.ts";
import { getDevCommand } from "../lib.ts";
import type {
  KvStore,
  MessageQueue,
  PackageManager,
  WebFramework,
} from "../types.ts";
import webFrameworks from "../webframeworks.ts";

const HANDLE = "john";
const STARTUP_TIMEOUT = 30000; // 30 seconds
const CWD = process.cwd();
const BANNED_WFS: WebFramework[] = ["next"];

/**
 * Run servers for all generated apps and test them with the lookup command.
 *
 * @param dirs - Array of paths to generated app directories
 */
export default async function runServerAndLookupUser(
  dirs: string[],
): Promise<void> {
  const valid = dirs.filter(Boolean);
  if (valid.length === 0) {
    printErrorMessage`\nNo directories to lookup test.`;
    return;
  }
  const filtered = filterWebFrameworks(valid);

  printMessage`\nLookup Test start for ${String(filtered.length)} app(s)!`;

  const results = await Array.fromAsync(filtered, testApp);

  const successCount = results.filter(Boolean).length;
  const failCount = results.length - successCount;

  printMessage`Lookup Test Results:
  Total: ${String(results.length)}
  Passed: ${String(successCount)}
  Failed: ${String(failCount)}\n\n`;
}

function filterWebFrameworks(
  dirs: string[],
): string[] {
  const wfs = new Set<WebFramework>(
    dirs.map((dir) => dir.split(sep).slice(-4, -3)[0] as WebFramework),
  );
  const hasBanned = BANNED_WFS.filter((wf) => wfs.has(wf));
  if (isEmpty(hasBanned)) {
    return dirs;
  }
  const bannedLabels = hasBanned.map((wf) => webFrameworks[wf]["label"]);
  printErrorMessage`\n${
    values(bannedLabels)
  } is not supported in lookup test yet.`;
  return dirs.filter((dir) =>
    !BANNED_WFS.includes(dir.split(sep).slice(-4, -3)[0] as WebFramework)
  );
}

/**
 * Run the dev server and test with lookup command.
 */
async function testApp(dir: string): Promise<boolean> {
  const [wf, pm, kv, mq] = dir.split(sep).slice(-4) as //
  [WebFramework, PackageManager, KvStore, MessageQueue];

  printMessage`  Testing ${values([wf, pm, kv, mq])}...`;

  const result = await serverClosure(
    dir,
    getDevCommand(pm),
    sendLookup,
  );

  printMessage`    Lookup ${result ? "successful" : "failed"} for ${
    values([wf, pm, kv, mq])
  }!`;
  if (!result) {
    printMessage`    Check out these files for more details:
      ${join(dir, "out.txt")} and 
      ${join(dir, "err.txt")}\n`;
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
    await runSubCommand(
      ["deno", "task", "cli", "lookup", lookupTarget],
      { cwd: CWD },
    );

    return true;
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
      if (response.ok) {
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
  callback: (port: number) => Promise<T>,
): Promise<Awaited<T>> {
  // Start the dev server using Node.js spawn
  const devCommand = cmd.split(" ");
  const serverProcess = spawn(devCommand[0], devCommand.slice(1), {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // Create a new process group
  });

  // Append stdout and stderr to files
  const stdout = createWriteStream(join(dir, "out.txt"), { flags: "a" });
  const stderr = createWriteStream(join(dir, "err.txt"), { flags: "a" });

  serverProcess.stdout?.pipe(stdout);
  serverProcess.stderr?.pipe(stderr);

  try {
    const port = await determinePort(serverProcess);
    return await callback(port);
  } finally {
    try {
      process.kill(-serverProcess.pid!, "SIGKILL");
    } catch {
      serverProcess.kill("SIGKILL");

      // Close file streams
      stdout.end();
      stderr.end();
    }
  }
}

function determinePort(
  server: ChildProcessByStdio<null, Stream.Readable, Stream.Readable>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error("Timeout: Could not determine port from server output"),
      );
    }, STARTUP_TIMEOUT);

    let stdoutData = "";
    let stderrData = "";

    // Common patterns for port detection
    const portPatterns = [
      /listening on.*:(\d+)/i,
      /server.*:(\d+)/i,
      /port\s*:?\s*(\d+)/i,
      /https?:localhost:(\d+)/i,
      /https?:0\.0\.0\.0:(\d+)/i,
      /https?:127\.0\.0\.1:(\d+)/i,
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

    server.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString();
      const port = checkForPort(stdoutData);
      if (port) resolve(port);
    });

    server.stderr.on("data", (chunk) => {
      stderrData += chunk.toString();
      const port = checkForPort(stderrData);
      if (port) resolve(port);
    });

    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    server.on("exit", (code) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Server exited with code ${code} before port could be determined`,
        ),
      );
    });
  });
}
