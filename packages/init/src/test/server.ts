import spawn from "cross-spawn";
import { type ChildProcess, execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join as joinPath } from "node:path";
import process from "node:process";
import { finished } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { printErrorMessage } from "../utils.ts";
import { TestInterruptedError } from "./cancel.ts";
import { ensurePortReleased } from "./port.ts";

export const STARTUP_TIMEOUT = 10000;

/** Wait for the generated application to respond successfully. */
export async function waitForServer(
  url: string,
  timeout: number = STARTUP_TIMEOUT,
  signal?: AbortSignal,
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    signal?.throwIfAborted();
    try {
      const timeoutSignal = AbortSignal.timeout(1000);
      const response = await fetch(url, {
        signal: signal == null
          ? timeoutSignal
          : AbortSignal.any([signal, timeoutSignal]),
      });
      const ok = response.ok;
      await response.body?.cancel();
      if (ok) return true;
    } catch {
      // The application may still be starting.
    }
    await delay(500, undefined, { signal });
  }
  return false;
}

/** Run a generated application's server and always stop its process tree. */
export async function serverClosure<T>(
  dir: string,
  cmd: string | readonly string[],
  defaultPort: number,
  callback: (port: number, signal: AbortSignal) => Promise<T>,
  releasePort?: () => Promise<void>,
  signal?: AbortSignal,
): Promise<Awaited<T>> {
  await releasePort?.();
  signal?.throwIfAborted();
  const command = typeof cmd === "string" ? cmd.split(" ") : cmd;
  const child: ChildProcess = spawn(command[0], [...command.slice(1)], {
    cwd: dir,
    env: { ...process.env, PORT: String(defaultPort) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const outFile = createWriteStream(joinPath(dir, "out.txt"), { flags: "a" });
  const errFile = createWriteStream(joinPath(dir, "err.txt"), { flags: "a" });
  const filesDone = Promise.all([finished(outFile), finished(errFile)]);
  // Install a handler immediately, including while waiting for the port.
  void filesDone.catch(() => {});
  child.stdout!.pipe(outFile, { end: false });
  child.stderr!.pipe(errFile, { end: false });

  let rejectFailure: (error: Error) => void;
  const failure = new Promise<never>((_, reject) => rejectFailure = reject);
  void failure.catch(() => {});
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve())
  );
  child.once("error", (error) => rejectFailure(error));
  child.once("exit", (code, exitSignal) => {
    rejectFailure(new Error(`Server exited (${exitSignal ?? code})`));
  });
  outFile.once("error", (error) => rejectFailure(error));
  errFile.once("error", (error) => rejectFailure(error));
  const onAbort = () =>
    rejectFailure(
      signal?.reason instanceof Error
        ? signal.reason
        : new Error("Server test aborted"),
    );
  const onInterrupt = () => rejectFailure(new TestInterruptedError("SIGINT"));
  const onTerminate = () => rejectFailure(new TestInterruptedError("SIGTERM"));
  signal?.addEventListener("abort", onAbort, { once: true });
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  if (signal?.aborted) onAbort();

  let port = defaultPort;
  const detection = detectPort(child);
  let operationError: unknown;
  let failed = false;
  let result: Awaited<T>;
  const shutdown = new AbortController();
  try {
    port = await Promise.race([
      detection.result.catch((error) => {
        printErrorMessage`Failed to determine server port: ${error.message}`;
        printErrorMessage`Use default port ${String(defaultPort)} for lookup.`;
        return defaultPort;
      }),
      failure,
    ]);
    result = await Promise.race([callback(port, shutdown.signal), failure]);
  } catch (error) {
    operationError = error;
    failed = true;
  } finally {
    shutdown.abort(new Error("Server test finished"));
    detection.stop();
    signal?.removeEventListener("abort", onAbort);
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
    try {
      await stopProcessTree(child, closed);
    } catch (error) {
      if (!failed) operationError = error;
      failed = true;
      printErrorMessage`Failed to stop server: ${String(error)}`;
    } finally {
      child.stdout!.destroy();
      child.stderr!.destroy();
      outFile.end();
      errFile.end();
    }
    try {
      await filesDone;
      if (child.pid != null) await ensurePortReleased(port);
    } catch (error) {
      if (!failed) operationError = error;
      failed = true;
      printErrorMessage`Failed to clean up server: ${String(error)}`;
    }
  }
  if (failed) throw operationError;
  return result!;
}

function detectPort(
  child: ChildProcess,
): { result: Promise<number>; stop: () => void } {
  let output = "";
  let timer: ReturnType<typeof setTimeout>;
  let onData: (chunk: Buffer) => void;
  const stop = () => {
    clearTimeout(timer);
    child.stdout!.removeListener("data", onData);
    child.stderr!.removeListener("data", onData);
  };
  const result = new Promise<number>((resolve, reject) => {
    timer = setTimeout(() => {
      stop();
      reject(new Error("Timeout: Could not determine port from server output"));
    }, STARTUP_TIMEOUT);
    onData = (chunk) => {
      output += chunk.toString("utf8");
      const patterns = [
        /listening on.*:(\d+)/i,
        /server.*:(\d+)/i,
        /port\s*:?\s*(\d+)/i,
        /https?:\/\/[^:]+:(\d+)/i,
      ];
      for (const pattern of patterns) {
        const match = pattern.exec(output);
        const port = Number(match?.[1]);
        if (port > 0 && port < 65536) {
          stop();
          resolve(port);
          break;
        }
      }
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
  });
  return { result, stop };
}

async function stopProcessTree(
  child: ChildProcess,
  closed: Promise<void>,
): Promise<void> {
  if (child.pid == null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      execFile(
        "taskkill",
        ["/pid", String(child.pid), "/t", "/f"],
        { timeout: 1000, windowsHide: true },
        () => resolve(),
      );
    });
  } else {
    const kill = (signal: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };
    kill("SIGTERM");
    await Promise.race([closed, delay(1000)]);
    // The launcher may exit while a descendant keeps inherited pipes open.
    kill("SIGKILL");
  }
  child.kill("SIGKILL");
  await Promise.race([closed, delay(1000)]);
}
