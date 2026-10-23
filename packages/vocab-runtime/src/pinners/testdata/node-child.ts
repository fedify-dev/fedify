/**
 * A child process for the regression tests of the Node.js pinner in
 * *../node.test.ts* that depend on the environment at startup: Node.js reads
 * proxy environment variables (with `NODE_USE_ENV_PROXY=1`) and
 * `NODE_EXTRA_CA_CERTS` only at startup.
 *
 * Node.js cannot run TypeScript sources without flags before 22.6.0, so
 * *../../../tsdown.config.ts* compiles this script into
 * *dist/tests/pinners/testdata/node-child.mjs*, which the tests run.  It has
 * no top-level `await`, so that it can be compiled to CommonJS as well.
 *
 * Usage:
 *
 *  -  `node node-child.mjs proxy <http-port> <https-port>`: requests
 *     `http://pinned-host.invalid:<http-port>/pinned` and
 *     `https://pinned-host.invalid:<https-port>/pinned` through a pinner
 *     that allows loopback addresses, with both pinned to 127.0.0.1, and then
 *     `http://127.0.0.1:<http-port>/control` with the global `fetch()` as
 *     a control.
 *  -  `node node-child.mjs tls <https-port>`: requests
 *     `https://<hostname>:<https-port>/<case>` through a pinner that allows
 *     loopback addresses, with every hostname pinned to 127.0.0.1, in the same
 *     order as *tls-child.ts* does for Bun.
 *
 * It prints the results as a JSON line.
 * @module
 */
import process from "node:process";
import { issuePinGrant } from "../../pin-grant.ts";
import { createNodePinner } from "../node.ts";
import type { ConnectionPinner } from "../types.ts";

type Result =
  | { readonly status: number; readonly body: string }
  | { readonly error: string };

const loopback = [{ address: "127.0.0.1", family: 4 }] as const;

/**
 * Describes an error by its code, or by the code of its cause, since
 * the `fetch()` of Node.js rejects with a `TypeError` caused by the actual
 * error.
 */
function describeError(error: unknown): string {
  for (let e = error; typeof e === "object" && e !== null;) {
    const { code, cause } = e as { code?: unknown; cause?: unknown };
    if (typeof code === "string") return code;
    e = cause;
  }
  return String(error);
}

async function attempt(fn: () => Promise<Response>): Promise<Result> {
  try {
    const response = await fn();
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { error: describeError(error) };
  }
}

function fetchPinned(
  pinner: ConnectionPinner,
  url: URL,
  withSignals = false,
): Promise<Result> {
  const grant = issuePinGrant(url, loopback);
  return attempt(() =>
    withSignals
      ? pinner.fetch(
        grant,
        new Request(url, { signal: new AbortController().signal }),
        new AbortController().signal,
      )
      : pinner.fetch(grant, new Request(url))
  );
}

async function proxy(
  pinner: ConnectionPinner,
  httpPort: number,
  httpsPort: number,
): Promise<unknown> {
  const http = await fetchPinned(
    pinner,
    new URL(`http://pinned-host.invalid:${httpPort}/pinned`),
  );
  const https = await fetchPinned(
    pinner,
    new URL(`https://pinned-host.invalid:${httpsPort}/pinned`),
  );
  // Without a dispatcher, so that it shows whether the proxy is in effect:
  const control = await attempt(() =>
    fetch(`http://127.0.0.1:${httpPort}/control`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    })
  );
  return { version: process.version, http, https, control };
}

async function tls(pinner: ConnectionPinner, port: number): Promise<unknown> {
  const results: ({ readonly case: string } & Result)[] = [];
  for (
    const [name, hostname, withSignals] of [
      ["pinned", "pinned-host.invalid", false],
      ["unlisted", "unlisted-host.invalid", false],
      ["unlisted-again", "unlisted-host.invalid", false],
      ["alternate", "alternate-host.invalid", false],
      ["signals", "pinned-host.invalid", true],
    ] as const
  ) {
    const url = new URL(`https://${hostname}:${port}/${name}`);
    results.push({
      case: name,
      ...await fetchPinned(pinner, url, withSignals),
    });
  }
  return { version: process.version, results };
}

async function main(): Promise<unknown> {
  const [mode, ...ports] = process.argv.slice(2);
  const [first, second] = ports.map(Number);
  const pinner = createNodePinner({
    verifyAddress() {},
    undici: await import("undici"),
  });
  if (mode === "proxy" && Number.isInteger(first) && Number.isInteger(second)) {
    return await proxy(pinner, first, second);
  } else if (mode === "tls" && Number.isInteger(first)) {
    return await tls(pinner, first);
  }
  throw new TypeError(
    "Usage: node-child.mjs proxy <http-port> <https-port> | " +
      "node-child.mjs tls <https-port>",
  );
}

main().then(
  (output) =>
    process.stdout.write(`${JSON.stringify(output)}\n`, () => process.exit(0)),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
