/**
 * Test runner for Fedify example projects.
 *
 * For server-based examples, starts the server, creates a public tunnel with
 * `fedify tunnel` (via `deno task cli tunnel`), and verifies federation is
 * working via `fedify lookup`.  For script-based examples, runs them directly
 * and checks the exit code.
 *
 * Usage (from repository root):
 *   deno run --allow-all examples/test-examples/mod.ts [options] [examples...]
 *
 * Options:
 *   --timeout MS   Server readiness timeout in ms (default: 10000)
 *   --debug        Enable debug-level logging via @logtape/logtape
 *
 * If example names are provided as positional arguments, only those examples
 * are tested.  Otherwise all examples are tested.
 *
 * Example:
 *   deno run --allow-all examples/test-examples/mod.ts express koa
 *   deno run --allow-all examples/test-examples/mod.ts --debug hono-sample
 */

import { configure, getConsoleSink, getLogger } from "@logtape/logtape";
import { join } from "@std/path";

// ─── Paths ────────────────────────────────────────────────────────────────────

const EXAMPLES_DIR = new URL("../", import.meta.url).pathname;
const REPO_ROOT = new URL("../../", import.meta.url).pathname;

// ─── Logging ──────────────────────────────────────────────────────────────────
//
// We configure logtape before everything else so that log calls in helpers
// work even if they execute at module-initialization time.
//
// All test-runner logs live under the ["fedify", "examples"] category.
// Library-internal fedify logs are intentionally excluded so they don't flood
// the output.  Pass --debug to lower the level from "info" to "debug".

const debugMode = Deno.args.includes("--debug") || Deno.args.includes("-d");

await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [
    {
      category: ["fedify", "examples"],
      lowestLevel: debugMode ? "debug" : "info",
      sinks: ["console"],
      filters: [],
    },
    {
      // Suppress logtape's own meta-logs unless something is wrong.
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
      filters: [],
    },
  ],
});

const logger = getLogger(["fedify", "examples", "test-runner"]);

// ─── Types ────────────────────────────────────────────────────────────────────

/** An example that starts a long-running HTTP server. */
interface ServerExample {
  name: string;
  /** Directory name inside examples/ */
  dir: string;
  /** Optional build command to run before starting the server */
  buildCmd?: string[];
  /** Working directory for buildCmd (defaults to the example directory) */
  buildCwd?: string;
  /** Command to start the server */
  startCmd: string[];
  /** Working directory for startCmd (defaults to the example directory) */
  startCwd?: string;
  /** Port the server listens on */
  port: number;
  /** ActivityPub actor username to look up via WebFinger */
  actor: string;
  /** URL to poll until the server responds (any HTTP status counts as ready) */
  readyUrl: string;
  /** Override the global ready-timeout (ms) for this example */
  readyTimeout?: number;
  /** Extra environment variables injected into the server process */
  env?: Record<string, string>;
}

/** An example that is a standalone script (not a server). */
interface ScriptExample {
  name: string;
  dir: string;
  cmd: string[];
  description: string;
}

/**
 * A script example that accepts an ActivityPub handle as its last argument.
 * Each handle in `handles` is tried in order; the test passes as soon as any
 * one of them exits with code 0.
 */
interface MultiHandleExample {
  name: string;
  dir: string;
  /** Command prefix — the handle is appended as the final argument. */
  cmd: string[];
  /** Handles to try, in order.  Pass if any succeeds. */
  handles: string[];
  description: string;
}

/** An example that is intentionally not tested automatically. */
interface SkippedExample {
  name: string;
  reason: string;
}

type TestResult =
  | { name: string; status: "pass"; output: string }
  | { name: string; status: "fail"; error: string; output: string }
  | { name: string; status: "skip"; reason: string };

// ─── Example Registry ─────────────────────────────────────────────────────────

const SERVER_EXAMPLES: ServerExample[] = [
  {
    // Deno-native Hono server; actor path is /{identifier} but only "sample"
    // is registered.
    name: "hono-sample",
    dir: "hono-sample",
    startCmd: ["deno", "run", "--allow-all", "main.ts"],
    port: 8000,
    actor: "sample",
    readyUrl: "http://localhost:8000/",
  },
  {
    // h3 server exported as a Fetch handler; run with `deno serve`.
    // Executed from the repo root so Deno workspace imports resolve correctly.
    name: "h3",
    dir: "h3",
    startCmd: [
      "deno",
      "serve",
      "--allow-all",
      "--port",
      "8000",
      "examples/h3/index.ts",
    ],
    startCwd: REPO_ROOT,
    port: 8000,
    actor: "demo",
    readyUrl: "http://localhost:8000/",
  },
  {
    // Express server; app.ts reads process.env.PORT (default 8000).
    name: "express",
    dir: "express",
    startCmd: ["pnpm", "start"],
    port: 8000,
    actor: "demo",
    readyUrl: "http://localhost:8000/",
  },
  {
    // Fastify server; actor path is /users/{identifier}.
    name: "fastify",
    dir: "fastify",
    startCmd: ["pnpm", "start"],
    port: 3000,
    actor: "demo",
    readyUrl: "http://localhost:3000/",
  },
  {
    // Koa server; actor path is /users/{identifier}.
    name: "koa",
    dir: "koa",
    startCmd: ["pnpm", "start"],
    port: 3000,
    actor: "demo",
    readyUrl: "http://localhost:3000/",
  },
  {
    // Elysia/Bun server; actor path is /{identifier} but only "sample" works.
    name: "elysia",
    dir: "elysia",
    startCmd: ["bun", "run", "app.ts"],
    port: 3000,
    actor: "sample",
    readyUrl: "http://localhost:3000/",
  },
  {
    // Next.js 14 app router; actor path is /users/{identifier}.
    // Requires a build step before starting.
    name: "next14-app-router",
    dir: "next14-app-router",
    buildCmd: ["pnpm", "build"],
    startCmd: ["pnpm", "start"],
    port: 3000,
    actor: "demo",
    readyUrl: "http://localhost:3000/",
    readyTimeout: 30_000,
  },
  {
    // Next.js 15 app router; actor path is /users/{identifier}.
    // Requires a build step before starting.
    name: "next15-app-router",
    dir: "next15-app-router",
    buildCmd: ["pnpm", "build"],
    startCmd: ["pnpm", "start"],
    port: 3000,
    actor: "demo",
    readyUrl: "http://localhost:3000/",
    readyTimeout: 30_000,
  },
  {
    // Next.js integration example using @fedify/next middleware.
    // Requires a build step before starting.
    name: "next-integration",
    dir: "next-integration",
    buildCmd: ["pnpm", "build"],
    startCmd: ["pnpm", "start"],
    port: 3000,
    actor: "demo",
    readyUrl: "http://localhost:3000/",
    readyTimeout: 30_000,
  },
  {
    // SvelteKit sample using @fedify/sveltekit; actor path is /users/{identifier}.
    // Built with vite; served with vite preview on port 4173.
    name: "sveltekit-sample",
    dir: "sveltekit-sample",
    buildCmd: ["pnpm", "build"],
    startCmd: ["pnpm", "preview"],
    port: 4173,
    actor: "demo",
    readyUrl: "http://localhost:4173/",
  },
];

const SCRIPT_EXAMPLES: ScriptExample[] = [
  {
    // Self-contained federation demo; creates a federation in-process and
    // performs a single fetch.  No server is started.
    name: "custom-collections",
    dir: "custom-collections",
    cmd: ["deno", "run", "--allow-all", "main.ts"],
    description: "Custom collection demonstration (in-process federation)",
  },
];

const MULTI_HANDLE_EXAMPLES: MultiHandleExample[] = [
  {
    // Looks up a real fediverse actor; passes if any handle resolves.
    name: "actor-lookup-cli",
    dir: "actor-lookup-cli",
    cmd: ["deno", "run", "--allow-all", "main.ts"],
    handles: ["@hongminhee@hackers.pub", "@hongminhee@hollo.social"],
    description: "Actor lookup CLI (real fediverse handle)",
  },
];

const SKIPPED_EXAMPLES: SkippedExample[] = [
  {
    name: "cloudflare-workers",
    reason: "Requires Cloudflare Workers environment and wrangler CLI",
  },
  {
    name: "fresh",
    reason:
      "No actor dispatcher configured; federation lookup cannot be verified",
  },
];

// ─── ANSI Colors ──────────────────────────────────────────────────────────────

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function decodeChunks(chunks: Uint8Array[]): string {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(buf);
}

/**
 * Drains a ReadableStream into `chunks` in the background, logging each chunk
 * at DEBUG level so that raw server/tunnel output is visible with --debug.
 */
function drainLogging(
  stream: ReadableStream<Uint8Array>,
  chunks: Uint8Array[],
  streamLogger: ReturnType<typeof getLogger>,
): void {
  (async () => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      const text = decoder.decode(value).trim();
      if (text) streamLogger.debug("{output}", { output: text });
    }
  })();
}

/**
 * Polls `url` every 500 ms until the server responds with any HTTP status.
 * Returns true if ready before `timeoutMs`, false otherwise.
 */
async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      await res.body?.cancel();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

// ─── Process Management ───────────────────────────────────────────────────────

/**
 * Finds all processes **listening** on `port` (TCP LISTEN state only) via
 * `lsof -ti :<port> -sTCP:LISTEN` and sends SIGKILL to each of them.
 *
 * Using `-sTCP:LISTEN` is critical: without it `lsof` also returns processes
 * that merely have an established _client_ connection to the port (e.g. the
 * test-runner itself after calling `waitForServer`), which would cause the
 * runner to kill itself.
 */
async function killPortUsers(port: number): Promise<void> {
  let pids: string[];
  try {
    const result = await new Deno.Command("lsof", {
      args: ["-ti", `:${port}`, "-sTCP:LISTEN"],
      stdout: "piped",
      stderr: "null",
    }).output();
    pids = new TextDecoder()
      .decode(result.stdout)
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return; // lsof unavailable or no match — nothing to do.
  }
  for (const pid of pids) {
    try {
      await new Deno.Command("kill", { args: ["-9", pid] }).output();
      logger.debug("Force-killed PID {pid} on port {port}", { pid, port });
    } catch {
      // Already gone.
    }
  }
}

/**
 * Sends SIGKILL to `proc` immediately and awaits its exit status.
 */
async function forceKillProc(proc: Deno.ChildProcess): Promise<void> {
  try {
    proc.kill("SIGKILL");
  } catch {
    // Process already exited.
  }
  await proc.status.catch(() => {});
}

// ─── Tunnel ───────────────────────────────────────────────────────────────────

/**
 * Starts `fedify tunnel -s localhost.run <port>` and waits up to `timeoutMs`
 * for the tunnel URL to appear in its output.  The tunnel process is kept
 * alive and returned to the caller; it must be killed when no longer needed.
 *
 * Returns `null` if the URL was not found before the timeout.
 */
async function startTunnel(
  port: number,
  timeoutMs: number,
): Promise<{ proc: Deno.ChildProcess; url: string } | null> {
  const tunnelLogger = getLogger(["fedify", "examples", "tunnel"]);
  tunnelLogger.info("Opening localhost.run tunnel on port {port}", { port });

  const proc = new Deno.Command("deno", {
    args: ["task", "cli", "tunnel", "-s", "pinggy.io", String(port)],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  // Accumulate text from both streams while logging each chunk at DEBUG.
  const textChunks: string[] = [];
  const decoder = new TextDecoder();

  const readStream = (stream: ReadableStream<Uint8Array>) => {
    (async () => {
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        textChunks.push(text);
        const trimmed = text.trim();
        if (trimmed) tunnelLogger.debug("{output}", { output: trimmed });
      }
    })();
  };

  readStream(proc.stdout);
  readStream(proc.stderr);

  // Poll until we find an https URL in the accumulated output.
  // The `message` template tag from @optique/run may wrap the URL in double
  // quotes in non-TTY output, so we stop matching at whitespace or quotes.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = textChunks.join("").match(/https:\/\/[^\s"']+/);
    if (match) {
      tunnelLogger.info("Tunnel established at {url}", { url: match[0] });
      return { proc, url: match[0] };
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  tunnelLogger.error(
    "Tunnel did not produce a URL within {timeout} ms",
    { timeout: timeoutMs },
  );
  await forceKillProc(proc);
  return null;
}

// ─── Test Runners ─────────────────────────────────────────────────────────────

async function testServerExample(
  example: ServerExample,
  defaultTimeoutMs: number,
): Promise<TestResult> {
  const {
    name,
    dir,
    buildCmd,
    startCmd,
    startCwd,
    port,
    actor,
    readyUrl,
    env,
  } = example;
  const exampleDir = join(EXAMPLES_DIR, dir);
  const cwd = startCwd ?? exampleDir;
  const timeoutMs = example.readyTimeout ?? defaultTimeoutMs;
  const serverLogger = getLogger(["fedify", "examples", name]);

  // ── Build step (if configured) ────────────────────────────────────────────
  if (buildCmd != null) {
    const buildCwd = example.buildCwd ?? exampleDir;
    console.log(c.cyan(`\n[${name}]`) + " Building…");
    console.log(c.dim(`  cmd : ${buildCmd.join(" ")}`));
    console.log(c.dim(`  cwd : ${buildCwd}`));
    serverLogger.info("Building {name}", { name, cmd: buildCmd.join(" ") });

    let buildResult: Deno.CommandOutput;
    try {
      buildResult = await new Deno.Command(buildCmd[0], {
        args: buildCmd.slice(1),
        cwd: buildCwd,
        stdout: "piped",
        stderr: "piped",
      }).output();
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        const error = `Build command not found: ${buildCmd[0]}`;
        serverLogger.error("{error}", { error });
        return { name, status: "fail", error, output: "" };
      }
      throw e;
    }

    const buildOutput = new TextDecoder().decode(buildResult.stdout) +
      new TextDecoder().decode(buildResult.stderr);
    serverLogger.debug("Build output:\n{output}", {
      output: buildOutput.trim(),
    });

    if (!buildResult.success) {
      const error = `Build failed with exit code ${buildResult.code}`;
      serverLogger.error("{error}", { error });
      return { name, status: "fail", error, output: buildOutput };
    }
    serverLogger.info("{name} build succeeded", { name });
    console.log(c.dim(`  build succeeded`));
  }

  // Kill any process already using the port before we try to bind it.
  serverLogger.debug("Clearing port {port} before start", { port });
  await killPortUsers(port);

  console.log(c.cyan(`\n[${name}]`) + " Starting server…");
  console.log(c.dim(`  cmd : ${startCmd.join(" ")}`));
  console.log(c.dim(`  cwd : ${cwd}`));
  if (env) console.log(c.dim(`  env : ${JSON.stringify(env)}`));

  serverLogger.info("Starting {name}", { name, cmd: startCmd.join(" "), cwd });

  let serverProc: Deno.ChildProcess;
  try {
    serverProc = new Deno.Command(startCmd[0], {
      args: startCmd.slice(1),
      cwd: cwd,
      stdout: "piped",
      stderr: "piped",
      env: env ? { ...Deno.env.toObject(), ...env } : undefined,
    }).spawn();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      const error = `Command not found: ${startCmd[0]}`;
      serverLogger.error("{error}", { error });
      return { name, status: "fail", error, output: "" };
    }
    throw e;
  }

  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  drainLogging(serverProc.stdout, stdoutChunks, serverLogger);
  drainLogging(serverProc.stderr, stderrChunks, serverLogger);

  const collectServerOutput = () =>
    decodeChunks(stdoutChunks) + decodeChunks(stderrChunks);

  let tunnelProc: Deno.ChildProcess | null = null;

  try {
    console.log(
      c.dim(
        `  waiting for server at ${readyUrl} (timeout: ${timeoutMs} ms)…`,
      ),
    );
    serverLogger.debug("Polling {url}", { url: readyUrl });

    const ready = await waitForServer(readyUrl, timeoutMs);
    if (!ready) {
      const error = `Server did not become ready within ${timeoutMs} ms`;
      serverLogger.error("{error}", { error });
      return { name, status: "fail", error, output: collectServerOutput() };
    }

    serverLogger.info("{name} is ready; opening tunnel on port {port}", {
      name,
      port,
    });
    console.log(c.dim(`  server ready — opening tunnel on port ${port}…`));

    const tunnel = await startTunnel(port, 30_000);
    if (tunnel == null) {
      const error = "fedify tunnel did not produce a URL within 5 minutes";
      serverLogger.error("{error}", { error });
      return { name, status: "fail", error, output: collectServerOutput() };
    }

    tunnelProc = tunnel.proc;
    const tunnelHostname = new URL(tunnel.url).hostname;
    const handle = `@${actor}@${tunnelHostname}`;

    console.log(c.dim(`  tunnel URL : ${tunnel.url}`));
    console.log(c.dim(`  running    : fedify lookup ${handle} -d`));
    serverLogger.info("Running fedify lookup {handle}", { handle });

    const lookup = await new Deno.Command("deno", {
      args: ["task", "cli", "lookup", handle, "-d"],
      cwd: REPO_ROOT,
      stdout: "piped",
      stderr: "piped",
    }).output();

    const lookupOutput = new TextDecoder().decode(lookup.stdout) +
      new TextDecoder().decode(lookup.stderr);
    serverLogger.debug("Lookup output:\n{output}", {
      output: lookupOutput.trim(),
    });

    if (lookup.code === 0) {
      serverLogger.info("{name} passed", { name });
      return { name, status: "pass", output: lookupOutput };
    }
    const error = `fedify lookup exited with code ${lookup.code}`;
    serverLogger.error("{error}", { error });
    return { name, status: "fail", error, output: lookupOutput };
  } finally {
    // Force-kill tunnel first (it holds a connection to the server).
    if (tunnelProc != null) {
      serverLogger.debug("Force-killing tunnel process");
      await forceKillProc(tunnelProc);
    }
    serverLogger.debug("Force-killing server process");
    await forceKillProc(serverProc);

    // Kill any lingering processes still bound to the port.
    serverLogger.debug("Killing remaining processes on port {port}", { port });
    await killPortUsers(port);
  }
}

async function testScriptExample(example: ScriptExample): Promise<TestResult> {
  const { name, dir, cmd, description } = example;
  const cwd = join(EXAMPLES_DIR, dir);
  const scriptLogger = getLogger(["fedify", "examples", name]);

  console.log(c.cyan(`\n[${name}]`) + ` Running: ${c.dim(description)}`);
  console.log(c.dim(`  cmd : ${cmd.join(" ")}`));
  scriptLogger.info("Running script {name}: {cmd}", {
    name,
    cmd: cmd.join(" "),
  });

  const result = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();

  const output = new TextDecoder().decode(result.stdout) +
    new TextDecoder().decode(result.stderr);
  scriptLogger.debug("Script output:\n{output}", { output: output.trim() });

  if (result.code === 0) {
    scriptLogger.info("{name} passed", { name });
    return { name, status: "pass", output };
  }
  const error = `Script exited with code ${result.code}`;
  scriptLogger.error("{error}", { error });
  return { name, status: "fail", error, output };
}

async function testMultiHandleExample(
  example: MultiHandleExample,
): Promise<TestResult> {
  const { name, dir, cmd, handles, description } = example;
  const cwd = join(EXAMPLES_DIR, dir);
  const scriptLogger = getLogger(["fedify", "examples", name]);

  console.log(c.cyan(`\n[${name}]`) + ` Running: ${c.dim(description)}`);
  scriptLogger.info("Testing {name} with {count} handle(s)", {
    name,
    count: handles.length,
  });

  let lastOutput = "";
  for (const handle of handles) {
    const fullCmd = [...cmd, handle];
    console.log(c.dim(`  cmd : ${fullCmd.join(" ")}`));
    scriptLogger.info("Trying handle {handle}", { handle });

    const result = await new Deno.Command(fullCmd[0], {
      args: fullCmd.slice(1),
      cwd,
      stdout: "piped",
      stderr: "piped",
    }).output();

    const output =
      new TextDecoder().decode(result.stdout) +
      new TextDecoder().decode(result.stderr);
    scriptLogger.debug("Output:\n{output}", { output: output.trim() });
    lastOutput = output;

    if (result.code === 0) {
      scriptLogger.info("{name} passed with handle {handle}", { name, handle });
      return { name, status: "pass", output };
    }
    scriptLogger.warn("Handle {handle} failed with code {code}", {
      handle,
      code: result.code,
    });
  }

  const error = `All ${handles.length} handle(s) failed`;
  scriptLogger.error("{error}", { error });
  return { name, status: "fail", error, output: lastOutput };
}

// ─── Result Printer ───────────────────────────────────────────────────────────

function printInlineResult(result: TestResult): void {
  if (result.status === "pass") {
    console.log(c.green(`  ✓ ${result.name}`));
  } else if (result.status === "fail") {
    console.log(c.red(`  ✗ ${result.name}: ${result.error}`));
  } else {
    console.log(c.yellow(`  ⊘ ${result.name}: ${result.reason}`));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // ── Parse CLI arguments ──────────────────────────────────────────────────
  let defaultTimeoutMs = 10_000;
  const filterNames = new Set<string>();

  for (let i = 0; i < Deno.args.length; i++) {
    const arg = Deno.args[i];
    if (arg === "--timeout" && i + 1 < Deno.args.length) {
      defaultTimeoutMs = Number(Deno.args[++i]);
    } else if (arg.startsWith("--timeout=")) {
      defaultTimeoutMs = Number(arg.slice("--timeout=".length));
    } else if (arg === "--debug" || arg === "-d") {
      // already handled above at module level
    } else if (!arg.startsWith("--")) {
      filterNames.add(arg);
    }
  }

  const shouldRun = (name: string) =>
    filterNames.size === 0 || filterNames.has(name);

  // ── Banner ───────────────────────────────────────────────────────────────
  console.log(c.bold("Fedify Example Test Runner"));
  console.log(`Tunnel service: localhost.run (via \`fedify tunnel\`)`);
  console.log(`Ready timeout : ${defaultTimeoutMs} ms`);
  if (debugMode) console.log(`Debug logging : enabled`);
  if (filterNames.size > 0) {
    console.log(`Running only  : ${[...filterNames].join(", ")}`);
  }
  console.log();

  logger.info("Test runner started", { debugMode, defaultTimeoutMs });

  // ── Run examples ─────────────────────────────────────────────────────────
  const results: TestResult[] = [];
  const usedPorts = new Set<number>();

  for (const example of SERVER_EXAMPLES) {
    if (!shouldRun(example.name)) continue;
    usedPorts.add(example.port);
    const result = await testServerExample(example, defaultTimeoutMs);
    results.push(result);
    printInlineResult(result);
  }

  for (const example of SCRIPT_EXAMPLES) {
    if (!shouldRun(example.name)) continue;
    const result = await testScriptExample(example);
    results.push(result);
    printInlineResult(result);
  }

  for (const example of MULTI_HANDLE_EXAMPLES) {
    if (!shouldRun(example.name)) continue;
    const result = await testMultiHandleExample(example);
    results.push(result);
    printInlineResult(result);
  }

  for (const example of SKIPPED_EXAMPLES) {
    if (!shouldRun(example.name)) continue;
    const result: TestResult = {
      name: example.name,
      status: "skip",
      reason: example.reason,
    };
    results.push(result);
    printInlineResult(result);
  }

  // ── Final port cleanup ───────────────────────────────────────────────────
  // After all tests are done, ensure no processes remain on the used ports.
  if (usedPorts.size > 0) {
    logger.debug("Final cleanup: killing remaining processes on used ports");
    for (const port of usedPorts) {
      await killPortUsers(port);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.status === "pass");
  const failed = results.filter((r) => r.status === "fail");
  const skipped = results.filter((r) => r.status === "skip");

  console.log(c.bold("\n─────────────────── Summary ───────────────────"));
  console.log(c.green(`  ✓ Passed : ${passed.length}`));
  console.log(c.red(`  ✗ Failed : ${failed.length}`));
  console.log(c.yellow(`  ⊘ Skipped: ${skipped.length}`));

  logger.info("Test run complete", {
    passed: passed.length,
    failed: failed.length,
    skipped: skipped.length,
  });

  if (failed.length > 0) {
    console.log(c.bold(c.red("\nFailed examples:")));
    for (const r of failed) {
      if (r.status !== "fail") continue;
      console.log(c.red(`  • ${r.name}: ${r.error}`));
      // Show the last 20 lines of combined output as a quick hint.
      const preview = r.output.trim().split("\n").slice(-20).join("\n");
      if (preview) console.log(c.dim(preview));
    }
    Deno.exit(1);
  }
}

await main();
