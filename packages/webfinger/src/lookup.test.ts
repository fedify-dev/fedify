import { test } from "@fedify/fixture";
import { UrlError } from "@fedify/vocab-runtime";
import {
  openDirectFetch,
  openPublicFetch,
  type PublicFetchSession,
} from "@fedify/vocab-runtime/internal";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import { withTimeout } from "es-toolkit";
import fetchMock from "fetch-mock";
import { deepStrictEqual, ok } from "node:assert/strict";
import type { LookupAddress } from "node:dns";
import type { ResourceDescriptor } from "./jrd.ts";
import { lookupWebFinger, type LookupWebFingerOptions } from "./lookup.ts";
import { lookupWebFingerInternal } from "./lookup-impl.ts";

// fetch-mock routes match hostnames, but on runtimes that pin connections
// the request URL has the resolved IP address instead.  Tests of the response
// handling therefore skip address validation, and tests of the address policy
// inject the DNS lookup:
function lookupDirect(
  resource: URL | string,
  options?: LookupWebFingerOptions,
): Promise<ResourceDescriptor | null> {
  return lookupWebFingerInternal(resource, options, {
    openHop: openDirectFetch,
  });
}

function lookupResolving(
  addresses: readonly LookupAddress[],
): (hostname: string) => Promise<readonly LookupAddress[]> {
  return () => Promise.resolve(addresses);
}

// Lets example.com through without validation, and validates every other
// host with a lookup that resolves to a public address:
function openExampleDirectly(url: string): Promise<PublicFetchSession> {
  return new URL(url).hostname === "example.com"
    ? openDirectFetch(url)
    : openPublicFetch(url, {
      lookup: lookupResolving([{ address: "93.184.215.14", family: 4 }]),
    });
}

test({
  name: "lookupWebFinger()",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const responseTimers: ReturnType<typeof setTimeout>[] = [];
    await t.step("invalid resource", async () => {
      deepStrictEqual(await lookupWebFinger("acct:johndoe"), null);
      deepStrictEqual(await lookupWebFinger(new URL("acct:johndoe")), null);
      deepStrictEqual(await lookupWebFinger("acct:johndoe@"), null);
      deepStrictEqual(await lookupWebFinger(new URL("acct:johndoe@")), null);
    });

    await t.step("connection refused", async () => {
      deepStrictEqual(
        await lookupWebFinger("acct:johndoe@fedify-test.internal"),
        null,
      );
      deepStrictEqual(
        await lookupWebFinger("https://fedify-test.internal/foo"),
        null,
      );
    });

    await t.step(
      "fedify-test.internal resolving to a private address",
      async () => {
        fetchMock.mockGlobal();
        fetchMock.catch(500);
        try {
          const hosts: string[] = [];
          const openHop = (url: string) =>
            openPublicFetch(url, {
              lookup: (hostname) => {
                hosts.push(hostname);
                return Promise.resolve([{ address: "10.0.0.1", family: 4 }]);
              },
            });
          deepStrictEqual(
            await lookupWebFingerInternal(
              "acct:johndoe@fedify-test.internal",
              {},
              { openHop },
            ),
            null,
          );
          deepStrictEqual(
            await lookupWebFingerInternal(
              "https://fedify-test.internal/foo",
              {},
              { openHop },
            ),
            null,
          );
          deepStrictEqual(hosts, [
            "fedify-test.internal",
            "fedify-test.internal",
          ]);
          deepStrictEqual(fetchMock.callHistory.calls().length, 0);
        } finally {
          for (const timer of responseTimers) clearTimeout(timer);
          fetchMock.hardReset();
        }
      },
    );

    fetchMock.spyGlobal();
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger?",
      { status: 404 },
    );

    await t.step("not found", async () => {
      deepStrictEqual(await lookupDirect("acct:johndoe@example.com"), null);
      deepStrictEqual(await lookupDirect("https://example.com/foo"), null);
    });

    const expected: ResourceDescriptor = {
      subject: "acct:johndoe@example.com",
      links: [],
    };
    fetchMock.removeRoutes();
    fetchMock.get(
      "https://example.com/.well-known/webfinger?resource=acct%3Ajohndoe%40example.com",
      { body: expected },
    );

    await t.step("acct", async () => {
      deepStrictEqual(
        await lookupDirect("acct:johndoe@example.com"),
        expected,
      );
    });

    const expected2: ResourceDescriptor = {
      subject: "https://example.com/foo",
      links: [],
    };
    fetchMock.removeRoutes();
    fetchMock.get(
      "https://example.com/.well-known/webfinger?resource=https%3A%2F%2Fexample.com%2Ffoo",
      { body: expected2 },
    );

    await t.step("https", async () => {
      deepStrictEqual(
        await lookupDirect("https://example.com/foo"),
        expected2,
      );
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger?",
      { body: "not json" },
    );

    await t.step("invalid response", async () => {
      deepStrictEqual(await lookupDirect("acct:johndoe@example.com"), null);
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://localhost/.well-known/webfinger?",
      {
        subject: "acct:test@localhost",
        links: [
          {
            rel: "self",
            type: "application/activity+json",
            href: "https://localhost/actor",
          },
        ],
      },
    );

    await t.step("private address", async () => {
      deepStrictEqual(await lookupWebFinger("acct:test@localhost"), null);
      deepStrictEqual(
        await lookupWebFinger("acct:test@localhost", {
          allowPrivateAddress: true,
        }),
        {
          subject: "acct:test@localhost",
          links: [
            {
              rel: "self",
              type: "application/activity+json",
              href: "https://localhost/actor",
            },
          ],
        },
      );
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger?",
      {
        status: 302,
        headers: { Location: "/.well-known/webfinger2" },
      },
    );
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger2",
      { body: expected },
    );

    await t.step("redirection", async () => {
      deepStrictEqual(
        await lookupDirect("acct:johndoe@example.com"),
        expected,
      );
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger?",
      {
        status: 302,
        headers: { Location: "/.well-known/webfinger" },
      },
    );

    await t.step("infinite redirection", async () => {
      const result = await withTimeout(
        () => lookupDirect("acct:johndoe@example.com"),
        2000,
      );
      deepStrictEqual(result, null);
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger?",
      {
        status: 302,
        headers: { Location: "ftp://example.com/" },
      },
    );

    await t.step("redirection to different protocol", async () => {
      deepStrictEqual(await lookupDirect("acct:johndoe@example.com"), null);
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger?",
      {
        status: 302,
        headers: { Location: "https://localhost/" },
      },
    );

    await t.step("redirection to private address", async () => {
      deepStrictEqual(
        await lookupWebFingerInternal("acct:johndoe@example.com", {}, {
          openHop: openExampleDirectly,
        }),
        null,
      );
    });

    fetchMock.removeRoutes();
    let redirectCount = 0;
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger",
      () => {
        redirectCount++;
        if (redirectCount < 3) {
          return {
            status: 302,
            headers: {
              Location: `/.well-known/webfinger?redirect=${redirectCount}`,
            },
          };
        }
        return { body: expected };
      },
    );

    await t.step("custom maxRedirection", async () => {
      // Test with maxRedirection: 2 (should fail)
      redirectCount = 0;
      deepStrictEqual(
        await lookupDirect("acct:johndoe@example.com", {
          maxRedirection: 2,
        }),
        null,
      );

      // Test with maxRedirection: 3 (should succeed)
      redirectCount = 0;
      deepStrictEqual(
        await lookupDirect("acct:johndoe@example.com", {
          maxRedirection: 3,
        }),
        expected,
      );

      // Test with default maxRedirection: 5 (should succeed)
      redirectCount = 0;
      deepStrictEqual(
        await lookupDirect("acct:johndoe@example.com"),
        expected,
      );
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger?",
      () =>
        new Promise((resolve) => {
          const timeoutId = setTimeout(() => {
            resolve({ body: expected });
          }, 1000);

          responseTimers.push(timeoutId);
        }),
    );

    await t.step("request cancellation", async () => {
      // Test cancelling a request immediately using AbortController
      const controller = new AbortController();
      const promise = lookupDirect("acct:johndoe@example.com", {
        signal: controller.signal,
      });

      // Abort the request right after starting it
      controller.abort();
      deepStrictEqual(await promise, null);
    });

    fetchMock.removeRoutes();
    let redirectCount2 = 0;
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger",
      () => {
        redirectCount2++;
        if (redirectCount2 === 1) {
          return {
            status: 302,
            headers: { Location: "/.well-known/webfinger2" },
          };
        }
        return new Promise((resolve) => {
          const timeoutId = setTimeout(() => {
            resolve({ body: expected });
          }, 1000);

          responseTimers.push(timeoutId);
        });
      },
    );

    await t.step("cancellation during redirection", async () => {
      // Test cancelling a request during redirection process
      const controller = new AbortController();
      const promise = lookupDirect("acct:johndoe@example.com", {
        signal: controller.signal,
      });

      // Cancel during the delayed second request after redirection
      setTimeout(() => controller.abort(), 100);
      deepStrictEqual(await promise, null);
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger?",
      () =>
        new Promise((resolve) => {
          const timeoutId = setTimeout(() => {
            resolve({ body: expected });
          }, 500);

          responseTimers.push(timeoutId);
        }),
    );

    await t.step("cancellation with immediate abort", async () => {
      // Test starting a request with an already aborted AbortController
      const controller = new AbortController();
      controller.abort();

      // Use a signal that was already aborted before starting the request
      const result = await lookupDirect("acct:johndoe@example.com", {
        signal: controller.signal,
      });
      deepStrictEqual(result, null);

      // Opening a validated session is aborted before the DNS lookup:
      deepStrictEqual(
        await lookupWebFinger("acct:johndoe@example.com", {
          signal: controller.signal,
        }),
        null,
      );
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger?",
      { body: expected },
    );

    await t.step("successful request with signal", async () => {
      // Test successful request with a normal AbortController signal
      const controller = new AbortController();
      const result = await lookupDirect("acct:johndoe@example.com", {
        signal: controller.signal,
      });
      deepStrictEqual(result, expected);
    });

    for (const timer of responseTimers) clearTimeout(timer);
    fetchMock.hardReset();
  },
});

// cSpell: ignore johndoe

test("lookupWebFinger() bounds resource descriptors", async () => {
  fetchMock.mockGlobal();
  let oversized = true;
  try {
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger?",
      () =>
        new Response(
          '{"subject":"acct:alice@example.com"}' +
            (oversized ? " ".repeat(16 * 1024 * 1024) : ""),
          {
            headers: {
              "Content-Type": "application/jrd+json",
              "Content-Length": "1",
            },
          },
        ),
    );
    deepStrictEqual(
      await lookupWebFinger("acct:alice@example.com", {
        allowPrivateAddress: true,
      }),
      null,
    );
    oversized = false;
    deepStrictEqual(
      await lookupWebFinger("acct:alice@example.com", {
        allowPrivateAddress: true,
      }),
      { subject: "acct:alice@example.com" },
    );
  } finally {
    fetchMock.hardReset();
  }
});

test("lookupWebFinger() logs DNS failures as such", async (t) => {
  for (const result of ["throws", "empty", "private"] as const) {
    await t.step(result, async () => {
      const lookup = () =>
        result === "throws"
          ? Promise.reject(new Error("Resolver unavailable"))
          : Promise.resolve(
            result === "empty" ? [] : [{ address: "127.0.0.1", family: 4 }],
          );
      const records: LogRecord[] = [];
      await configure({
        sinks: {
          buffer: (record) => records.push(record),
        },
        loggers: [
          { category: "fedify", sinks: ["buffer"], lowestLevel: "debug" },
          { category: ["logtape", "meta"], sinks: [] },
        ],
        reset: true,
      });
      try {
        deepStrictEqual(
          await lookupWebFingerInternal("acct:alice@dns-failure.invalid", {}, {
            openHop: (url) => openPublicFetch(url, { lookup }),
          }),
          null,
        );
        const failures = records.filter((r) =>
          r.rawMessage !==
            "Fetching WebFinger resource descriptor from {url}..."
        );
        deepStrictEqual(
          failures.map((r) => [r.level, r.rawMessage]),
          [
            result === "private"
              ? [
                "error",
                "Invalid URL for WebFinger resource descriptor: {error}",
              ]
              : ["debug", "DNS lookup failed for {url}"],
          ],
        );
        const { error } = failures[0].properties;
        ok(error instanceof UrlError);
        deepStrictEqual(
          error.reason,
          result === "private" ? "disallowed" : "dns",
        );
      } finally {
        await reset();
      }
    });
  }
});

interface FakeResponse {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  /** The `url` of the response, as a pinned fetch reports it. */
  readonly url?: string;
  /** Makes cancelling the body fail. */
  readonly cancelFails?: boolean;
  /** Makes cancelling the body never settle. */
  readonly cancelNeverSettles?: boolean;
}

interface HopRecorder {
  readonly events: string[];
  readonly openHop: (url: string) => Promise<PublicFetchSession>;
  /**
   * Asserts that every opened session is closed, and that every response
   * body was consumed or cancelled before its session was closed.
   */
  assertInvariants(): void;
}

// A fake server that records the lifecycle of each session and response.
// Unlike real sessions, closing a fake session never cancels bodies, so that
// the caller's own cleanup is observed:
function recordHops(respond: (url: URL) => FakeResponse): HopRecorder {
  const events: string[] = [];
  const unsettled: string[] = [];
  let opens = 0;
  let closes = 0;
  let responses = 0;
  return {
    events,
    // deno-lint-ignore require-await
    async openHop(url) {
      opens++;
      events.push(`open ${url}`);
      const states: { id: number; settled: boolean }[] = [];
      let closed = false;
      return {
        url: new URL(url),
        // deno-lint-ignore require-await
        async fetch(input) {
          if (closed) throw new TypeError("The fetch session is closed.");
          const target = new URL(input instanceof Request ? input.url : input);
          const id = ++responses;
          events.push(`fetch ${target.href} #${id}`);
          const fake = respond(target);
          const state = { id, settled: false };
          states.push(state);
          let sent = false;
          const body = new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!sent && fake.body != null && fake.body !== "") {
                sent = true;
                controller.enqueue(new TextEncoder().encode(fake.body));
                return;
              }
              state.settled = true;
              events.push(`consumed #${id}`);
              controller.close();
            },
            cancel() {
              state.settled = true;
              events.push(`cancel #${id}`);
              if (fake.cancelFails) throw new Error("Cancellation failed");
              if (fake.cancelNeverSettles) return new Promise(() => {});
            },
          }, { highWaterMark: 0 });
          const response = new Response(body, {
            status: fake.status ?? 200,
            headers: fake.headers,
          });
          if (fake.url != null) {
            Object.defineProperty(response, "url", { value: fake.url });
          }
          return response;
        },
        // deno-lint-ignore require-await
        async close() {
          if (closed) return;
          closed = true;
          closes++;
          for (const state of states) {
            if (!state.settled) unsettled.push(`#${state.id}`);
          }
          events.push(`close ${url}`);
        },
      };
    },
    assertInvariants() {
      deepStrictEqual(closes, opens);
      deepStrictEqual(unsettled, []);
    },
  };
}

test("lookupWebFinger() closes each hop after cleaning up its body", async (t) => {
  const descriptor: ResourceDescriptor = {
    subject: "acct:johndoe@example.com",
    links: [],
  };
  const first =
    "https://example.com/.well-known/webfinger?resource=acct%3Ajohndoe%40example.com";
  const second = "https://example.com/.well-known/webfinger2";

  await t.step("redirect", async () => {
    const recorder = recordHops((url) =>
      url.pathname === "/.well-known/webfinger"
        ? {
          status: 302,
          headers: { Location: "/.well-known/webfinger2" },
          body: "redirecting",
          // A pinned response's url has the IP address, which must not be
          // used as the base of the Location:
          url: url.href.replace("example.com", "93.184.215.14"),
        }
        : { body: JSON.stringify(descriptor) }
    );
    deepStrictEqual(
      await lookupWebFingerInternal("acct:johndoe@example.com", {}, {
        openHop: recorder.openHop,
      }),
      descriptor,
    );
    deepStrictEqual(recorder.events, [
      `open ${first}`,
      `fetch ${first} #1`,
      "cancel #1",
      `close ${first}`,
      `open ${second}`,
      `fetch ${second} #2`,
      "consumed #2",
      `close ${second}`,
    ]);
    recorder.assertInvariants();
  });

  await t.step("non-2xx response", async () => {
    const recorder = recordHops(() => ({ status: 404, body: "not found" }));
    deepStrictEqual(
      await lookupWebFingerInternal("acct:johndoe@example.com", {}, {
        openHop: recorder.openHop,
      }),
      null,
    );
    deepStrictEqual(recorder.events, [
      `open ${first}`,
      `fetch ${first} #1`,
      "cancel #1",
      `close ${first}`,
    ]);
    recorder.assertInvariants();
  });

  await t.step("too many redirections", async () => {
    const recorder = recordHops(() => ({
      status: 302,
      headers: { Location: "/.well-known/webfinger2" },
      body: "redirecting",
    }));
    deepStrictEqual(
      await lookupWebFingerInternal("acct:johndoe@example.com", {
        maxRedirection: 2,
      }, { openHop: recorder.openHop }),
      null,
    );
    deepStrictEqual(recorder.events, [
      `open ${first}`,
      `fetch ${first} #1`,
      "cancel #1",
      `close ${first}`,
      `open ${second}`,
      `fetch ${second} #2`,
      "cancel #2",
      `close ${second}`,
    ]);
    recorder.assertInvariants();
  });

  await t.step("failed redirect body cancellation", async () => {
    const recorder = recordHops((url) =>
      url.pathname === "/.well-known/webfinger"
        ? {
          status: 302,
          headers: { Location: "/.well-known/webfinger2" },
          body: "redirecting",
          cancelFails: true,
        }
        : { body: JSON.stringify(descriptor) }
    );
    const records: LogRecord[] = [];
    await configure({
      sinks: { buffer: (record) => records.push(record) },
      loggers: [
        { category: "fedify", sinks: ["buffer"], lowestLevel: "debug" },
        { category: ["logtape", "meta"], sinks: [] },
      ],
      reset: true,
    });
    try {
      deepStrictEqual(
        await lookupWebFingerInternal("acct:johndoe@example.com", {}, {
          openHop: recorder.openHop,
        }),
        descriptor,
      );
      const failures = records.filter((r) =>
        r.rawMessage ===
          "Failed to cancel the response body from {url}: {error}"
      );
      deepStrictEqual(
        failures.map((r) => [r.level, r.properties.url]),
        [["debug", first]],
      );
      const { error } = failures[0].properties;
      ok(error instanceof Error);
      deepStrictEqual(error.message, "Cancellation failed");
    } finally {
      await reset();
    }
    deepStrictEqual(recorder.events, [
      `open ${first}`,
      `fetch ${first} #1`,
      "cancel #1",
      `close ${first}`,
      `open ${second}`,
      `fetch ${second} #2`,
      "consumed #2",
      `close ${second}`,
    ]);
    recorder.assertInvariants();
  });

  await t.step("never-settling body cancellation", async () => {
    const recorder = recordHops((url) =>
      url.pathname === "/.well-known/webfinger"
        ? {
          status: 302,
          headers: { Location: "/.well-known/webfinger2" },
          body: "redirecting",
          cancelNeverSettles: true,
        }
        : { status: 404, body: "not found", cancelNeverSettles: true }
    );
    deepStrictEqual(
      await settleWithin(
        lookupWebFingerInternal("acct:johndoe@example.com", {}, {
          openHop: recorder.openHop,
        }),
      ),
      null,
    );
    deepStrictEqual(recorder.events, [
      `open ${first}`,
      `fetch ${first} #1`,
      "cancel #1",
      `close ${first}`,
      `open ${second}`,
      `fetch ${second} #2`,
      "cancel #2",
      `close ${second}`,
    ]);
    recorder.assertInvariants();
  });
});

/**
 * Rejects if the given promise does not settle within the timeout, so that
 * a hang fails the test instead of blocking it.
 */
async function settleWithin<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Did not settle within ${ms} ms.`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// A body that a real session cannot cancel to completion: fetch-mock returns
// a clone (a tee) of a Response instance, and the cancellation of a branch of
// a tee settles only after the other branch is cancelled too.  Its source's
// cancel callback never settles either:
function neverCancellableResponse(init: ResponseInit): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("never cancelled"));
      },
      cancel: () => new Promise(() => {}),
    }),
    init,
  );
}

test("lookupWebFinger() does not wait for cancelling response bodies", async (t) => {
  const descriptor: ResourceDescriptor = {
    subject: "acct:johndoe@example.com",
    links: [],
  };
  fetchMock.mockGlobal();
  try {
    await t.step("redirect", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        "begin:https://example.com/.well-known/webfinger?",
        () =>
          neverCancellableResponse({
            status: 302,
            headers: { Location: "/.well-known/webfinger2" },
          }),
      );
      fetchMock.get(
        "https://example.com/.well-known/webfinger2",
        () =>
          new Response(JSON.stringify(descriptor), {
            headers: { "Content-Type": "application/jrd+json" },
          }),
      );
      deepStrictEqual(
        await settleWithin(lookupDirect("acct:johndoe@example.com")),
        descriptor,
      );
    });

    await t.step("non-2xx response", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        "begin:https://example.com/.well-known/webfinger?",
        () => neverCancellableResponse({ status: 404 }),
      );
      deepStrictEqual(
        await settleWithin(lookupDirect("acct:johndoe@example.com")),
        null,
      );
    });
  } finally {
    fetchMock.hardReset();
  }
});
