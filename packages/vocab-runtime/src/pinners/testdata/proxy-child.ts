/**
 * A child process for the environment proxy regression test of the Bun
 * pinner in *../bun.test.ts*.  Bun reads proxy environment variables only at
 * startup in older versions, so the test runs this script in a new Bun
 * process with the variables set.
 *
 * Usage: `bun proxy-child.ts <http-port> <https-port>`
 *
 * It requests `http://pinned-host.invalid:<http-port>/pinned` and
 * `https://pinned-host.invalid:<https-port>/pinned` through a pinner that
 * allows loopback addresses, with both pinned to 127.0.0.1, and then
 * `http://127.0.0.1:<http-port>/control` with the global `fetch()` as a
 * control.  It prints the results as a JSON line.
 * @module
 */
import { configure, type LogRecord } from "@logtape/logtape";
import process from "node:process";
import { issuePinGrant } from "../../pin-grant.ts";
import { createBunPinner } from "../bun.ts";

type Result =
  | { readonly status: number; readonly body: string }
  | { readonly error: string };

async function attempt(fn: () => Promise<Response>): Promise<Result> {
  try {
    const response = await fn();
    return { status: response.status, body: await response.text() };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { error: typeof code === "string" ? code : String(error) };
  }
}

const [httpPort, httpsPort] = process.argv.slice(2).map(Number);
if (!Number.isInteger(httpPort) || !Number.isInteger(httpsPort)) {
  throw new TypeError("Usage: proxy-child.ts <http-port> <https-port>");
}

const warnings: LogRecord[] = [];
await configure({
  sinks: { buffer: (record) => warnings.push(record) },
  loggers: [
    {
      category: ["fedify", "runtime", "fetch"],
      sinks: ["buffer"],
      lowestLevel: "warning",
    },
    { category: ["logtape", "meta"], sinks: [] },
  ],
});

const pinner = createBunPinner({ verifyAddress() {} });
const loopback = [{ address: "127.0.0.1", family: 4 }] as const;

async function fetchPinned(url: URL): Promise<Result> {
  const grant = issuePinGrant(url, loopback);
  return await attempt(() => pinner.fetch(grant, new Request(url)));
}

const http = await fetchPinned(
  new URL(`http://pinned-host.invalid:${httpPort}/pinned`),
);
const https = await fetchPinned(
  new URL(`https://pinned-host.invalid:${httpsPort}/pinned`),
);
// Without proxy: false, so that it shows the proxy is in effect:
const control = await attempt(() =>
  fetch(`http://127.0.0.1:${httpPort}/control`, { redirect: "manual" })
);

const output = JSON.stringify({
  version: (globalThis as { Bun?: { version: string } }).Bun?.version,
  http,
  https,
  control,
  warnings: warnings.map((record) => record.rawMessage),
});
await new Promise<void>((resolve) =>
  process.stdout.write(`${output}\n`, () => resolve())
);
process.exit(0);
