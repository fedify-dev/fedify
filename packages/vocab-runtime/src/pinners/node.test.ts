import { test } from "@fedify/fixture";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import process from "node:process";
import type * as Undici from "undici";
import { issuePinGrant, type PinGrant, revokePinGrant } from "../pin-grant.ts";
import { createPublicFetch } from "../public-fetch.ts";
import { assertPublicAddress, type ResolvedAddress, UrlError } from "../url.ts";
import { createNodePinner } from "./node.ts";
import {
  allowAll,
  closeServer,
  getLoopbackSupport,
  ipv4,
  ipv6,
  isNode,
  listen,
  resolveCompiledTestdata,
  resolveTestdata,
  runChild,
  startCountingServer,
  startRecordingProxy,
  startRecordingServer,
} from "./testdata/support.ts";
import type { ConnectionPinner, ConnectionPinnerOptions } from "./types.ts";

// The behaviors that the Node.js pinner shares with the other pinners are
// tested in pinners.test.ts.

/**
 * Creates a Node.js pinner whose undici agent the test can also use
 * directly, by injecting an `Agent` class that remembers its instance.
 */
async function createPinnerWithAgent(options: ConnectionPinnerOptions) {
  const undici = await import("undici");
  const agents: Undici.Agent[] = [];
  class Agent extends undici.Agent {
    constructor(options?: Undici.Agent.Options) {
      super(options);
      agents.push(this);
    }
  }
  const pinner = createNodePinner({ ...options, undici: { Agent } });
  strictEqual(agents.length, 1);
  return { pinner, agent: agents[0] };
}

/**
 * Sends a request through the agent directly, without redeeming a grant.
 */
function fetchThrough(
  agent: Undici.Agent,
  url: URL | string,
): Promise<Response> {
  return fetch(url, { dispatcher: agent } as RequestInit);
}

/**
 * Whether the error is the failure of the agent's lookup to find a live
 * grant for the hostname.
 */
function isNoValidatedAddress(error: unknown): boolean {
  return error instanceof TypeError && error.cause instanceof UrlError &&
    error.cause.message.startsWith("No validated address to connect to:");
}

/** Responds without keeping the connection alive. */
function respondAndClose(_: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Connection", "close");
  res.end("pinned");
}

test("createNodePinner() checks IP literal hostnames before fetching", {
  ignore: !isNode,
}, async () => {
  const { server, port, requests } = await startRecordingServer();
  try {
    // Connections to IP addresses do not go through the agent's lookup:
    const pinner = createNodePinner({
      verifyAddress: assertPublicAddress,
      undici: await import("undici"),
    });
    const url = new URL(`http://127.0.0.1:${port}/`);
    const grant = issuePinGrant(url, [ipv4("127.0.0.1")]);
    await rejects(() => pinner.fetch(grant, new Request(url)), UrlError);
    deepStrictEqual(requests, []);
  } finally {
    await closeServer(server);
  }
});

test("createNodePinner() connects only for live grants", {
  ignore: !isNode,
}, async () => {
  // Connections are not kept alive, so that every request through the agent
  // needs a lookup:
  const { server, port, requests } = await startRecordingServer(
    "127.0.0.1",
    respondAndClose,
  );
  try {
    const { pinner, agent } = await createPinnerWithAgent(allowAll);
    const url = new URL(`http://pinned-host.invalid:${port}/`);
    // No grant has been used yet:
    await rejects(() => fetchThrough(agent, url), isNoValidatedAddress);
    const grant = issuePinGrant(url, [ipv4("127.0.0.1")]);
    const response = await pinner.fetch(grant, new Request(url));
    deepStrictEqual(await response.text(), "pinned");
    // While the grant is live, the agent connects to its addresses, but only
    // for its hostname:
    deepStrictEqual(await (await fetchThrough(agent, url)).text(), "pinned");
    await rejects(
      () => fetchThrough(agent, `http://other-host.invalid:${port}/`),
      isNoValidatedAddress,
    );
    // A revoked grant no longer counts, even before it is released:
    revokePinGrant(grant);
    await rejects(() => pinner.fetch(grant, new Request(url)), TypeError);
    await rejects(() => fetchThrough(agent, url), isNoValidatedAddress);
    deepStrictEqual(requests.length, 2);
  } finally {
    await closeServer(server);
  }
});

test("createNodePinner() forgets released grants", {
  ignore: !isNode,
}, async () => {
  const { server, port, requests } = await startRecordingServer(
    "127.0.0.1",
    respondAndClose,
  );
  try {
    const { pinner, agent } = await createPinnerWithAgent(allowAll);
    const url = new URL(`http://pinned-host.invalid:${port}/`);
    const grants = [
      issuePinGrant(url, [ipv4("127.0.0.1")]),
      issuePinGrant(url, [ipv4("127.0.0.1")]),
    ];
    for (const grant of grants) {
      deepStrictEqual(
        await (await pinner.fetch(grant, new Request(url))).text(),
        "pinned",
      );
    }
    // Without revoking them, so that only the release removes them:
    await pinner.release(grants[0]);
    deepStrictEqual(await (await fetchThrough(agent, url)).text(), "pinned");
    await pinner.release(grants[1]);
    await rejects(() => fetchThrough(agent, url), isNoValidatedAddress);
    // Releasing again has no effect:
    await pinner.release(grants[1]);
    deepStrictEqual(requests.length, 3);
  } finally {
    await closeServer(server);
  }
});

test("createNodePinner() connects to the next address on failure", {
  ignore: !isNode,
}, async () => {
  // Skipped where IPv6 is unavailable:
  if (!(await getLoopbackSupport()).ipv6) return;
  // The server listens only on 127.0.0.1, so the first address, ::1, refuses
  // the connection.  Node.js tries the next address when connecting fails,
  // before anything is sent, so this applies to POST requests too:
  const { server, port, requests } = await startRecordingServer();
  try {
    const pinner = createNodePinner({
      ...allowAll,
      undici: await import("undici"),
    });
    const url = new URL(`http://pinned-host.invalid:${port}/`);
    const grant = issuePinGrant(url, [ipv6("::1"), ipv4("127.0.0.1")]);
    const response = await pinner.fetch(grant, new Request(url));
    deepStrictEqual(await response.text(), "pinned");
    const post = await pinner.fetch(
      grant,
      new Request(url, { method: "POST", body: "payload" }),
    );
    deepStrictEqual(await post.text(), "pinned");
    deepStrictEqual(
      requests.map(({ method, localAddress }) => [method, localAddress]),
      [["GET", "127.0.0.1"], ["POST", "127.0.0.1"]],
    );
  } finally {
    await closeServer(server);
  }
});

/**
 * Replaces the global `fetch()` while running the given function, as
 * fetch-mock does, but returns the given responses as they are, while
 * fetch-mock returns clones (tees) of them.
 */
async function withFetchStub<T>(
  respond: (init: unknown) => Response,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  // The options are unknown, since their type differs among runtimes (e.g.,
  // Cloudflare Workers types make RequestInit generic):
  globalThis.fetch = (_: unknown, init?: unknown) =>
    Promise.resolve(respond(init));
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("createNodePinner() forgets the grants of closed sessions", {
  ignore: !isNode,
}, async (t) => {
  for (const cancelFails of [false, true]) {
    await t.step(`cancelFails: ${cancelFails}`, async () => {
      // The session's address is public as openPublicFetch() requires, so
      // every address is refused when connecting; whether the agent's lookup
      // reaches the check shows whether the session's grant is live:
      const checked: string[] = [];
      const { pinner, agent } = await createPinnerWithAgent({
        verifyAddress({ address }) {
          checked.push(address);
          throw new UrlError(`Refused for the test: ${address}`);
        },
      });
      const released: PinGrant[] = [];
      const observed: ConnectionPinner = {
        supports: (url) => pinner.supports(url),
        fetch: (grant, request, signal) => pinner.fetch(grant, request, signal),
        async release(grant) {
          released.push(grant);
          await pinner.release(grant);
        },
      };
      const { openPublicFetch } = createPublicFetch({
        pinner: () => Promise.resolve(observed),
        lookup: () => Promise.reject(new Error("Not used.")),
      });
      const url = "http://pinned-host.invalid/";
      const session = await openPublicFetch(url, {
        lookup: (): Promise<readonly ResolvedAddress[]> =>
          Promise.resolve([ipv4("8.8.8.8")]),
      });
      const dispatchers: unknown[] = [];
      let cancelled = 0;
      const response = await withFetchStub(
        (init) => {
          dispatchers.push((init as { dispatcher?: unknown }).dispatcher);
          return new Response(
            new ReadableStream({
              cancel() {
                cancelled++;
                if (cancelFails) throw new Error("Failed to cancel.");
              },
            }),
          );
        },
        () => session.fetch(url),
      );
      deepStrictEqual(dispatchers, [agent]);
      // The session's grant is live:
      await rejects(
        () => fetchThrough(agent, url),
        (error) =>
          error instanceof TypeError && error.cause instanceof UrlError &&
          error.cause.message === "Refused for the test: 8.8.8.8",
      );
      deepStrictEqual(checked, ["8.8.8.8"]);
      ok(!response.bodyUsed);
      // Failures to cancel the body are only logged:
      await session.close();
      deepStrictEqual(cancelled, 1);
      deepStrictEqual(released.length, 1);
      // The agent fails closed without checking any address:
      await rejects(() => fetchThrough(agent, url), isNoValidatedAddress);
      deepStrictEqual(checked, ["8.8.8.8"]);
    });
  }
});

interface ChildResult {
  readonly status?: number;
  readonly body?: string;
  readonly error?: string;
}

interface ProxyChildOutput {
  readonly version: string;
  readonly http: ChildResult;
  readonly https: ChildResult;
  readonly control: ChildResult;
}

test("createNodePinner() bypasses environment proxies", {
  ignore: !isNode,
}, async (t) => {
  const major = Number(process.versions.node.split(".")[0]);
  const names = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] as const;
  // NODE_USE_ENV_PROXY=1 makes the global dispatcher read the proxy variables
  // since Node.js 24 (and some later 22.x versions), but the pinner always
  // passes its own dispatcher:
  for (const useEnvProxy of [false, true]) {
    await t.step(`NODE_USE_ENV_PROXY: ${useEnvProxy}`, async () => {
      const proxy = await startRecordingProxy({ refuseTunnels: true });
      // The HTTP origin server:
      const origin = await startRecordingServer();
      // The HTTPS target, which only counts connections since it has no
      // certificate:
      const tls = await startCountingServer();
      try {
        const proxyUrl = `http://127.0.0.1:${proxy.port}`;
        const output = await runChild<ProxyChildOutput>(
          resolveCompiledTestdata("node-child.mjs", import.meta.url),
          ["proxy", String(origin.port), String(tls.port)],
          {
            ...Object.fromEntries(names.map((name) => [name, proxyUrl])),
            ...(useEnvProxy ? { NODE_USE_ENV_PROXY: "1" } : {}),
          },
        );
        const targets = JSON.stringify(proxy.targets);
        deepStrictEqual(output.version, process.version);
        // The control request is sent either in absolute form or through
        // a tunnel, depending on the Node.js version:
        const controlTargets = [
          `GET http://127.0.0.1:${origin.port}/control`,
          `CONNECT 127.0.0.1:${origin.port}`,
        ];
        if (useEnvProxy && major >= 24) {
          ok(
            proxy.targets.some((target) => controlTargets.includes(target)),
            targets,
          );
        }
        // Pinned requests never reach the proxy, and connect directly to
        // the pinned address:
        deepStrictEqual(
          proxy.targets.filter((target) => !controlTargets.includes(target)),
          [],
          targets,
        );
        deepStrictEqual(output.http, { status: 200, body: "pinned" });
        deepStrictEqual(
          origin.requests
            .filter(({ url }) => url === "/pinned")
            .map(({ host }) => host),
          [`pinned-host.invalid:${origin.port}`],
        );
        // The HTTPS target has no certificate:
        ok(output.https.error != null, JSON.stringify(output.https));
        deepStrictEqual(tls.counter.connections, 1);
      } finally {
        await closeServer(proxy.server);
        await closeServer(origin.server);
        await closeServer(tls.server);
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

test("createNodePinner() verifies certificates against the hostname", {
  ignore: !isNode,
}, async () => {
  const certPath = resolveTestdata("tls-cert.pem", import.meta.url);
  const hosts: string[] = [];
  const server = createHttpsServer({
    cert: readFileSync(certPath),
    key: readFileSync(resolveTestdata("tls-key.pem", import.meta.url)),
  }, (req, res) => {
    hosts.push(req.headers.host ?? "");
    res.end(req.headers.host);
  });
  const port = await listen(server);
  try {
    // tls-cert.pem is self-signed for pinned-host.invalid and
    // alternate-host.invalid, and is trusted only by the child process:
    const output = await runChild<TlsChildOutput>(
      resolveCompiledTestdata("node-child.mjs", import.meta.url),
      ["tls", String(port)],
      { NODE_EXTRA_CA_CERTS: certPath },
    );
    deepStrictEqual(output.version, process.version);
    deepStrictEqual(output.results, [
      { case: "pinned", status: 200, body: `pinned-host.invalid:${port}` },
      { case: "unlisted", error: "ERR_TLS_CERT_ALTNAME_INVALID" },
      { case: "unlisted-again", error: "ERR_TLS_CERT_ALTNAME_INVALID" },
      {
        case: "alternate",
        status: 200,
        body: `alternate-host.invalid:${port}`,
      },
      { case: "signals", status: 200, body: `pinned-host.invalid:${port}` },
    ], JSON.stringify(output.results));
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
