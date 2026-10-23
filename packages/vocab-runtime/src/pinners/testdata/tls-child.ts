/**
 * A child process for the certificate verification regression test of the
 * Bun pinner in *../bun.test.ts*.  Bun reads `NODE_EXTRA_CA_CERTS` only at
 * startup, so the test runs this script in a new Bun process with it pointing
 * to *tls-cert.pem*, a self-signed certificate for `pinned-host.invalid` and
 * `alternate-host.invalid`.
 *
 * Usage: `bun tls-child.ts <https-port>`
 *
 * It requests `https://<hostname>:<https-port>/<case>` through a pinner that
 * allows loopback addresses, with every hostname pinned to 127.0.0.1, in this
 * order:
 *
 * 1.  `pinned`: `pinned-host.invalid`, which the certificate covers.
 * 2.  `unlisted`: `unlisted-host.invalid`, which the certificate does not
 *     cover.
 * 3.  `unlisted-again`: the same as `unlisted`, so that a connection kept
 *     after a failed check would be reused.
 * 4.  `alternate`: `alternate-host.invalid`, the second name of
 *     the certificate.
 * 5.  `signals`: `pinned-host.invalid` with signals both in the request and
 *     as the separate argument.
 *
 * It prints the results as a JSON line.
 * @module
 */
import process from "node:process";
import { issuePinGrant } from "../../pin-grant.ts";
import { createBunPinner } from "../bun.ts";

type TlsChildResult =
  | { readonly case: string; readonly status: number; readonly body: string }
  | { readonly case: string; readonly error: string };

const port = Number(process.argv[2]);
if (!Number.isInteger(port)) {
  throw new TypeError("Usage: tls-child.ts <https-port>");
}

const pinner = createBunPinner({ verifyAddress() {} });
const loopback = [{ address: "127.0.0.1", family: 4 }] as const;

async function attempt(
  name: string,
  hostname: string,
  withSignals = false,
): Promise<TlsChildResult> {
  const url = new URL(`https://${hostname}:${port}/${name}`);
  const grant = issuePinGrant(url, loopback);
  try {
    const response = withSignals
      ? await pinner.fetch(
        grant,
        new Request(url, { signal: new AbortController().signal }),
        new AbortController().signal,
      )
      : await pinner.fetch(grant, new Request(url));
    return { case: name, status: response.status, body: await response.text() };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return {
      case: name,
      error: typeof code === "string" ? code : String(error),
    };
  }
}

const results: TlsChildResult[] = [];
for (
  const [name, hostname] of [
    ["pinned", "pinned-host.invalid"],
    ["unlisted", "unlisted-host.invalid"],
    ["unlisted-again", "unlisted-host.invalid"],
    ["alternate", "alternate-host.invalid"],
  ] as const
) {
  results.push(await attempt(name, hostname));
}
results.push(await attempt("signals", "pinned-host.invalid", true));

const output = JSON.stringify({
  version: (globalThis as { Bun?: { version: string } }).Bun?.version,
  results,
});
await new Promise<void>((resolve) =>
  process.stdout.write(`${output}\n`, () => resolve())
);
process.exit(0);
