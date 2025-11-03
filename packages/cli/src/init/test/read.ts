import { spawn } from "node:child_process";
import { sep } from "node:path";
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

/**
 * Wait for the server to be ready by checking if it responds to requests.
 */
async function waitForServer(
  url: string,
  timeout: number,
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1000),
      });
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

/**
 * Run the dev server and test with lookup command.
 */
async function testApp(dir: string, originalCwd: string): Promise<boolean> {
  const [wf, pm] = dir.split(sep).slice(-4) as [
    WebFramework,
    PackageManager,
    KvStore,
    MessageQueue,
  ];

  if (!pm) {
    printErrorMessage`Could not infer package manager for ${dir}`;
    return false;
  }

  printMessage`Testing ${dir}...`;

  const devCommand = getDevCommand(pm).split(" ");
  const port = webFrameworks[wf]?.defaultPort;
  const serverUrl = `http://localhost:${port}`;
  const lookupTarget = `${serverUrl}/users/${HANDLE}`;

  // Start the dev server using Node.js spawn
  const serverProcess = spawn(devCommand[0], devCommand.slice(1), {
    cwd: dir,
    stdio: ["ignore", "inherit", "inherit"],
  });

  try {
    // Wait for server to be ready
    printMessage`Waiting for server to start at ${serverUrl}...`;
    const isReady = await waitForServer(serverUrl, STARTUP_TIMEOUT);

    if (!isReady) {
      printErrorMessage`Server did not start within ${
        String(STARTUP_TIMEOUT)
      }ms`;
      return false;
    }

    printMessage`Server is ready. Running lookup command...`;

    // Run lookup command from original directory
    try {
      await runSubCommand(
        ["deno", "task", "cli", "lookup", lookupTarget],
        {
          cwd: originalCwd,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      printMessage`Lookup successful for ${dir}`;
      return true;
    } catch (error) {
      printErrorMessage`Lookup failed for ${dir}`;
      if (error instanceof Error) {
        printErrorMessage`Error: ${error.message}`;
      }
      return false;
    }
  } finally {
    // Clean up: kill the server process
    serverProcess.kill("SIGTERM");
  }
}

/**
 * Run servers for all generated apps and test them with the lookup command.
 *
 * @param dirs - Array of paths to generated app directories
 */
export async function runServerAndReadUser(
  dirs: string[],
): Promise<void> {
  const originalCwd = process.cwd();

  printMessage`Testing ${String(dirs.length)} app(s)...`;

  const results = await Array.fromAsync(
    dirs,
    (dir) => testApp(dir, originalCwd),
  );

  const successCount = results.filter(Boolean).length;
  const failCount = results.length - successCount;

  printMessage`
Test Results:
  Total: ${String(results.length)}
  Passed: ${String(successCount)}
  Failed: ${String(failCount)}`;
}
