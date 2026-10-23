/**
 * Helpers shared by the pinner tests in *../\*.test.ts*.  They start local
 * servers and proxies, and run child processes.
 * @module
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  type AddressInfo,
  connect,
  createServer as createTcpServer,
  type Server as TcpServer,
} from "node:net";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { type ResolvedAddress, UrlError } from "../../url.ts";
import { detectRuntime } from "../mod.ts";
import type { ConnectionPinnerOptions } from "../types.ts";

export const isBun: boolean = detectRuntime() === "bun";
export const isNode: boolean = detectRuntime() === "node";

/** Pinner options that allow connecting to any address, e.g., loopback. */
export const allowAll: ConnectionPinnerOptions = { verifyAddress() {} };

export const ipv4 = (address: string): ResolvedAddress => ({
  address,
  family: 4,
});
export const ipv6 = (address: string): ResolvedAddress => ({
  address,
  family: 6,
});

/**
 * Whether the error is the rejection of an address by `verifyAddress`.
 * The Bun pinner throws the `UrlError` itself, and the Node.js pinner
 * rejects with the `TypeError` of `fetch()`, caused by the `UrlError` that
 * its lookup failed with.
 */
export function isAddressRejection(error: unknown): boolean {
  return error instanceof UrlError ||
    error instanceof TypeError && error.cause instanceof UrlError;
}

export interface ReceivedRequest {
  readonly method: string;
  readonly url: string;
  readonly host: string | undefined;
  readonly localAddress: string | undefined;
  readonly body: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => body += chunk);
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export async function listen(
  server: Server | TcpServer,
  host = "127.0.0.1",
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

export async function closeServer(server: Server | TcpServer): Promise<void> {
  (server as Server).closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(2_000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export interface LoopbackSupport {
  /** Whether `::1` can be connected to. */
  readonly ipv6: boolean;
  /**
   * Whether a server listening on `::` accepts connections to both 127.0.0.1
   * and `::1`.
   */
  readonly dualStack: boolean;
}

let loopbackSupport: Promise<LoopbackSupport> | undefined;

/**
 * Checks which loopback addresses the tests can use.  Only 127.0.0.1 is
 * assumed: other addresses of 127.0.0.0/8 are not configured on macOS, and
 * IPv6 can be disabled.
 */
export function getLoopbackSupport(): Promise<LoopbackSupport> {
  loopbackSupport ??= (async () => {
    const server = createTcpServer((socket) => socket.destroy());
    let port: number;
    try {
      port = await listen(server, "::");
    } catch {
      return { ipv6: false, dualStack: false };
    }
    try {
      const [v4, v6] = await Promise.all([
        canConnect("127.0.0.1", port),
        canConnect("::1", port),
      ]);
      return { ipv6: v6, dualStack: v4 && v6 };
    } finally {
      await closeServer(server);
    }
  })();
  return loopbackSupport;
}

/**
 * Starts an HTTP server that records the requests it receives.
 */
export async function startRecordingServer(
  host = "127.0.0.1",
  respond: (req: IncomingMessage, res: ServerResponse) => void = (_, res) =>
    res.end("pinned"),
) {
  const requests: ReceivedRequest[] = [];
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({
      method: req.method ?? "",
      url: req.url ?? "",
      host: req.headers.host,
      localAddress: req.socket.localAddress,
      body,
    });
    respond(req, res);
  });
  const port = await listen(server, host);
  return { server, port, requests };
}

/**
 * Starts a TCP server that only counts the connections it accepts, and drops
 * them right away.  It stands for an HTTPS server without a certificate.
 */
export async function startCountingServer() {
  const counter = { connections: 0 };
  const server = createTcpServer((socket) => {
    counter.connections++;
    socket.destroy();
  });
  const port = await listen(server);
  return { server, port, counter };
}

/**
 * Starts a proxy that records the request targets it is asked for, and never
 * forwards them.  It answers a request in absolute form with `via-proxy`,
 * and drops tunnels (`CONNECT`).  It parses requests by itself since
 * the `connect` event of `node:http` servers is not available on older Bun
 * versions.
 * @param options.refuseTunnels Whether to refuse tunnels with a `403`
 *                              response instead of dropping them.  Some
 *                              clients retry dropped tunnels without end
 *                              (e.g., the `EnvHttpProxyAgent` of Node.js),
 *                              and some take the response of a refused
 *                              tunnel for the response of the request
 *                              (e.g., Bun 1.3.14).
 */
export async function startRecordingProxy(
  { refuseTunnels = false }: { readonly refuseTunnels?: boolean } = {},
) {
  const targets: string[] = [];
  const server = createTcpServer((socket) => {
    let head = "";
    socket.setEncoding("latin1");
    socket.on("error", () => {});
    socket.on("data", (chunk: string) => {
      if (head.includes("\r\n\r\n")) return;
      head += chunk;
      if (!head.includes("\r\n\r\n")) return;
      const [method, target] = head.slice(0, head.indexOf("\r\n")).split(" ");
      targets.push(`${method} ${target}`);
      if (method !== "CONNECT") {
        socket.end(
          "HTTP/1.1 200 OK\r\nContent-Length: 9\r\nConnection: close\r\n" +
            "\r\nvia-proxy",
        );
      } else if (refuseTunnels) {
        socket.end(
          "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n" +
            "Connection: close\r\n\r\n",
        );
      } else {
        socket.destroy();
      }
    });
  });
  const port = await listen(server);
  return { server, port, targets };
}

/**
 * Returns the first of the given paths that exists.
 */
function findFile(name: string, candidates: readonly string[]): string {
  const found = candidates.find((path) => existsSync(path));
  if (found == null) {
    throw new Error(`Cannot find ${name} in ${candidates.join(", ")}`);
  }
  return found;
}

function getModuleDirectory(moduleUrl: string | undefined): string | null {
  return typeof moduleUrl === "string" && moduleUrl.startsWith("file:")
    ? dirname(fileURLToPath(moduleUrl))
    : null;
}

const TESTDATA = ["src", "pinners", "testdata"] as const;

/**
 * Finds a source file in *testdata/* (e.g., a child script that Bun runs
 * directly).  When a test runs from the compiled *dist/tests/pinners/*
 * instead of *src/pinners/*, the test data is not compiled with it, so this
 * falls back to the files in the package: first relative to the test module,
 * then relative to the working directory (the package root, where the Bun
 * test script runs), in case `import.meta.url` is unavailable in a CommonJS
 * build.
 * @param name The file name.
 * @param moduleUrl The `import.meta.url` of the test module.
 */
export function resolveTestdata(
  name: string,
  moduleUrl: string | undefined,
): string {
  const candidates: string[] = [];
  const here = getModuleDirectory(moduleUrl);
  if (here != null) {
    candidates.push(
      join(here, TESTDATA[2], name),
      join(here, "..", "..", "..", ...TESTDATA, name),
    );
  }
  candidates.push(join(process.cwd(), ...TESTDATA, name));
  return findFile(name, candidates);
}

/**
 * Finds a child script of *testdata/* compiled into
 * *dist/tests/pinners/testdata/* by *tsdown.config.ts*, for Node.js, which
 * cannot run TypeScript sources without flags before 22.6.0.  Node.js tests
 * run only from *dist/tests/* (`cd dist/tests && node --test`), so this looks
 * relative to the test module, then relative to the working directory, in
 * case `import.meta.url` is unavailable in a CommonJS build.
 * @param name The compiled file name, e.g., `node-child.mjs`.
 * @param moduleUrl The `import.meta.url` of the test module.
 */
export function resolveCompiledTestdata(
  name: string,
  moduleUrl: string | undefined,
): string {
  const candidates: string[] = [];
  const here = getModuleDirectory(moduleUrl);
  if (here != null) candidates.push(join(here, TESTDATA[2], name));
  candidates.push(
    join(process.cwd(), ...TESTDATA.slice(1), name),
    join(process.cwd(), "dist", "tests", ...TESTDATA.slice(1), name),
  );
  return findFile(name, candidates);
}

const PROXY_ENV_NAMES = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
] as const;

/**
 * Runs a child script in a new process of the current runtime, without proxy
 * environment variables (and `NODE_USE_ENV_PROXY`) but with the given ones,
 * and parses the last line of its output as JSON.
 * @param script The path of the script.
 * @param args The arguments to the script.
 * @param extraEnv The environment variables to set.
 */
export function runChild<T>(
  script: string,
  args: readonly string[],
  extraEnv: Record<string, string>,
): Promise<T> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of PROXY_ENV_NAMES) {
    delete env[name];
    delete env[name.toLowerCase()];
  }
  delete env.NODE_USE_ENV_PROXY;
  Object.assign(env, extraEnv);
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script, ...args],
      { env, timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error != null) {
          reject(new Error(`${script} failed: ${stderr}`, { cause: error }));
          return;
        }
        const line = stdout.trim().split("\n").at(-1) ?? "";
        try {
          resolve(JSON.parse(line));
        } catch (cause) {
          reject(new Error(`Unexpected output: ${stdout}${stderr}`, { cause }));
        }
      },
    );
  });
}
