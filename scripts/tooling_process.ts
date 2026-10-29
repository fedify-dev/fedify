// @ts-types="npm:@types/cross-spawn@^6.0.6"
import spawn from "cross-spawn";
import { type ChildProcess, execFile } from "node:child_process";
import process from "node:process";
import { constants } from "node:os";
import { Readable } from "node:stream";

interface CommandOptions {
  cwd?: string;
  cleanup?: boolean;
  env?: Record<string, string>;
}

interface CommandStatus {
  code: number;
  success: boolean;
}

export interface ToolingProcess {
  child: ChildProcess;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  status: Promise<CommandStatus>;
  stop(): Promise<void>;
}

const active = new Set<ToolingProcess>();
const cleanups = new Set<() => Promise<void>>();
let stopping = false;

function onSignal(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  process.exitCode = signal === "SIGINT" ? 130 : 143;
  void Promise.allSettled([
    ...[...active].map((child) => child.stop()),
    ...[...cleanups].map((cleanup) => cleanup()),
  ]).then(() => {
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

const onSigint = () => onSignal("SIGINT");
const onSigterm = () => onSignal("SIGTERM");

/** Spawn a tooling command with inherited environment and owned process tree. */
export function startCommand(
  command: string,
  args: string[],
  options: CommandOptions = {},
): ToolingProcess {
  // cross-spawn handles Windows command shims without exposing arguments to an
  // unescaped shell. Executable commands still use Node's normal spawn path.
  const child: ChildProcess = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const status = new Promise<CommandStatus>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const exitCode = code ??
        (signal == null ? 1 : 128 + constants.signals[signal]);
      resolve({ code: exitCode, success: exitCode === 0 });
    });
  });
  // Callers may consume output before awaiting status; an early spawn failure
  // must not become an unhandled rejection in the meantime.
  void status.catch(() => {});
  let stopPromise: Promise<void> | undefined;
  const handle: ToolingProcess = {
    child,
    stdout: Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    stderr: Readable.toWeb(child.stderr!) as ReadableStream<Uint8Array>,
    status,
    stop() {
      return stopPromise ??= stopTree(child, status);
    },
  };
  if (!options.cleanup) {
    if (active.size === 0 && cleanups.size === 0) {
      process.on("SIGINT", onSigint);
      process.on("SIGTERM", onSigterm);
    }
    active.add(handle);
  }
  void status.finally(() => {
    active.delete(handle);
    if (active.size === 0 && cleanups.size === 0) {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    }
  }).catch(() => {});
  return handle;
}

async function stopTree(
  child: ChildProcess,
  status: Promise<CommandStatus>,
): Promise<void> {
  if (child.pid == null) {
    await status.catch(() => {});
    return;
  }
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], () => {
        child.kill("SIGKILL");
        resolve();
      });
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
    // A parent can exit while a descendant retains the output pipes. Wait for
    // close, not exit, before deciding the whole command has finished.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        status.catch(() => {}),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1_000);
        }),
      ]);
    } finally {
      if (timer != null) clearTimeout(timer);
    }
    // Kill remaining group members even if the original parent has exited.
    kill("SIGKILL");
  }
  await status.catch(() => {});
}

/** Collect both streams before returning the command's exit status. */
export async function commandOutput(
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<CommandStatus & { stdout: Uint8Array; stderr: Uint8Array }> {
  const child = startCommand(command, args, options);
  const [status, stdout, stderr] = await Promise.all([
    child.status,
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).arrayBuffer(),
  ]);
  return {
    ...status,
    stdout: new Uint8Array(stdout),
    stderr: new Uint8Array(stderr),
  };
}

/** Include non-process resources in SIGINT/SIGTERM cleanup. */
export function registerCleanup(cleanup: () => Promise<void>): () => void {
  if (active.size === 0 && cleanups.size === 0) {
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
  }
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
    if (active.size === 0 && cleanups.size === 0) {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    }
  };
}
