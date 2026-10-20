import { test } from "@fedify/fixture";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import fetchMock from "fetch-mock";
import { deepStrictEqual, ok, rejects, strictEqual, throws } from "node:assert";
import type { LookupAddress } from "node:dns";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type PinGrant, redeemPinGrant } from "./pin-grant.ts";
import type { ConnectionPinner } from "./pinners/mod.ts";
import {
  createPublicFetch,
  openDirectFetch,
  openPublicFetch,
  type PublicFetchSession,
} from "./public-fetch.ts";
import { UrlError } from "./url.ts";

interface PinnedCall {
  readonly url: string;
  readonly method: string;
  readonly redirect: RequestRedirect;
  readonly addresses: readonly LookupAddress[];
}

function createRecordingPinner(
  respond: (request: Request, index: number) => Response | Promise<Response> =
    () => new Response("ok"),
) {
  const calls: PinnedCall[] = [];
  const grants: PinGrant[] = [];
  const released: PinGrant[] = [];
  let releaseError: unknown;
  const pinner: ConnectionPinner = {
    supports(url) {
      return url.protocol === "http:" || url.protocol === "https:";
    },
    async fetch(grant, request) {
      const { addresses } = redeemPinGrant(grant, new URL(request.url));
      grants.push(grant);
      const index = calls.length;
      calls.push({
        url: request.url,
        method: request.method,
        redirect: request.redirect,
        addresses,
      });
      return await respond(request, index);
    },
    release(grant) {
      released.push(grant);
      if (releaseError != null) throw releaseError;
    },
  };
  return {
    pinner,
    calls,
    grants,
    released,
    failRelease(error: unknown) {
      releaseError = error;
    },
  };
}

type LookupResult = readonly LookupAddress[] | Error;

function createRecordingLookup(...results: LookupResult[]) {
  const hostnames: string[] = [];
  function lookup(hostname: string): Promise<readonly LookupAddress[]> {
    hostnames.push(hostname);
    const result = results[Math.min(hostnames.length, results.length) - 1];
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result);
  }
  return { lookup, hostnames };
}

const publicAddresses: readonly LookupAddress[] = [
  { address: "8.8.8.8", family: 4 },
];

function failingLookup(): Promise<readonly LookupAddress[]> {
  return Promise.reject(new Error("The default lookup must not be used."));
}

function createTrackedBody(
  options: { text?: string; cancelError?: Error } = {},
) {
  const state = { cancelled: 0, cancelReasons: [] as unknown[] };
  let sent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) {
        controller.close();
        return;
      }
      sent = true;
      controller.enqueue(new TextEncoder().encode(options.text ?? "body"));
    },
    cancel(reason) {
      state.cancelled++;
      state.cancelReasons.push(reason);
      if (options.cancelError != null) throw options.cancelError;
    },
  });
  return { stream, state };
}

async function captureLogs<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; records: LogRecord[] }> {
  const records: LogRecord[] = [];
  await configure({
    sinks: { buffer: (record) => records.push(record) },
    loggers: [
      {
        category: ["fedify", "runtime", "fetch"],
        sinks: ["buffer"],
        lowestLevel: "debug",
      },
      { category: ["logtape", "meta"], sinks: [] },
    ],
    reset: true,
  });
  try {
    const result = await fn();
    return { result, records };
  } finally {
    await reset();
  }
}

/**
 * Waits until the rejections of body cancellations started without being
 * awaited have been handled.
 */
function settleCancellations(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Fails instead of blocking the test if the given promise does not settle
 * within the given time.
 */
async function settlesWithin<T>(
  promise: Promise<T>,
  milliseconds = 1000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Did not settle in ${milliseconds} ms.`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function cancelFailureLogs(
  records: readonly LogRecord[],
): [string, unknown, unknown][] {
  return records
    .filter((record) =>
      record.rawMessage ===
        "Failed to cancel a response body from {url}: {error}"
    )
    .map((record) => [
      record.level,
      record.properties.url,
      record.properties.error,
    ]);
}

async function withMockedGlobalFetch<T>(
  fn: () => Promise<T>,
): Promise<T> {
  fetchMock.mockGlobal();
  try {
    return await fn();
  } finally {
    fetchMock.hardReset();
  }
}

async function listen(server: Server, host = "127.0.0.1"): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  return (server.address() as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("openPublicFetch() pins IP literal hostnames without lookups", async () => {
  const { lookup, hostnames } = createRecordingLookup(publicAddresses);
  const recorder = createRecordingPinner();
  const { openPublicFetch } = createPublicFetch({
    pinner: () => Promise.resolve(recorder.pinner),
    lookup: failingLookup,
  });
  for (
    const [url, address] of [
      ["https://8.8.8.8/", { address: "8.8.8.8", family: 4 }],
      [
        "https://[2001:4860:4860::8888]:8443/",
        { address: "2001:4860:4860::8888", family: 6 },
      ],
    ] as const
  ) {
    const session = await openPublicFetch(url, { lookup });
    try {
      const response = await session.fetch(url);
      deepStrictEqual(await response.text(), "ok");
    } finally {
      await session.close();
    }
    deepStrictEqual(recorder.calls.at(-1)?.addresses, [address]);
  }
  deepStrictEqual(hostnames, []);
});

test("openPublicFetch() pins the addresses the lookup returned", async () => {
  const { lookup, hostnames } = createRecordingLookup([
    { address: "8.8.8.8", family: 4 },
    // CNAME entries, as returned by Cloudflare Workers, are skipped:
    { address: "cname-target.invalid", family: 0 } as LookupAddress,
    { address: "2001:4860:4860::8888", family: 6 },
  ]);
  const recorder = createRecordingPinner();
  const { openPublicFetch } = createPublicFetch({
    pinner: () => Promise.resolve(recorder.pinner),
    lookup: failingLookup,
  });
  const session = await openPublicFetch(
    "https://PINNED-HOST.invalid/object",
    { lookup },
  );
  try {
    deepStrictEqual(session.url.href, "https://pinned-host.invalid/object");
    // The URL is a copy:
    session.url.pathname = "/changed";
    deepStrictEqual(session.url.href, "https://pinned-host.invalid/object");
    const response = await session.fetch("https://pinned-host.invalid/object");
    deepStrictEqual(await response.text(), "ok");
  } finally {
    await session.close();
  }
  deepStrictEqual(hostnames, ["pinned-host.invalid"]);
  deepStrictEqual(recorder.calls, [{
    url: "https://pinned-host.invalid/object",
    method: "GET",
    redirect: "manual",
    addresses: [
      { address: "8.8.8.8", family: 4 },
      { address: "2001:4860:4860::8888", family: 6 },
    ],
  }]);
  deepStrictEqual(recorder.released, recorder.grants.slice(0, 1));
});

test("openPublicFetch() uses the default lookup without options", async () => {
  const { lookup, hostnames } = createRecordingLookup(publicAddresses);
  const recorder = createRecordingPinner();
  const { openPublicFetch } = createPublicFetch({
    pinner: () => Promise.resolve(recorder.pinner),
    lookup,
  });
  const session = await openPublicFetch("https://pinned-host.invalid/");
  await session.close();
  deepStrictEqual(hostnames, ["pinned-host.invalid"]);
});

test("openPublicFetch() rejects disallowed URLs", async (t) => {
  const cases: readonly {
    readonly name: string;
    readonly url: string;
    readonly lookup?: LookupResult;
    readonly reason: UrlError["reason"];
  }[] = [
    {
      name: "protocol",
      url: "ftp://pinned-host.invalid/",
      reason: "disallowed",
    },
    { name: "localhost", url: "https://localhost/", reason: "disallowed" },
    { name: "IPv4 loopback", url: "https://127.0.0.1/", reason: "disallowed" },
    { name: "IPv6 loopback", url: "https://[::1]/", reason: "disallowed" },
    {
      name: "IPv4-mapped IPv6",
      url: "https://[::ffff:7f00:1]/",
      reason: "disallowed",
    },
    {
      name: "credentials",
      url: "https://user:password@pinned-host.invalid/",
      lookup: publicAddresses,
      reason: "disallowed",
    },
    {
      name: "username",
      url: "https://user@pinned-host.invalid/",
      lookup: publicAddresses,
      reason: "disallowed",
    },
    {
      name: "private lookup result",
      url: "https://pinned-host.invalid/",
      lookup: [{ address: "10.0.0.1", family: 4 }],
      reason: "disallowed",
    },
    {
      name: "mixed lookup result",
      url: "https://pinned-host.invalid/",
      lookup: [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
      reason: "disallowed",
    },
    {
      name: "mixed IPv6 lookup result",
      url: "https://pinned-host.invalid/",
      lookup: [
        { address: "2001:4860:4860::8888", family: 6 },
        { address: "fd00::1", family: 6 },
      ],
      reason: "disallowed",
    },
    {
      name: "lookup failure",
      url: "https://pinned-host.invalid/",
      lookup: Object.assign(new Error("getaddrinfo ENOTFOUND"), {
        code: "ENOTFOUND",
      }),
      reason: "dns",
    },
    {
      name: "empty lookup result",
      url: "https://pinned-host.invalid/",
      lookup: [],
      reason: "dns",
    },
    {
      name: "CNAME-only lookup result",
      url: "https://pinned-host.invalid/",
      lookup: [{ address: "cname-target.invalid", family: 0 }],
      reason: "dns",
    },
  ];
  for (const { name, url, lookup: result, reason } of cases) {
    await t.step(name, async () => {
      const { lookup } = createRecordingLookup(result ?? publicAddresses);
      const recorder = createRecordingPinner();
      let pinnerRequested = 0;
      const { openPublicFetch } = createPublicFetch({
        pinner: () => {
          pinnerRequested++;
          return Promise.resolve(recorder.pinner);
        },
        lookup: failingLookup,
      });
      await withMockedGlobalFetch(async () => {
        fetchMock.catch(500);
        await rejects(
          () => openPublicFetch(url, { lookup }),
          (error) => {
            ok(error instanceof UrlError, String(error));
            deepStrictEqual(error.reason, reason);
            return true;
          },
        );
        deepStrictEqual(fetchMock.callHistory.calls(), []);
      });
      deepStrictEqual(pinnerRequested, 0);
      deepStrictEqual(recorder.calls, []);
      deepStrictEqual(recorder.released, []);
    });
  }
});

test("openPublicFetch() resists DNS rebinding", async () => {
  // The first lookup returns a public address, and every later one returns
  // a private address, as a rebinding DNS server would:
  const { lookup, hostnames } = createRecordingLookup(
    [{ address: "8.8.8.8", family: 4 }],
    [{ address: "127.0.0.1", family: 4 }],
  );
  const recorder = createRecordingPinner();
  const { openPublicFetch, withPublicFetch } = createPublicFetch({
    pinner: () => Promise.resolve(recorder.pinner),
    lookup: failingLookup,
  });
  const session = await openPublicFetch("https://rebinding.invalid/", {
    lookup,
  });
  try {
    for (
      const input of [
        "https://rebinding.invalid/a",
        new URL("https://rebinding.invalid/b"),
        new Request("https://rebinding.invalid/c", { method: "POST" }),
        "https://rebinding.invalid/a",
      ]
    ) {
      const response = await session.fetch(input);
      await response.body?.cancel();
    }
  } finally {
    await session.close();
  }
  deepStrictEqual(hostnames, ["rebinding.invalid"]);
  deepStrictEqual(
    recorder.calls.map(({ url, method, addresses }) => [
      url,
      method,
      addresses,
    ]),
    [
      ["https://rebinding.invalid/a", "GET", [{
        address: "8.8.8.8",
        family: 4,
      }]],
      ["https://rebinding.invalid/b", "GET", [{
        address: "8.8.8.8",
        family: 4,
      }]],
      ["https://rebinding.invalid/c", "POST", [{
        address: "8.8.8.8",
        family: 4,
      }]],
      ["https://rebinding.invalid/a", "GET", [{
        address: "8.8.8.8",
        family: 4,
      }]],
    ],
  );
  // All requests of the session share a single grant:
  deepStrictEqual(new Set(recorder.grants).size, 1);

  // A new session looks the hostname up again, and rejects the private
  // address:
  await rejects(
    () =>
      withPublicFetch(
        "https://rebinding.invalid/",
        () => Promise.reject(new Error("must not be called")),
        { lookup },
      ),
    UrlError,
  );
  deepStrictEqual(hostnames, ["rebinding.invalid", "rebinding.invalid"]);
  deepStrictEqual(recorder.calls.length, 4);
});

test("PublicFetchSession.fetch() rejects other origins", async () => {
  const { lookup } = createRecordingLookup(publicAddresses);
  const recorder = createRecordingPinner();
  const { openPublicFetch } = createPublicFetch({
    pinner: () => Promise.resolve(recorder.pinner),
    lookup: failingLookup,
  });
  const session = await openPublicFetch("https://pinned-host.invalid/a", {
    lookup,
  });
  try {
    for (
      const input of [
        "http://pinned-host.invalid/a",
        "https://pinned-host.invalid:8443/a",
        "https://other-host.invalid/a",
        "https://8.8.8.8/a",
        new URL("https://other-host.invalid/a"),
        new Request("https://other-host.invalid/a"),
      ]
    ) {
      await rejects(() => session.fetch(input), TypeError, String(input));
    }
    deepStrictEqual(recorder.calls, []);
    // Other paths and queries of the same origin are allowed:
    const response = await session.fetch("https://pinned-host.invalid/b?c");
    await response.body?.cancel();
    deepStrictEqual(
      recorder.calls.map(({ url }) => url),
      ["https://pinned-host.invalid/b?c"],
    );
  } finally {
    await session.close();
  }
});

test("PublicFetchSession.fetch() never follows redirects", async (t) => {
  await t.step("pinned", async () => {
    const { lookup } = createRecordingLookup(publicAddresses);
    const recorder = createRecordingPinner(() =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://pinned-host.invalid/target" },
      })
    );
    const { openPublicFetch } = createPublicFetch({
      pinner: () => Promise.resolve(recorder.pinner),
      lookup: failingLookup,
    });
    const session = await openPublicFetch("https://pinned-host.invalid/", {
      lookup,
    });
    try {
      const url = "https://pinned-host.invalid/";
      for (
        const [input, init] of [
          [url, undefined],
          [url, { redirect: "follow" }],
          [url, { redirect: "error" }],
          [new Request(url), undefined],
          [new Request(url, { redirect: "follow" }), undefined],
          [new Request(url), { redirect: "follow" }],
        ] as const
      ) {
        const response = await session.fetch(input, init);
        deepStrictEqual(response.status, 302);
      }
    } finally {
      await session.close();
    }
    deepStrictEqual(
      recorder.calls.map(({ redirect }) => redirect),
      Array(6).fill("manual"),
    );
  });

  await t.step("unpinned", async () => {
    const { lookup } = createRecordingLookup(publicAddresses);
    const { openPublicFetch } = createPublicFetch({
      pinner: () => Promise.resolve(null),
      lookup: failingLookup,
    });
    await withMockedGlobalFetch(async () => {
      fetchMock.route("https://unpinned-host.invalid/", 200);
      const session = await openPublicFetch("https://unpinned-host.invalid/", {
        lookup,
      });
      try {
        await session.fetch("https://unpinned-host.invalid/", {
          redirect: "follow",
        });
        await session.fetch(
          new Request("https://unpinned-host.invalid/", { redirect: "follow" }),
        );
      } finally {
        await session.close();
      }
      const calls = fetchMock.callHistory.calls();
      deepStrictEqual(calls.length, 2);
      for (const call of calls) {
        deepStrictEqual((call.args[1] as RequestInit).redirect, "manual");
      }
    });
  });

  await t.step("real server", async () => {
    let hits = 0;
    const server = createServer((_, res) => {
      hits++;
      res.writeHead(302, { Location: "/target" });
      res.end("redirect");
    });
    const port = await listen(server);
    try {
      const url = `http://127.0.0.1:${port}/`;
      const session = await openDirectFetch(url);
      try {
        const response = await session.fetch(url, { redirect: "follow" });
        deepStrictEqual(response.status, 302);
        deepStrictEqual(response.headers.get("Location"), "/target");
        await response.body?.cancel();
      } finally {
        await session.close();
      }
      deepStrictEqual(hits, 1);
    } finally {
      await closeServer(server);
    }
  });
});

test("PublicFetchSession.close()", async () => {
  const bodies = [
    createTrackedBody(), // consumed
    createTrackedBody(), // left unconsumed
    createTrackedBody(), // locked by a reader
  ];
  const { lookup } = createRecordingLookup(publicAddresses);
  const recorder = createRecordingPinner((_, index) =>
    index < bodies.length
      ? new Response(bodies[index].stream)
      : new Response(null, { status: 204 })
  );
  const { openPublicFetch } = createPublicFetch({
    pinner: () => Promise.resolve(recorder.pinner),
    lookup: failingLookup,
  });
  const url = "https://pinned-host.invalid/";
  const session: PublicFetchSession = await openPublicFetch(url, { lookup });
  const consumed = await session.fetch(url);
  deepStrictEqual(await consumed.text(), "body");
  const unconsumed = await session.fetch(url);
  const locked = await session.fetch(url);
  const reader = locked.body!.getReader();
  const empty = await session.fetch(url);
  deepStrictEqual(empty.body, null);

  await session.close();
  deepStrictEqual(bodies.map(({ state }) => state.cancelled), [0, 1, 0]);
  ok(unconsumed.bodyUsed);
  deepStrictEqual(recorder.released, [recorder.grants[0]]);
  throws(() => redeemPinGrant(recorder.grants[0], new URL(url)), TypeError);
  await rejects(() => session.fetch(url), TypeError);
  deepStrictEqual(recorder.calls.length, 4);

  // Idempotent:
  await session.close();
  deepStrictEqual(recorder.released.length, 1);
  deepStrictEqual(bodies.map(({ state }) => state.cancelled), [0, 1, 0]);
  await reader.cancel();
});

test("PublicFetchSession.close() logs cancel failures without throwing", async (t) => {
  const url = "https://pinned-host.invalid/";

  function setUp(cancelErrors: readonly (Error | undefined)[]) {
    const bodies = cancelErrors.map((cancelError) =>
      createTrackedBody({ cancelError })
    );
    const { lookup } = createRecordingLookup(publicAddresses);
    const recorder = createRecordingPinner((_, index) =>
      new Response(bodies[index].stream)
    );
    const { openPublicFetch } = createPublicFetch({
      pinner: () => Promise.resolve(recorder.pinner),
      lookup: failingLookup,
    });
    return { bodies, recorder, lookup, openPublicFetch };
  }

  async function assertClosed(
    session: PublicFetchSession,
    recorder: ReturnType<typeof createRecordingPinner>,
  ): Promise<void> {
    deepStrictEqual(recorder.released.length, 1);
    for (const grant of recorder.grants) {
      strictEqual(grant, recorder.released[0]);
    }
    // The grant is revoked even if releasing it fails:
    throws(() => redeemPinGrant(recorder.released[0], new URL(url)), TypeError);
    await rejects(() => session.fetch(url), TypeError);
    // The second close() neither throws nor cleans up again:
    await session.close();
    deepStrictEqual(recorder.released.length, 1);
  }

  await t.step("two failures", async () => {
    const errors = [new Error("cancel 1"), new Error("cancel 2")];
    const { bodies, recorder, lookup, openPublicFetch } = setUp(errors);
    const { records } = await captureLogs(async () => {
      const session = await openPublicFetch(url, { lookup });
      await session.fetch(url);
      await session.fetch(url);
      await session.close();
      deepStrictEqual(bodies.map(({ state }) => state.cancelled), [1, 1]);
      await assertClosed(session, recorder);
      await settleCancellations();
    });
    deepStrictEqual(cancelFailureLogs(records), [
      ["debug", url, errors[0]],
      ["debug", url, errors[1]],
    ]);
  });

  await t.step("one failure", async () => {
    const error = new Error("cancel");
    const { bodies, recorder, lookup, openPublicFetch } = setUp([
      undefined,
      error,
    ]);
    const { records } = await captureLogs(async () => {
      const session = await openPublicFetch(url, { lookup });
      await session.fetch(url);
      await session.fetch(url);
      await session.close();
      deepStrictEqual(bodies.map(({ state }) => state.cancelled), [1, 1]);
      await assertClosed(session, recorder);
      await settleCancellations();
    });
    deepStrictEqual(cancelFailureLogs(records), [["debug", url, error]]);
  });

  await t.step("failure already seen by the caller", async () => {
    const error = new Error("cancel");
    const { bodies, recorder, lookup, openPublicFetch } = setUp([error]);
    const { records } = await captureLogs(async () => {
      const session = await openPublicFetch(url, { lookup });
      const response = await session.fetch(url);
      await rejects(() => response.body!.cancel(), (e) => e === error);
      // A body whose cancellation was attempted is disturbed, so close() does
      // not cancel it again:
      ok(response.bodyUsed);
      await session.close();
      deepStrictEqual(bodies[0].state.cancelled, 1);
      await assertClosed(session, recorder);
      await settleCancellations();
    });
    deepStrictEqual(cancelFailureLogs(records), []);
  });

  await t.step("release failure", async () => {
    const releaseError = new Error("release");
    const { recorder, lookup, openPublicFetch } = setUp([]);
    recorder.failRelease(releaseError);
    const session = await openPublicFetch(url, { lookup });
    await rejects(() => session.close(), (e) => e === releaseError);
    await assertClosed(session, recorder);
  });

  await t.step("cancel and release failures", async () => {
    const cancelError = new Error("cancel");
    const releaseError = new Error("release");
    const { bodies, recorder, lookup, openPublicFetch } = setUp([cancelError]);
    recorder.failRelease(releaseError);
    const { records } = await captureLogs(async () => {
      const session = await openPublicFetch(url, { lookup });
      await session.fetch(url);
      // Only the release error is thrown; the cancel error is only logged:
      await rejects(() => session.close(), (e) => e === releaseError);
      deepStrictEqual(bodies[0].state.cancelled, 1);
      await assertClosed(session, recorder);
      await settleCancellations();
    });
    deepStrictEqual(cancelFailureLogs(records), [["debug", url, cancelError]]);
  });
});

test("PublicFetchSession.close() does not wait for body cancellation", async (t) => {
  const url = "https://pinned-host.invalid/";

  async function assertCloseSettles(
    respond: () => Response,
  ): Promise<number> {
    const { lookup } = createRecordingLookup(publicAddresses);
    const recorder = createRecordingPinner(respond);
    const { openPublicFetch } = createPublicFetch({
      pinner: () => Promise.resolve(recorder.pinner),
      lookup: failingLookup,
    });
    const session = await openPublicFetch(url, { lookup });
    const response = await session.fetch(url);
    ok(!response.bodyUsed);
    await settlesWithin(session.close());
    ok(response.bodyUsed);
    deepStrictEqual(recorder.released.length, 1);
    throws(() => redeemPinGrant(recorder.grants[0], new URL(url)), TypeError);
    return recorder.calls.length;
  }

  await t.step("never-settling cancel", async () => {
    const cancelled: unknown[] = [];
    const calls = await assertCloseSettles(() =>
      new Response(
        new ReadableStream({
          cancel(reason) {
            cancelled.push(reason);
            return new Promise<void>(() => {});
          },
        }),
      )
    );
    deepStrictEqual(calls, 1);
    deepStrictEqual(cancelled.length, 1);
  });

  await t.step("tee branch", async () => {
    // The cancellation of a tee branch settles only after the other branch
    // is cancelled too, which never happens here:
    const originals: Response[] = [];
    const calls = await assertCloseSettles(() => {
      const original = new Response(createTrackedBody().stream);
      originals.push(original);
      return original.clone();
    });
    deepStrictEqual(calls, 1);
    ok(!originals[0].bodyUsed);
    await originals[0].body!.cancel();
  });

  await t.step("fetch-mock responses", async () => {
    // fetch-mock returns a clone (a tee branch) of a Response instance that
    // a route returns.  The cancellation of a string body's branch never
    // settles on Node.js, and that of a stream body's branch never settles on
    // any runtime:
    const { lookup } = createRecordingLookup(publicAddresses);
    const { openPublicFetch } = createPublicFetch({
      pinner: () => Promise.resolve(null),
      lookup: failingLookup,
    });
    await withMockedGlobalFetch(async () => {
      fetchMock.route(
        "https://unpinned-host.invalid/string",
        new Response("string"),
      );
      fetchMock.route(
        "https://unpinned-host.invalid/stream",
        () => new Response(createTrackedBody().stream),
      );
      fetchMock.route(
        "https://unpinned-host.invalid/redirect",
        () =>
          new Response(createTrackedBody().stream, {
            status: 302,
            headers: { Location: "https://unpinned-host.invalid/string" },
          }),
      );
      for (const path of ["string", "stream", "redirect"]) {
        const target = `https://unpinned-host.invalid/${path}`;
        const session = await openPublicFetch(target, { lookup });
        const response = await session.fetch(target);
        ok(!response.bodyUsed);
        await settlesWithin(session.close());
        ok(response.bodyUsed);
      }
      deepStrictEqual(fetchMock.callHistory.calls().length, 3);
    });
  });
});

test("PublicFetchSession.fetch() cancels responses arriving after close()", async (t) => {
  const url = "https://pinned-host.invalid/";

  async function assertCancelledAfterClose(
    response: Response,
  ): Promise<void> {
    let respond!: (response: Response) => void;
    const { lookup } = createRecordingLookup(publicAddresses);
    const recorder = createRecordingPinner(() =>
      new Promise<Response>((resolve) => respond = resolve)
    );
    const { openPublicFetch } = createPublicFetch({
      pinner: () => Promise.resolve(recorder.pinner),
      lookup: failingLookup,
    });
    const session = await openPublicFetch(url, { lookup });
    const pending = session.fetch(url);
    // Let the pinner receive the request:
    while (recorder.calls.length < 1) await Promise.resolve();
    await session.close();
    respond(response);
    await settlesWithin(rejects(() => pending, TypeError));
    ok(response.bodyUsed);
    deepStrictEqual(recorder.released.length, 1);
  }

  await t.step("cancellable body", async () => {
    const body = createTrackedBody();
    await assertCancelledAfterClose(new Response(body.stream));
    deepStrictEqual(body.state.cancelled, 1);
  });

  await t.step("never-settling cancel", async () => {
    let cancelled = 0;
    await assertCancelledAfterClose(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
            return new Promise<void>(() => {});
          },
        }),
      ),
    );
    deepStrictEqual(cancelled, 1);
  });

  await t.step("failing cancel", async () => {
    const error = new Error("cancel");
    const body = createTrackedBody({ cancelError: error });
    const { records } = await captureLogs(async () => {
      await assertCancelledAfterClose(new Response(body.stream));
      await settleCancellations();
    });
    deepStrictEqual(body.state.cancelled, 1);
    deepStrictEqual(cancelFailureLogs(records), [["debug", url, error]]);
  });
});

test("withPublicFetch()", async (t) => {
  const url = "https://pinned-host.invalid/";

  function setUp() {
    const bodies: ReturnType<typeof createTrackedBody>[] = [];
    const { lookup } = createRecordingLookup(publicAddresses);
    const recorder = createRecordingPinner(() => {
      const body = createTrackedBody();
      bodies.push(body);
      return new Response(body.stream);
    });
    const { withPublicFetch } = createPublicFetch({
      pinner: () => Promise.resolve(recorder.pinner),
      lookup: failingLookup,
    });
    return { bodies, recorder, lookup, withPublicFetch };
  }

  await t.step("returns the result", async () => {
    const { bodies, recorder, lookup, withPublicFetch } = setUp();
    const result = await withPublicFetch(
      url,
      async (fetch) => await (await fetch(url)).text(),
      { lookup },
    );
    deepStrictEqual(result, "body");
    deepStrictEqual(bodies.map(({ state }) => state.cancelled), [0]);
    deepStrictEqual(recorder.released.length, 1);
  });

  await t.step("closes the session when the callback throws", async () => {
    const { bodies, recorder, lookup, withPublicFetch } = setUp();
    const error = new Error("callback");
    let fetchInScope: PublicFetchSession["fetch"] | undefined;
    await rejects(
      () =>
        withPublicFetch(url, async (fetch) => {
          fetchInScope = fetch;
          await fetch(url);
          throw error;
        }, { lookup }),
      (e) => e === error,
    );
    deepStrictEqual(bodies.map(({ state }) => state.cancelled), [1]);
    deepStrictEqual(recorder.released.length, 1);
    await rejects(() => fetchInScope!(url), TypeError);
  });

  await t.step("rejects returning a Response", async () => {
    const { bodies, recorder, lookup, withPublicFetch } = setUp();
    await rejects(
      () => withPublicFetch(url, (fetch) => fetch(url), { lookup }),
      TypeError,
    );
    deepStrictEqual(bodies.map(({ state }) => state.cancelled), [1]);
    deepStrictEqual(recorder.released.length, 1);
  });

  await t.step("does not call the callback for disallowed URLs", async () => {
    const { recorder, withPublicFetch } = setUp();
    let called = false;
    await rejects(
      () =>
        withPublicFetch(url, () => {
          called = true;
          return Promise.resolve();
        }, {
          lookup: () => Promise.resolve([{ address: "10.0.0.1", family: 4 }]),
        }),
      UrlError,
    );
    ok(!called);
    deepStrictEqual(recorder.calls, []);
    deepStrictEqual(recorder.released, []);
  });
});

test("openPublicFetch() honors the abort signal", async () => {
  const recorder = createRecordingPinner();
  const { openPublicFetch } = createPublicFetch({
    pinner: () => Promise.resolve(recorder.pinner),
    lookup: failingLookup,
  });
  const url = "https://pinned-host.invalid/";

  const aborted = new AbortController();
  aborted.abort(new Error("aborted"));
  const before = createRecordingLookup(publicAddresses);
  await rejects(
    () => openPublicFetch(url, { signal: aborted.signal, ...before }),
    (e) => e === aborted.signal.reason,
  );
  deepStrictEqual(before.hostnames, []);

  const during = new AbortController();
  await rejects(
    () =>
      openPublicFetch(url, {
        signal: during.signal,
        lookup() {
          during.abort(new Error("aborted during lookup"));
          return Promise.resolve(publicAddresses);
        },
      }),
    (e) => e === during.signal.reason,
  );
  deepStrictEqual(recorder.calls, []);
  deepStrictEqual(recorder.released, []);
});

function withNavigatorUserAgent<T>(
  userAgent: string,
  fn: () => Promise<T>,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "userAgent");
  Object.defineProperty(navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
  const restore = () => {
    if (descriptor == null) {
      delete (navigator as { userAgent?: string }).userAgent;
    } else {
      Object.defineProperty(navigator, "userAgent", descriptor);
    }
  };
  return fn().finally(restore);
}

function isUnpinnedLog(record: LogRecord): boolean {
  return typeof record.rawMessage === "string" &&
    record.rawMessage.startsWith("Outbound {protocol} connections are not");
}

test("openPublicFetch() uses the global fetch() without a pinner", async () => {
  const { lookup, hostnames } = createRecordingLookup(publicAddresses);
  const unsupported = createRecordingPinner();
  unsupported.pinner.supports = () => false;
  const pinners: (ConnectionPinner | null)[] = [null, unsupported.pinner];
  const { openPublicFetch } = createPublicFetch({
    pinner: () => Promise.resolve(pinners[hostnames.length % 2]),
    lookup: failingLookup,
  });
  // Simulates Cloudflare Workers so that the runtime and protocol pairs of
  // the debug log are not used by any other test in the process:
  const { records } = await captureLogs(() =>
    withNavigatorUserAgent(
      "Cloudflare-Workers",
      () =>
        withMockedGlobalFetch(async () => {
          fetchMock.route("begin:https://unpinned-host.invalid/", "https");
          fetchMock.route("begin:http://unpinned-host.invalid/", "http");
          for (const protocol of ["https", "http", "https", "http", "https"]) {
            const url =
              `${protocol}://unpinned-host.invalid/${hostnames.length}`;
            const session = await openPublicFetch(url, { lookup });
            try {
              const response = await session.fetch(url);
              deepStrictEqual(await response.text(), protocol);
            } finally {
              await session.close();
            }
          }
          // The hostname is not replaced with the address, since there is no
          // pinner to keep the Host header and the TLS server name:
          deepStrictEqual(
            fetchMock.callHistory.calls().map(({ url }) => url),
            [
              "https://unpinned-host.invalid/0",
              "http://unpinned-host.invalid/1",
              "https://unpinned-host.invalid/2",
              "http://unpinned-host.invalid/3",
              "https://unpinned-host.invalid/4",
            ],
          );
          // Addresses are still validated:
          await rejects(
            () =>
              openPublicFetch("https://unpinned-host.invalid/", {
                lookup: () =>
                  Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
              }),
            UrlError,
          );
          deepStrictEqual(fetchMock.callHistory.calls().length, 5);
        }),
    )
  );
  deepStrictEqual(unsupported.calls, []);
  deepStrictEqual(unsupported.released, []);
  // Logged once per runtime and protocol:
  deepStrictEqual(
    records.filter(isUnpinnedLog).map((r) => [
      r.level,
      r.properties.runtime,
      r.properties.protocol,
    ]),
    [["debug", "cfworkers", "https:"], ["debug", "cfworkers", "http:"]],
  );
});

test("openPublicFetch() uses the global fetch() on Deno", {
  ignore: !("Deno" in globalThis),
}, async () => {
  const { lookup, hostnames } = createRecordingLookup(publicAddresses);
  await withMockedGlobalFetch(async () => {
    fetchMock.route("https://deno-host.invalid/object", { body: "ok" });
    for (let i = 0; i < 2; i++) {
      const session = await openPublicFetch(
        "https://deno-host.invalid/object",
        { lookup },
      );
      try {
        const response = await session.fetch(
          "https://deno-host.invalid/object",
          { redirect: "follow" },
        );
        deepStrictEqual(await response.text(), "ok");
      } finally {
        await session.close();
      }
    }
    const calls = fetchMock.callHistory.calls();
    deepStrictEqual(
      calls.map(({ url, args }) => [url, (args[1] as RequestInit).redirect]),
      [
        ["https://deno-host.invalid/object", "manual"],
        ["https://deno-host.invalid/object", "manual"],
      ],
    );
  });
  deepStrictEqual(hostnames, ["deno-host.invalid", "deno-host.invalid"]);
  // The debug log is emitted only once per runtime and protocol in a module
  // instance, and other tests may already have emitted it in this one, so it
  // is checked in a worker, which has its own module instances.  Workers need
  // the read permission for their modules, so this is skipped without it
  // (e.g., `deno task test` of this package):
  const workerUrl = new URL(
    "./testdata/public-fetch-deno-worker.ts",
    import.meta.url,
  );
  const permission = await Deno.permissions.query({
    name: "read",
    path: workerUrl,
  });
  if (permission.state !== "granted") return;
  const worker = new Worker(workerUrl, { type: "module" });
  try {
    const result = await settlesWithin(
      new Promise((resolve, reject) => {
        worker.onmessage = (event) => resolve(event.data);
        worker.onerror = (event) => {
          event.preventDefault();
          reject(new Error(event.message));
        };
      }),
      10_000,
    );
    deepStrictEqual(result, {
      calls: [
        ["https://deno-host.invalid/1", "manual"],
        ["https://deno-host.invalid/2", "manual"],
        ["http://deno-host.invalid/3", "manual"],
      ],
      hostnames: [
        "deno-host.invalid",
        "deno-host.invalid",
        "deno-host.invalid",
      ],
      bodies: ["ok", "ok", "ok"],
      logs: [["debug", "deno", "https:"], ["debug", "deno", "http:"]],
    });
  } finally {
    worker.terminate();
  }
});

test("openPublicFetch() rejects fedify-test.internal", async (t) => {
  const url = "https://fedify-test.internal/";
  const cases = [
    {
      name: "private address",
      lookup: () => Promise.resolve([{ address: "10.0.0.1", family: 4 }]),
      reason: "disallowed",
    },
    {
      name: "lookup failure",
      lookup: () =>
        Promise.reject(
          Object.assign(new Error("getaddrinfo ENOTFOUND"), {
            code: "ENOTFOUND",
          }),
        ),
      reason: "dns",
    },
  ] as const;
  for (const { name, lookup, reason } of cases) {
    await t.step(name, async () => {
      const recorder = createRecordingPinner();
      const recorded = createPublicFetch({
        pinner: () => Promise.resolve(recorder.pinner),
        lookup: failingLookup,
      });
      await withMockedGlobalFetch(async () => {
        fetchMock.catch(200);
        // Both the runtime's openPublicFetch() and one with a recording
        // pinner have no exception for the hostname:
        for (const open of [openPublicFetch, recorded.openPublicFetch]) {
          await rejects(() => open(url, { lookup }), (error) => {
            ok(error instanceof UrlError, String(error));
            deepStrictEqual(error.reason, reason);
            return true;
          });
        }
        deepStrictEqual(fetchMock.callHistory.calls(), []);
      });
      deepStrictEqual(recorder.calls, []);
      deepStrictEqual(recorder.released, []);
    });
  }
});

test("openDirectFetch() follows the session rules", async () => {
  let hits = 0;
  const server = createServer((_, res) => {
    hits++;
    // Leaves the body open so that only close() can finish it:
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("partial");
  });
  const port = await listen(server);
  try {
    const url = `http://127.0.0.1:${port}/`;
    const session = await openDirectFetch(url);
    deepStrictEqual(session.url.href, url);
    await rejects(
      () => session.fetch(`http://127.0.0.1:${port + 1}/`),
      TypeError,
    );
    const response = await session.fetch(`${url}path`);
    deepStrictEqual(response.status, 200);
    ok(!response.bodyUsed);
    await session.close();
    ok(response.bodyUsed);
    await rejects(() => session.fetch(url), TypeError);
    await session.close();
    deepStrictEqual(hits, 1);
  } finally {
    await closeServer(server);
  }
});
