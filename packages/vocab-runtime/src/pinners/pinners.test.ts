import { test } from "@fedify/fixture";
import { deepStrictEqual, ok, rejects } from "node:assert";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { issuePinGrant, type PinGrant, revokePinGrant } from "../pin-grant.ts";
import { assertPublicAddress, UrlError } from "../url.ts";
import { createBunPinner } from "./bun.ts";
import { createNodePinner } from "./node.ts";
import {
  allowAll,
  closeServer,
  getLoopbackSupport,
  ipv4,
  ipv6,
  isAddressRejection,
  isBun,
  isNode,
  listen,
  startRecordingServer,
} from "./testdata/support.ts";
import type { ConnectionPinner, ConnectionPinnerOptions } from "./types.ts";

interface PinnerUnderTest {
  readonly name: string;
  /** Whether real connections can be tested on the current runtime. */
  readonly connects: boolean;
  /**
   * Whether addresses are checked before the request is handed over to
   * the runtime's `fetch()`, so that the checks can be tested on any runtime.
   */
  readonly checksBeforeFetch: boolean;
  readonly create: (
    options: ConnectionPinnerOptions,
  ) => Promise<ConnectionPinner>;
}

/**
 * The pinners of all runtimes.  The behaviors they share are tested here, and
 * the ones specific to each runtime in *bun.test.ts* and *node.test.ts*.
 */
const pinners: readonly PinnerUnderTest[] = [
  {
    name: "createBunPinner()",
    connects: isBun,
    checksBeforeFetch: true,
    create: (options) => Promise.resolve(createBunPinner(options)),
  },
  {
    name: "createNodePinner()",
    connects: isNode,
    // The addresses are checked in the lookup of the undici agent:
    checksBeforeFetch: false,
    create: async (options) =>
      createNodePinner({ ...options, undici: await import("undici") }),
  },
];

for (const { name, connects, checksBeforeFetch, create } of pinners) {
  test(`${name} supports only HTTP and HTTPS`, async () => {
    const pinner = await create(allowAll);
    ok(pinner.supports(new URL("http://pinned-host.invalid/")));
    ok(pinner.supports(new URL("https://pinned-host.invalid/")));
    ok(!pinner.supports(new URL("ftp://pinned-host.invalid/")));
    ok(!pinner.supports(new URL("ws://pinned-host.invalid/")));
  });

  test(`${name} checks addresses right before connecting`, {
    ignore: !connects && !checksBeforeFetch,
  }, async () => {
    const { server, port, requests } = await startRecordingServer();
    try {
      // The production check, with a grant for a private address that
      // openPublicFetch() would never issue:
      const pinner = await create({ verifyAddress: assertPublicAddress });
      const url = new URL(`http://pinned-host.invalid:${port}/`);
      const grant = issuePinGrant(url, [ipv4("127.0.0.1")]);
      for (const method of ["GET", "POST"]) {
        await rejects(
          () => pinner.fetch(grant, new Request(url, { method })),
          isAddressRejection,
        );
      }
      deepStrictEqual(requests, []);
    } finally {
      await closeServer(server);
    }
  });

  test(`${name} does not fall back past a failed check`, {
    ignore: !connects && !checksBeforeFetch,
  }, async () => {
    const { server, port, requests } = await startRecordingServer();
    try {
      const checked: string[] = [];
      const pinner = await create({
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
      await rejects(
        () => pinner.fetch(grant, new Request(url)),
        isAddressRejection,
      );
      deepStrictEqual(checked, ["192.0.2.1"]);
      deepStrictEqual(requests, []);
    } finally {
      await closeServer(server);
    }
  });

  test(`${name} redeems the grant for every request`, async () => {
    const { server, port, requests } = await startRecordingServer();
    try {
      const pinner = await create(allowAll);
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

  test(`${name} connects to the pinned address`, {
    ignore: !connects,
  }, async () => {
    const { server, port, requests } = await startRecordingServer();
    try {
      const pinner = await create(allowAll);
      // The .invalid TLD never resolves, so a response proves that the
      // connection went to the pinned address without a DNS lookup:
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

  test(`${name} does not follow redirects`, {
    ignore: !connects,
  }, async () => {
    const { server, port, requests } = await startRecordingServer(
      "127.0.0.1",
      (_, res) => {
        res.writeHead(302, { Location: "/target" });
        res.end();
      },
    );
    try {
      const pinner = await create(allowAll);
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

  test(`${name} aborts requests on either signal`, {
    ignore: !connects,
  }, async () => {
    // The server never responds, so only an abort ends the request:
    let notifyReceived = () => {};
    const server = createServer(() => notifyReceived());
    const port = await listen(server);
    try {
      const pinner = await create(allowAll);
      const url = new URL(`http://pinned-host.invalid:${port}/`);
      const grant = issuePinGrant(url, [ipv4("127.0.0.1")]);
      for (const which of ["request", "separate"] as const) {
        const requestController = new AbortController();
        const separateController = new AbortController();
        const received = new Promise<void>((resolve) =>
          notifyReceived = resolve
        );
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

  test(`${name} does not deliver a POST request twice`, {
    ignore: !connects,
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
      const pinner = await create(allowAll);
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
      // falls back here depends on the runtime: Bun 1.4 raises this
      // ECONNRESET as a TypeError, but Bun 1.2 does not.)  The first grant is
      // released, since the Node.js pinner connects to the addresses of all
      // live grants for the hostname:
      revokePinGrant(grant);
      await pinner.release(grant);
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
