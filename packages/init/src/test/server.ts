import $ from "@david/dax";
import { createWriteStream, type WriteStream } from "node:fs";
import { join as joinPath } from "node:path";
import { printErrorMessage } from "../utils.ts";
import { ensurePortReleased, killProcessOnPort } from "./port.ts";

export const STARTUP_TIMEOUT = 10000; // 30 seconds

/**
 * Wait for the server to be ready by checking if it responds to requests.
 */
export async function waitForServer(
  url: string,
  timeout: number = STARTUP_TIMEOUT,
): Promise<boolean> {
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

export async function serverClosure<T>(
  dir: string,
  cmd: string,
  defaultPort: number,
  callback: (port: number) => Promise<T>,
  releasePort?: () => Promise<void>,
): Promise<Awaited<T>> {
  // Release the reserved socket right before spawning so the child can bind
  await releasePort?.();

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
