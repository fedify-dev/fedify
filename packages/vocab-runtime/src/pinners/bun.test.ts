import { test } from "@fedify/fixture";
import { deepStrictEqual, ok, rejects } from "node:assert";
import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { issuePinGrant } from "../pin-grant.ts";
import { createBunPinner } from "./bun.ts";
import {
  allowAll,
  closeServer,
  getLoopbackSupport,
  ipv4,
  ipv6,
  isBun,
  listen,
  resolveTestdata,
  runChild,
  startCountingServer,
  startRecordingProxy,
  startRecordingServer,
} from "./testdata/support.ts";

// The behaviors that the Bun pinner shares with the other pinners are tested
// in pinners.test.ts.

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
    resolveTestdata("proxy-child.ts", import.meta.url),
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
      const tls = await startCountingServer();
      try {
        const proxyUrl = `http://127.0.0.1:${proxy.port}`;
        const output = await runProxyChild(
          Object.fromEntries(names.map((name) => [name, proxyUrl])),
          origin.port,
          tls.port,
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
          deepStrictEqual(tls.counter.connections, refusesHttps ? 0 : 1);
        } else {
          // Older Bun versions ignore proxy: false, so pinned requests go
          // through the proxy, but with the pinned address as the target:
          deepStrictEqual(pinnedTargets, [
            `GET http://127.0.0.1:${origin.port}/pinned`,
            ...(refusesHttps ? [] : [`CONNECT 127.0.0.1:${tls.port}`]),
          ]);
          deepStrictEqual(output.http, { status: 200, body: "via-proxy" });
          deepStrictEqual(origin.requests, []);
          deepStrictEqual(tls.counter.connections, 0);
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

test("createBunPinner() verifies certificates on non-default ports", {
  ignore: !isBun,
}, async () => {
  const bun = getBun();
  // Bun versions before 1.3.11 cannot verify certificates against
  // the original hostname on non-default ports, so the pinner refuses such
  // requests there.  (A custom checkServerIdentity fails only after these
  // versions have sent the whole request, which the server would receive.)
  const refuses = refusesNonDefaultHttpsPorts();
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
      resolveTestdata("tls-child.ts", import.meta.url),
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
