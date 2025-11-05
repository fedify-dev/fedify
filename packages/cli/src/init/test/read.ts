import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join, sep } from "node:path";
import process from "node:process";
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

/**
 * Run servers for all generated apps and test them with the lookup command.
 *
 * @param dirs - Array of paths to generated app directories
 */
export default async function runServerAndReadUser(
  dirs: string[],
): Promise<void> {
  printMessage`Testing ${String(dirs.length)} app(s)...`;

  const results = await Array.fromAsync(dirs, testApp);

  const successCount = results.filter(Boolean).length;
  const failCount = results.length - successCount;

  printMessage`Test Results:
  Total: ${String(results.length)}
  Passed: ${String(successCount)}
  Failed: ${String(failCount)}`;
}

/**
 * Run the dev server and test with lookup command.
 */
async function testApp(dir: string): Promise<boolean> {
  const [wf, pm] = dir.split(sep).slice(-4) as //
  [WebFramework, PackageManager, KvStore, MessageQueue];

  printMessage`Testing ${dir}...`;

  const devCommand = getDevCommand(pm);
  const port = webFrameworks[wf].defaultPort;
  const result = await serverClosure(dir, devCommand, sendLookup(port));

  printMessage`Lookup ${result ? "successful" : "failed"} for ${dir}`;

  return result;
}

const sendLookup = (port: number) => async () => {
  const serverUrl = `http://localhost:${port}`;
  const lookupTarget = `${serverUrl}/users/${HANDLE}`;
  // Wait for server to be ready
  printMessage`Waiting for server to start at ${serverUrl}...`;
  const isReady = await waitForServer(serverUrl, STARTUP_TIMEOUT);

  if (!isReady) {
    printErrorMessage`Server did not start within ${String(STARTUP_TIMEOUT)}ms`;
    return false;
  }

  printMessage`Server is ready. Running lookup command...`;

  // Run lookup command from original directory
  try {
    await runSubCommand(
      ["deno", "task", "cli", "lookup", lookupTarget],
      { cwd: CWD },
    );

    return true;
  } catch (error) {
    if (error instanceof Error) {
      printErrorMessage`Error: ${error.message}`;
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
  callback: () => Promise<T>,
): Promise<Awaited<T>> {
  // Start the dev server using Node.js spawn
  const devCommand = cmd.split(" ");
  const serverProcess = spawn(devCommand[0], devCommand.slice(1), {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Append stdout and stderr to files
  const outStream = createWriteStream(join(dir, "out.txt"), { flags: "a" });
  const errStream = createWriteStream(join(dir, "err.txt"), { flags: "a" });

  serverProcess.stdout?.pipe(outStream);
  serverProcess.stderr?.pipe(errStream);

  try {
    return await callback();
  } finally {
    // Clean up: kill the server process
    serverProcess.kill("SIGTERM");

    // Close file streams
    outStream.end();
    errStream.end();
  }
}
