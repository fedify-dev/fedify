import { test } from "@fedify/fixture";
import { deepStrictEqual, ok, rejects } from "node:assert";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import {
  type AddressInfo,
  connect,
  createServer as createTcpServer,
  type Server as TcpServer,
} from "node:net";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { issuePinGrant, type PinGrant, revokePinGrant } from "../pin-grant.ts";
import { assertPublicAddress, type ResolvedAddress, UrlError } from "../url.ts";
import { createBunPinner } from "./bun.ts";
import type { ConnectionPinner, ConnectionPinnerOptions } from "./types.ts";

const isBun = "Bun" in globalThis;

const allowAll: ConnectionPinnerOptions = { verifyAddress() {} };

const ipv4 = (address: string): ResolvedAddress => ({ address, family: 4 });
const ipv6 = (address: string): ResolvedAddress => ({ address, family: 6 });

interface ReceivedRequest {
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

async function listen(
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

async function closeServer(server: Server | TcpServer): Promise<void> {
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

interface LoopbackSupport {
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
function getLoopbackSupport(): Promise<LoopbackSupport> {
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
async function startRecordingServer(
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

test("createBunPinner() supports only HTTP and HTTPS", () => {
  const pinner = createBunPinner(allowAll);
  ok(pinner.supports(new URL("http://pinned-host.invalid/")));
  ok(pinner.supports(new URL("https://pinned-host.invalid/")));
  ok(!pinner.supports(new URL("ftp://pinned-host.invalid/")));
  ok(!pinner.supports(new URL("ws://pinned-host.invalid/")));
});

test("createBunPinner() checks addresses right before connecting", async () => {
  const { server, port, requests } = await startRecordingServer();
  try {
    // The production check, with a grant for a private address that
    // openPublicFetch() would never issue:
    const pinner = createBunPinner({ verifyAddress: assertPublicAddress });
    const url = new URL(`http://pinned-host.invalid:${port}/`);
    const grant = issuePinGrant(url, [ipv4("127.0.0.1")]);
    for (const method of ["GET", "POST"]) {
      await rejects(
        () => pinner.fetch(grant, new Request(url, { method })),
        UrlError,
      );
    }
    deepStrictEqual(requests, []);
  } finally {
    await closeServer(server);
  }
});

test("createBunPinner() does not fall back past a failed check", async () => {
  const { server, port, requests } = await startRecordingServer();
  try {
    const checked: string[] = [];
    const pinner = createBunPinner({
      verifyAddress({ address }) {
        checked.push(address);
        if (address !== "127.0.0.1") {
          throw new UrlError(`Invalid or private address: ${address}`);
        }
      },
    });
    // The second address would reach the server, but the first one fails
    // the check, and is never connected to (192.0.2.0/24 is TEST-NET-1):
    const url = new URL(`http://pinned-host.invalid:${port}/`);
    const grant = issuePinGrant(url, [ipv4("192.0.2.1"), ipv4("127.0.0.1")]);
    await rejects(() => pinner.fetch(grant, new Request(url)), UrlError);
    deepStrictEqual(checked, ["192.0.2.1"]);
    deepStrictEqual(requests, []);
  } finally {
    await closeServer(server);
  }
});

test("createBunPinner() redeems the grant for every request", async () => {
  const { server, port, requests } = await startRecordingServer();
  try {
    const pinner = createBunPinner(allowAll);
    const url = new URL(`http://pinned-host.invalid:${port}/`);
    const grant = issuePinGrant(url, [ipv4("127.0.0.1")]);
    // Other origins:
    for (
      const other of [
        `http://other-host.invalid:${port}/`,
        `https://pinned-host.invalid:${port}/`,
        `http://pinned-host.invalid:${port + 1}/`,
      ]
    ) {
      await rejects(() => pinner.fetch(grant, new Request(other)), TypeError);
    }
    // Forged grants:
    for (const forged of [{}, Object.freeze(Object.create(null))]) {
      await rejects(
        () => pinner.fetch(forged as PinGrant, new Request(url)),
        TypeError,
      );
    }
    // Revoked grants:
    revokePinGrant(grant);
    await rejects(() => pinner.fetch(grant, new Request(url)), TypeError);
    deepStrictEqual(requests, []);
  } finally {
    await closeServer(server);
  }
});

test("createBunPinner() connects to the pinned address", {
  ignore: !isBun,
}, async () => {
  const { server, port, requests } = await startRecordingServer();
  try {
    const pinner = createBunPinner(allowAll);
    // The .invalid TLD never resolves, so a response proves that the
    // connection went to the pinned address:
    const url = new URL(`http://pinned-host.invalid:${port}/path?query`);
    const grant = issuePinGrant(url, [ipv4("127.0.0.1")]);
    const response = await pinner.fetch(
      grant,
      new Request(url, { headers: { "X-Test": "header" } }),
    );
    deepStrictEqual(response.status, 200);
    deepStrictEqual(await response.text(), "pinned");
    const post = await pinner.fetch(
      grant,
      new Request(url, { method: "POST", body: "payload" }),
    );
    deepStrictEqual(await post.text(), "pinned");
    deepStrictEqual(
      requests.map(({ method, url, host, body }) => ({
        method,
        url,
        host,
        body,
      })),
      [
        {
          method: "GET",
          url: "/path?query",
          host: `pinned-host.invalid:${port}`,
          body: "",
        },
        {
          method: "POST",
          url: "/path?query",
          host: `pinned-host.invalid:${port}`,
          body: "payload",
        },
      ],
    );
  } finally {
    await closeServer(server);
  }
});

test("createBunPinner() does not follow redirects", {
  ignore: !isBun,
}, async () => {
  const { server, port, requests } = await startRecordingServer(
    "127.0.0.1",
    (_, res) => {
      res.writeHead(302, { Location: "/target" });
      res.end();
    },
  );
  try {
    const pinner = createBunPinner(allowAll);
    const url = new URL(`http://pinned-host.invalid:${port}/`);
    const grant = issuePinGrant(url, [ipv4("127.0.0.1")]);
    const response = await pinner.fetch(
      grant,
      new Request(url, { redirect: "follow" }),
    );
    deepStrictEqual(response.status, 302);
    deepStrictEqual(response.headers.get("Location"), "/target");
    deepStrictEqual(requests.length, 1);
  } finally {
    await closeServer(server);
  }
});

test("createBunPinner() aborts requests on either signal", {
  ignore: !isBun,
}, async () => {
  // The server never responds, so only an abort ends the request:
  let notifyReceived = () => {};
  const server = createServer(() => notifyReceived());
  const port = await listen(server);
  try {
    const pinner = createBunPinner(allowAll);
    const url = new URL(`http://pinned-host.invalid:${port}/`);
    const grant = issuePinGrant(url, [ipv4("127.0.0.1")]);
    for (const which of ["request", "separate"] as const) {
      const requestController = new AbortController();
      const separateController = new AbortController();
      const received = new Promise<void>((resolve) => notifyReceived = resolve);
      const response = pinner.fetch(
        grant,
        new Request(url, { signal: requestController.signal }),
        separateController.signal,
      );
      await received;
      (which === "request" ? requestController : separateController).abort();
      await rejects(response, { name: "AbortError" }, which);
    }
  } finally {
    await closeServer(server);
  }
});

test("createBunPinner() falls back to the next address for GET and HEAD", {
  ignore: !isBun,
}, async () => {
  // Skipped where IPv6 is unavailable:
  if (!(await getLoopbackSupport()).ipv6) return;
  // The server listens only on 127.0.0.1, so the first address, ::1, refuses
  // the connection:
  const { server, port, requests } = await startRecordingServer();
  try {
    const pinner = createBunPinner(allowAll);
    const url = new URL(`http://pinned-host.invalid:${port}/`);
    const grant = issuePinGrant(url, [ipv6("::1"), ipv4("127.0.0.1")]);
    const response = await pinner.fetch(grant, new Request(url));
    deepStrictEqual(await response.text(), "pinned");
    const head = await pinner.fetch(
      grant,
      new Request(url, { method: "HEAD" }),
    );
    deepStrictEqual(head.status, 200);
    deepStrictEqual(
      requests.map(({ method, localAddress }) => [method, localAddress]),
      [["GET", "127.0.0.1"], ["HEAD", "127.0.0.1"]],
    );
  } finally {
    await closeServer(server);
  }
});

test("createBunPinner() does not fall back for POST", {
  ignore: !isBun,
}, async () => {
  // Skipped where IPv6 is unavailable:
  if (!(await getLoopbackSupport()).ipv6) return;
  // The first address, ::1, refuses the connection, and the second one
  // would reach the server:
  const { server, port, requests } = await startRecordingServer();
  try {
    const pinner = createBunPinner(allowAll);
    const url = new URL(`http://pinned-host.invalid:${port}/`);
    const grant = issuePinGrant(url, [ipv6("::1"), ipv4("127.0.0.1")]);
    await rejects(() =>
      pinner.fetch(
        grant,
        new Request(url, { method: "POST", body: "payload" }),
      )
    );
    deepStrictEqual(requests, []);
  } finally {
    await closeServer(server);
  }
});

/**
 * The pinners that are tested with real connections.  Node.js gets its own
 * pinner in a later change.
 */
const realConnectionPinners: readonly {
  readonly name: string;
  readonly ignore: boolean;
  readonly create: (options: ConnectionPinnerOptions) => ConnectionPinner;
}[] = [
  { name: "Bun", ignore: !isBun, create: createBunPinner },
];

for (const { name, ignore, create } of realConnectionPinners) {
  test(`${name} pinner does not deliver a POST request twice`, {
    ignore,
  }, async () => {
    // Skipped where a server cannot listen on both loopback addresses:
    if (!(await getLoopbackSupport()).dualStack) return;
    // The server receives the whole request, and then drops the connection
    // without responding, as if it crashed right after processing it.
    // It parses requests by itself since the `node:http` server of older Bun
    // versions (e.g., 1.2.0) responds instead of dropping the connection:
    let received = 0;
    const server = createTcpServer((socket) => {
      let data = "";
      socket.setEncoding("latin1");
      socket.on("error", () => {});
      socket.on("data", (chunk: string) => {
        data += chunk;
        const headEnd = data.indexOf("\r\n\r\n");
        if (headEnd < 0) return;
        const length = /^content-length:\s*(\d+)/im.exec(
          data.slice(0, headEnd),
        )?.[1];
        const complete = length == null
          ? data.endsWith("\r\n0\r\n\r\n")
          : data.length - headEnd - 4 >= Number(length);
        if (!complete) return;
        received++;
        socket.destroy();
      });
    });
    const port = await listen(server, "::");
    try {
      const pinner = create(allowAll);
      const url = new URL(`http://pinned-host.invalid:${port}/inbox`);
      const grant = issuePinGrant(url, [ipv4("127.0.0.1"), ipv6("::1")]);
      await rejects(() =>
        pinner.fetch(
          grant,
          new Request(url, { method: "POST", body: "activity" }),
        )
      );
      deepStrictEqual(received, 1);
      // Control: the second address reaches the same server, so falling back
      // would have delivered the activity twice.  (Whether a GET request
      // falls back here depends on the Bun version: Bun 1.4 raises this
      // ECONNRESET as a TypeError, but Bun 1.2 does not.)
      const second = issuePinGrant(url, [ipv6("::1")]);
      await rejects(() =>
        pinner.fetch(
          second,
          new Request(url, { method: "POST", body: "activity" }),
        )
      );
      deepStrictEqual(received, 2);
    } finally {
      await closeServer(server);
    }
  });
}

const TESTDATA = ["src", "pinners", "testdata"] as const;

/**
 * Finds a file in *testdata/*.  When this test runs from the compiled
 * *dist/tests/pinners/* instead of *src/pinners/*, the test data is not
 * compiled with it, so this falls back to the files in the package (child
 * scripts are TypeScript sources, which Bun runs directly): first relative to
 * this module, then relative to the working directory (the package root,
 * where the test scripts run), in case `import.meta.url` is unavailable in
 * a CommonJS build.
 */
function resolveTestdata(name: string): string {
  const candidates: string[] = [];
  const moduleUrl: string | undefined = import.meta.url;
  if (typeof moduleUrl === "string" && moduleUrl.startsWith("file:")) {
    const here = dirname(fileURLToPath(moduleUrl));
    candidates.push(
      join(here, TESTDATA[2], name),
      join(here, "..", "..", "..", ...TESTDATA, name),
    );
  }
  candidates.push(join(process.cwd(), ...TESTDATA, name));
  const found = candidates.find((path) => existsSync(path));
  if (found == null) {
    throw new Error(`Cannot find ${name} in ${candidates.join(", ")}`);
  }
  return found;
}

const PROXY_ENV_NAMES = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
] as const;

/**
 * Runs a child script of *testdata/* in a new process of the current Bun,
 * without proxy environment variables but with the given ones, and parses
 * the last line of its output as JSON.
 */
function runChild<T>(
  script: string,
  args: readonly string[],
  extraEnv: Record<string, string>,
): Promise<T> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of PROXY_ENV_NAMES) {
    delete env[name];
    delete env[name.toLowerCase()];
  }
  Object.assign(env, extraEnv);
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [resolveTestdata(script), ...args],
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

interface ProxyChildOutput {
  readonly version: string;
  readonly http: { status?: number; body?: string; error?: string };
  readonly https: { status?: number; body?: string; error?: string };
  readonly control: { status?: number; body?: string; error?: string };
  readonly warnings: readonly unknown[];
}

function runProxyChild(
  proxyEnv: Record<string, string>,
  httpPort: number,
  httpsPort: number,
): Promise<ProxyChildOutput> {
  return runChild(
    "proxy-child.ts",
    [String(httpPort), String(httpsPort)],
    proxyEnv,
  );
}

interface BunGlobal {
  readonly version: string;
  readonly semver: { satisfies(version: string, range: string): boolean };
}

function getBun(): BunGlobal {
  return (globalThis as unknown as { Bun: BunGlobal }).Bun;
}

/**
 * Whether the current Bun refuses pinned requests to HTTPS servers on
 * non-default ports, since it cannot verify their certificates against
 * the original hostname.
 */
function refusesNonDefaultHttpsPorts(): boolean {
  const bun = getBun();
  return bun.semver.satisfies(bun.version, "<1.3.11");
}

/**
 * Starts a proxy that records the request targets it is asked for, and never
 * forwards them.  It parses requests by itself since the `connect` event of
 * `node:http` servers is not available on older Bun versions.
 */
async function startRecordingProxy() {
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
      if (method === "CONNECT") {
        socket.destroy();
      } else {
        socket.end(
          "HTTP/1.1 200 OK\r\nContent-Length: 9\r\nConnection: close\r\n\r\n" +
            "via-proxy",
        );
      }
    });
  });
  const port = await listen(server);
  return { server, port, targets };
}

test("createBunPinner() bypasses environment proxies", {
  ignore: !isBun,
}, async (t) => {
  const bun = getBun();
  const honorsProxyFalse = bun.semver.satisfies(bun.version, ">=1.4.3");
  const refusesHttps = refusesNonDefaultHttpsPorts();
  for (
    const names of [
      ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"],
      ["ALL_PROXY"],
    ] as const
  ) {
    await t.step(names.join(", "), async () => {
      const proxy = await startRecordingProxy();
      // The HTTP origin server:
      const origin = await startRecordingServer();
      // The HTTPS target, which only counts connections since it has no
      // certificate:
      let tlsConnections = 0;
      const tls = createTcpServer((socket) => {
        tlsConnections++;
        socket.destroy();
      });
      const tlsPort = await listen(tls);
      try {
        const proxyUrl = `http://127.0.0.1:${proxy.port}`;
        const output = await runProxyChild(
          Object.fromEntries(names.map((name) => [name, proxyUrl])),
          origin.port,
          tlsPort,
        );
        const targets = JSON.stringify(proxy.targets);
        deepStrictEqual(output.version, bun.version);
        // The pinned hostname never reaches the proxy as a target:
        ok(
          proxy.targets.every((target) => !target.includes("pinned-host")),
          targets,
        );
        // The control request without proxy: false shows whether the proxy
        // is in effect.  Older Bun versions (e.g., 1.2.22) do not read
        // ALL_PROXY, so it is not in effect with ALL_PROXY alone there:
        const proxyInEffect = output.control.body === "via-proxy";
        if (names.length > 1 || honorsProxyFalse || proxyInEffect) {
          deepStrictEqual(output.control, { status: 200, body: "via-proxy" });
          ok(
            proxy.targets.includes(
              `GET http://127.0.0.1:${origin.port}/control`,
            ),
            targets,
          );
        } else {
          deepStrictEqual(output.control, { status: 200, body: "pinned" });
        }
        const pinnedTargets = proxy.targets.filter((target) =>
          !target.endsWith("/control")
        );
        if (honorsProxyFalse || !proxyInEffect) {
          // Pinned requests connect directly to the pinned address:
          deepStrictEqual(pinnedTargets, [], targets);
          deepStrictEqual(output.http, { status: 200, body: "pinned" });
          deepStrictEqual(
            origin.requests
              .filter(({ url }) => url === "/pinned")
              .map(({ host }) => host),
            [`pinned-host.invalid:${origin.port}`],
          );
          deepStrictEqual(tlsConnections, refusesHttps ? 0 : 1);
        } else {
          // Older Bun versions ignore proxy: false, so pinned requests go
          // through the proxy, but with the pinned address as the target:
          deepStrictEqual(pinnedTargets, [
            `GET http://127.0.0.1:${origin.port}/pinned`,
            ...(refusesHttps ? [] : [`CONNECT 127.0.0.1:${tlsPort}`]),
          ]);
          deepStrictEqual(output.http, { status: 200, body: "via-proxy" });
          deepStrictEqual(origin.requests, []);
          deepStrictEqual(tlsConnections, 0);
        }
        // The HTTPS target has no certificate, and Bun versions before 1.3.11
        // refuse it before connecting since it is on a non-default port:
        ok(
          refusesHttps
            ? output.https.error?.startsWith("TypeError")
            : output.https.error != null,
          JSON.stringify(output.https),
        );
        // Older Bun versions warn once whenever a proxy variable is set:
        deepStrictEqual(output.warnings.length, honorsProxyFalse ? 0 : 1);
      } finally {
        await closeServer(proxy.server);
        await closeServer(origin.server);
        await closeServer(tls);
      }
    });
  }
});

type TlsChildResult =
  | { readonly case: string; readonly status: number; readonly body: string }
  | { readonly case: string; readonly error: string };

interface TlsChildOutput {
  readonly version: string;
  readonly results: readonly TlsChildResult[];
}

test("createBunPinner() verifies certificates on non-default ports", {
  ignore: !isBun,
}, async () => {
  const bun = getBun();
  // Bun versions before 1.3.11 cannot verify certificates against
  // the original hostname on non-default ports, so the pinner refuses such
  // requests there.  (A custom checkServerIdentity fails only after these
  // versions have sent the whole request, which the server would receive.)
  const refuses = refusesNonDefaultHttpsPorts();
  const certPath = resolveTestdata("tls-cert.pem");
  const hosts: string[] = [];
  const server = createHttpsServer({
    cert: readFileSync(certPath),
    key: readFileSync(resolveTestdata("tls-key.pem")),
  }, (req, res) => {
    hosts.push(req.headers.host ?? "");
    res.end(req.headers.host);
  });
  const port = await listen(server);
  try {
    // tls-cert.pem is self-signed for pinned-host.invalid and
    // alternate-host.invalid, and is trusted only by the child process:
    const output = await runChild<TlsChildOutput>(
      "tls-child.ts",
      [String(port)],
      { NODE_EXTRA_CA_CERTS: certPath },
    );
    deepStrictEqual(output.version, bun.version);
    const json = JSON.stringify(output.results);
    if (refuses) {
      ok(
        output.results.every((result) =>
          "error" in result && result.error.startsWith("TypeError")
        ),
        json,
      );
      deepStrictEqual(hosts, []);
      return;
    }
    deepStrictEqual(output.results, [
      { case: "pinned", status: 200, body: `pinned-host.invalid:${port}` },
      // A connection that failed the check must not be reused either:
      { case: "unlisted", error: "ERR_TLS_CERT_ALTNAME_INVALID" },
      { case: "unlisted-again", error: "ERR_TLS_CERT_ALTNAME_INVALID" },
      {
        case: "alternate",
        status: 200,
        body: `alternate-host.invalid:${port}`,
      },
      { case: "signals", status: 200, body: `pinned-host.invalid:${port}` },
    ], json);
    // No request reached the server for the hostname the certificate does
    // not cover:
    deepStrictEqual(hosts, [
      `pinned-host.invalid:${port}`,
      `alternate-host.invalid:${port}`,
      `pinned-host.invalid:${port}`,
    ]);
  } finally {
    await closeServer(server);
  }
});
