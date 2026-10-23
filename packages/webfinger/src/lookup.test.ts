import { createTestMeterProvider, test } from "@fedify/fixture";
import { UrlError } from "@fedify/vocab-runtime";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import { withTimeout } from "es-toolkit";
import fetchMock from "fetch-mock";
import { deepStrictEqual, ok } from "node:assert/strict";
import type { ResourceDescriptor } from "./jrd.ts";
import {
  lookupWebFinger,
  type LookupWebFingerOptions,
  lookupWebFingerWithDependencies,
  type WebFingerLookupOutcome,
} from "./lookup.ts";
import {
  type LookupWebFingerDependencies,
  lookupWebFingerInternal,
} from "./lookup-impl.ts";
import {
  openDirectFetch,
  openPublicFetch,
  type PublicFetchSession,
} from "@fedify/vocab-runtime/internal";
import type { LookupAddress } from "node:dns";
import { test as nodeTest } from "node:test";

// Inject only the transport boundary, so the public tracing and metrics
// wrapper remains under test while fetch-mock sees the original hostname.
function lookupMock(
  resource: URL | string,
  options: LookupWebFingerOptions & { withDiagnostics: true },
): Promise<WebFingerLookupOutcome>;
function lookupMock(
  resource: URL | string,
  options?: LookupWebFingerOptions & { withDiagnostics?: false },
): Promise<ResourceDescriptor | null>;
function lookupMock(
  resource: URL | string,
  options: LookupWebFingerOptions & { withDiagnostics?: boolean } = {},
): Promise<ResourceDescriptor | null | WebFingerLookupOutcome> {
  if (resource.toString().includes("fedify-test.internal")) {
    return lookupWebFingerWithDependencies(resource, options, {
      openHop: (url) =>
        Promise.resolve({
          url: new URL(url),
          fetch: () => Promise.reject(new TypeError("Connection refused")),
          close: () => Promise.resolve(),
        }),
    });
  }
  return lookupWebFingerWithDependencies(resource, options, {
    openHop: options.allowPrivateAddress === true
      ? openDirectFetch
      : openExampleDirectly,
  });
}

function lookupDirect(
  resource: URL | string,
  options?: LookupWebFingerOptions,
): Promise<ResourceDescriptor | null> {
  return lookupWebFingerWithDependencies(resource, options, {
    openHop: openDirectFetch,
  });
}

function lookupResolving(
  addresses: readonly LookupAddress[],
): (hostname: string) => Promise<readonly LookupAddress[]> {
  return () => Promise.resolve(addresses);
}

function openExampleDirectly(url: string): Promise<PublicFetchSession> {
  return new URL(url).hostname === "example.com"
    ? openDirectFetch(url)
    : openPublicFetch(url, {
      lookup: lookupResolving([{ address: "93.184.215.14", family: 4 }]),
    });
}

async function lookupResourceWithDependencies(
  resource: URL | string,
  options: LookupWebFingerOptions,
  deps: LookupWebFingerDependencies,
): Promise<ResourceDescriptor | null> {
  return (await lookupWebFingerInternal(resource, options, deps)).resource;
}

test({
  name: "lookupWebFinger()",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const responseTimers: ReturnType<typeof setTimeout>[] = [];
    await t.step("invalid resource", async () => {
      deepStrictEqual(await lookupMock("acct:johndoe"), null);
      deepStrictEqual(await lookupMock(new URL("acct:johndoe")), null);
      deepStrictEqual(await lookupMock("acct:johndoe@"), null);
      deepStrictEqual(await lookupMock(new URL("acct:johndoe@")), null);
      // Per RFC 7565, the acct: authority is bare `host`: no path,
      // query, or fragment is allowed.  Reject such inputs rather than
      // forwarding them to a remote WebFinger lookup.
      deepStrictEqual(
        await lookupMock("acct:johndoe@example.com/exploit"),
        null,
      );
      deepStrictEqual(
        await lookupMock("acct:johndoe@example.com?x=1"),
        null,
      );
      deepStrictEqual(
        await lookupMock("acct:johndoe@example.com#frag"),
        null,
      );
    });

    await t.step("connection refused", async () => {
      deepStrictEqual(
        await lookupMock("acct:johndoe@fedify-test.internal"),
        null,
      );
      deepStrictEqual(
        await lookupMock("https://fedify-test.internal/foo"),
        null,
      );
    });

    fetchMock.spyGlobal();
    // Wrap the rest of the outer test in try/finally so the global
    // `fetch` spy is torn down even if a t.step assertion below
    // throws.  Matches the cleanup pattern of the metrics test
    // further down in this file.
    try {
      fetchMock.get(
        "begin:https://example.com/.well-known/webfinger?",
        { status: 404 },
      );

      await t.step("not found", async () => {
        deepStrictEqual(
          await lookupMock("acct:johndoe@example.com"),
          null,
        );
        deepStrictEqual(await lookupMock("https://example.com/foo"), null);
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
          await lookupMock("acct:johndoe@example.com"),
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
          await lookupMock("https://example.com/foo"),
          expected2,
        );
      });

      const mailtoExpected: ResourceDescriptor = {
        subject: "mailto:juliet@example.com",
        links: [],
      };
      fetchMock.removeRoutes();
      fetchMock.get(
        "https://example.com/.well-known/webfinger?resource=mailto%3Ajuliet%40example.com",
        { body: mailtoExpected },
      );

      await t.step("mailto", async () => {
        // RFC 7033 permits any URI as a WebFinger resource, and RFC 7565
        // explicitly references `mailto:` as an example.  The opaque-path
        // host extraction (after the last `@`) applies to `mailto:` just
        // like `acct:`.
        deepStrictEqual(
          await lookupMock("mailto:juliet@example.com"),
          mailtoExpected,
        );
      });

      const mailtoQueryExpected: ResourceDescriptor = {
        subject: "mailto:juliet@example.com?subject=Hi",
        links: [],
      };
      fetchMock.removeRoutes();
      fetchMock.get(
        "https://example.com/.well-known/webfinger?resource=mailto%3Ajuliet%40example.com%3Fsubject%3DHi",
        { body: mailtoQueryExpected },
      );

      await t.step("mailto with hfields", async () => {
        // RFC 6068 §2 allows `mailto:` URIs to carry `?hfields=...`
        // header fields and fragment identifiers.  Unlike `acct:`,
        // those components are part of the grammar, so the lookup
        // must accept them and forward the full resource URI to the
        // WebFinger endpoint.
        deepStrictEqual(
          await lookupMock("mailto:juliet@example.com?subject=Hi"),
          mailtoQueryExpected,
        );
      });

      fetchMock.removeRoutes();
      fetchMock.get(
        "begin:https://example.com/.well-known/webfinger?",
        { body: "not json" },
      );

      await t.step("invalid response", async () => {
        deepStrictEqual(
          await lookupMock("acct:johndoe@example.com"),
          null,
        );
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
        deepStrictEqual(await lookupMock("acct:test@localhost"), null);
        deepStrictEqual(
          await lookupMock("acct:test@localhost", {
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
          await lookupMock("acct:johndoe@example.com"),
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
          () => lookupMock("acct:johndoe@example.com"),
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
        deepStrictEqual(
          await lookupMock("acct:johndoe@example.com"),
          null,
        );
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
          await lookupMock("acct:johndoe@example.com"),
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
        // Test with maxRedirection: 1 (should fail; mock has 2 redirects)
        redirectCount = 0;
        deepStrictEqual(
          await lookupMock("acct:johndoe@example.com", {
            maxRedirection: 1,
          }),
          null,
        );

        // Test with maxRedirection: 2 (should succeed; mock has exactly 2
        // redirects, and `maxRedirection: N` follows up to N redirects)
        redirectCount = 0;
        deepStrictEqual(
          await lookupMock("acct:johndoe@example.com", {
            maxRedirection: 2,
          }),
          expected,
        );

        // Test with maxRedirection: 3 (should succeed)
        redirectCount = 0;
        deepStrictEqual(
          await lookupMock("acct:johndoe@example.com", {
            maxRedirection: 3,
          }),
          expected,
        );

        // Test with default maxRedirection: 5 (should succeed)
        redirectCount = 0;
        deepStrictEqual(
          await lookupMock("acct:johndoe@example.com"),
          expected,
        );
      });

      // Regression: `maxRedirection: 1` must allow exactly one 302 to be
      // followed.  An earlier implementation incremented the counter before
      // the `>=` check, so `maxRedirection: 1` rejected the first redirect
      // instead of following it.  The expected semantics is "follow up to
      // N redirects".
      await t.step(
        "maxRedirection: 1 follows exactly one redirect",
        async () => {
          // Mock with a single redirect: 302 → 200.  Under the corrected
          // semantics, `maxRedirection: 1` follows it and reaches the body.
          fetchMock.removeRoutes();
          let count = 0;
          fetchMock.get(
            "begin:https://example.com/.well-known/webfinger",
            () => {
              count++;
              return count < 2
                ? {
                  status: 302,
                  headers: { Location: "/.well-known/webfinger?after=1" },
                }
                : { body: expected };
            },
          );
          deepStrictEqual(
            await lookupMock("acct:johndoe@example.com", {
              maxRedirection: 1,
            }),
            expected,
          );

          // Mock with two redirects.  `maxRedirection: 1` rejects the
          // second redirect.
          fetchMock.removeRoutes();
          count = 0;
          fetchMock.get(
            "begin:https://example.com/.well-known/webfinger",
            () => {
              count++;
              return count < 3
                ? {
                  status: 302,
                  headers: {
                    Location: `/.well-known/webfinger?after=${count}`,
                  },
                }
                : { body: expected };
            },
          );
          deepStrictEqual(
            await lookupMock("acct:johndoe@example.com", {
              maxRedirection: 1,
            }),
            null,
          );
        },
      );

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
        const promise = lookupMock("acct:johndoe@example.com", {
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
        const promise = lookupMock("acct:johndoe@example.com", {
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
        const result = await lookupMock("acct:johndoe@example.com", {
          signal: controller.signal,
        });
        deepStrictEqual(result, null);
      });

      fetchMock.removeRoutes();
      fetchMock.get(
        "begin:https://example.com/.well-known/webfinger?",
        { body: expected },
      );

      await t.step("successful request with signal", async () => {
        // Test successful request with a normal AbortController signal
        const controller = new AbortController();
        const result = await lookupMock("acct:johndoe@example.com", {
          signal: controller.signal,
        });
        deepStrictEqual(result, expected);
      });
    } finally {
      for (const timer of responseTimers) clearTimeout(timer);
      fetchMock.removeRoutes();
      fetchMock.hardReset();
    }
  },
});

test("lookupWebFinger() records webfinger.lookup counter and duration", {
  sanitizeOps: false,
  sanitizeResources: false,
}, async (t) => {
  fetchMock.spyGlobal();
  try {
    const expected: ResourceDescriptor = {
      subject: "acct:johndoe@example.com",
      links: [],
    };

    await t.step(
      "records result=found for a successful acct lookup",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(
          "https://example.com/.well-known/webfinger?resource=acct%3Ajohndoe%40example.com",
          { body: expected },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        const result = await lookupMock("acct:johndoe@example.com", {
          meterProvider,
        });
        deepStrictEqual(result, expected);

        const counters = recorder.getMeasurements("webfinger.lookup");
        deepStrictEqual(counters.length, 1);
        deepStrictEqual(counters[0].type, "counter");
        deepStrictEqual(counters[0].value, 1);
        deepStrictEqual(
          counters[0].attributes["webfinger.lookup.result"],
          "found",
        );
        deepStrictEqual(
          counters[0].attributes["webfinger.resource.scheme"],
          "acct",
        );
        deepStrictEqual(
          counters[0].attributes["activitypub.remote.host"],
          "example.com",
        );
        deepStrictEqual(
          counters[0].attributes["http.response.status_code"],
          200,
        );

        const durations = recorder.getMeasurements("webfinger.lookup.duration");
        deepStrictEqual(durations.length, 1);
        deepStrictEqual(durations[0].type, "histogram");
        deepStrictEqual(
          durations[0].attributes["webfinger.lookup.result"],
          "found",
        );
        deepStrictEqual(
          durations[0].attributes["webfinger.resource.scheme"],
          "acct",
        );
        ok(typeof durations[0].value === "number" && durations[0].value >= 0);
      },
    );

    await t.step(
      "records scheme=https for an https resource lookup",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(
          "https://example.com/.well-known/webfinger?resource=https%3A%2F%2Fexample.com%2Ffoo",
          { body: { subject: "https://example.com/foo", links: [] } },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        await lookupMock("https://example.com/foo", { meterProvider });
        const counters = recorder.getMeasurements("webfinger.lookup");
        deepStrictEqual(counters.length, 1);
        deepStrictEqual(
          counters[0].attributes["webfinger.resource.scheme"],
          "https",
        );
        deepStrictEqual(
          counters[0].attributes["webfinger.lookup.result"],
          "found",
        );
      },
    );

    await t.step(
      "records non-default ports for URL resources",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(
          "https://example.com:8443/.well-known/webfinger?resource=https%3A%2F%2Fexample.com%3A8443%2Ffoo",
          { body: { subject: "https://example.com:8443/foo", links: [] } },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        await lookupMock("https://example.com:8443/foo", {
          meterProvider,
        });
        const counter = recorder.getMeasurement("webfinger.lookup");
        ok(counter != null);
        deepStrictEqual(
          counter.attributes["activitypub.remote.host"],
          "example.com:8443",
        );
      },
    );

    await t.step("records result=not_found with status 404", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        "begin:https://example.com/.well-known/webfinger?",
        { status: 404 },
      );
      const [meterProvider, recorder] = createTestMeterProvider();
      const result = await lookupMock("acct:johndoe@example.com", {
        meterProvider,
      });
      deepStrictEqual(result, null);

      const counters = recorder.getMeasurements("webfinger.lookup");
      deepStrictEqual(counters.length, 1);
      deepStrictEqual(
        counters[0].attributes["webfinger.lookup.result"],
        "not_found",
      );
      deepStrictEqual(
        counters[0].attributes["http.response.status_code"],
        404,
      );
      deepStrictEqual(
        counters[0].attributes["activitypub.remote.host"],
        "example.com",
      );

      const durations = recorder.getMeasurements("webfinger.lookup.duration");
      deepStrictEqual(durations.length, 1);
      deepStrictEqual(
        durations[0].attributes["webfinger.lookup.result"],
        "not_found",
      );
    });

    await t.step("records result=not_found with status 410", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        "begin:https://example.com/.well-known/webfinger?",
        { status: 410 },
      );
      const [meterProvider, recorder] = createTestMeterProvider();
      await lookupMock("acct:johndoe@example.com", { meterProvider });
      const counter = recorder.getMeasurement("webfinger.lookup");
      ok(counter != null);
      deepStrictEqual(
        counter.attributes["webfinger.lookup.result"],
        "not_found",
      );
      deepStrictEqual(counter.attributes["http.response.status_code"], 410);
    });

    await t.step(
      "records result=error for non-2xx, non-404/410 HTTP responses",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(
          "begin:https://example.com/.well-known/webfinger?",
          { status: 500 },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        await lookupMock("acct:johndoe@example.com", { meterProvider });
        const counter = recorder.getMeasurement("webfinger.lookup");
        ok(counter != null);
        deepStrictEqual(
          counter.attributes["webfinger.lookup.result"],
          "error",
        );
        deepStrictEqual(counter.attributes["http.response.status_code"], 500);
      },
    );

    await t.step(
      "records result=invalid for malformed JSON bodies",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(
          "begin:https://example.com/.well-known/webfinger?",
          { body: "not json" },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        await lookupMock("acct:johndoe@example.com", { meterProvider });
        const counter = recorder.getMeasurement("webfinger.lookup");
        ok(counter != null);
        deepStrictEqual(
          counter.attributes["webfinger.lookup.result"],
          "invalid",
        );
        deepStrictEqual(counter.attributes["http.response.status_code"], 200);
      },
    );

    await t.step(
      "records result=network_error when fetch never reaches the remote",
      async () => {
        fetchMock.removeRoutes();
        const [meterProvider, recorder] = createTestMeterProvider();
        const result = await lookupMock(
          "acct:johndoe@fedify-test.internal",
          { meterProvider },
        );
        deepStrictEqual(result, null);
        const counter = recorder.getMeasurement("webfinger.lookup");
        ok(counter != null);
        deepStrictEqual(
          counter.attributes["webfinger.lookup.result"],
          "network_error",
        );
        deepStrictEqual(
          "http.response.status_code" in counter.attributes,
          false,
          "no HTTP response means no status code attribute",
        );
        deepStrictEqual(
          counter.attributes["activitypub.remote.host"],
          "fedify-test.internal",
        );
      },
    );

    await t.step(
      "records result=invalid for malformed acct: resources",
      async () => {
        const [meterProvider, recorder] = createTestMeterProvider();
        const result = await lookupMock("acct:johndoe", { meterProvider });
        deepStrictEqual(result, null);
        const counter = recorder.getMeasurement("webfinger.lookup");
        ok(counter != null);
        deepStrictEqual(
          counter.attributes["webfinger.lookup.result"],
          "invalid",
        );
        deepStrictEqual(
          counter.attributes["webfinger.resource.scheme"],
          "acct",
        );
        deepStrictEqual(
          "activitypub.remote.host" in counter.attributes,
          false,
          "a malformed acct resource has no usable remote host",
        );
      },
    );

    await t.step(
      "records result=invalid when the redirect chain exceeds maxRedirection",
      async () => {
        fetchMock.removeRoutes();
        // The redirect Location drops the original `?resource=...` query
        // string, so the second hop's URL no longer contains a `?`.  The
        // route pattern omits the trailing `?` so it still matches.
        fetchMock.get(
          "begin:https://example.com/.well-known/webfinger",
          {
            status: 302,
            headers: { Location: "/.well-known/webfinger" },
          },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        const result = await withTimeout(
          () =>
            lookupMock("acct:johndoe@example.com", {
              meterProvider,
              maxRedirection: 3,
            }),
          2000,
        );
        deepStrictEqual(result, null);
        const counter = recorder.getMeasurement("webfinger.lookup");
        ok(counter != null);
        deepStrictEqual(
          counter.attributes["webfinger.lookup.result"],
          "invalid",
        );
        deepStrictEqual(counter.attributes["http.response.status_code"], 302);
        deepStrictEqual(
          counter.attributes["activitypub.remote.host"],
          "example.com",
        );
      },
    );

    await t.step(
      "records result=invalid for cross-protocol redirects",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(
          "begin:https://example.com/.well-known/webfinger?",
          {
            status: 302,
            headers: { Location: "ftp://example.com/" },
          },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        await lookupMock("acct:johndoe@example.com", { meterProvider });
        const counter = recorder.getMeasurement("webfinger.lookup");
        ok(counter != null);
        deepStrictEqual(
          counter.attributes["webfinger.lookup.result"],
          "invalid",
        );
        deepStrictEqual(counter.attributes["http.response.status_code"], 302);
      },
    );

    await t.step(
      "records result=network_error when a redirect points to a private address",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(
          "begin:https://example.com/.well-known/webfinger?",
          {
            status: 302,
            headers: { Location: "https://localhost/" },
          },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        await lookupMock("acct:johndoe@example.com", { meterProvider });
        const counter = recorder.getMeasurement("webfinger.lookup");
        ok(counter != null);
        deepStrictEqual(
          counter.attributes["webfinger.lookup.result"],
          "network_error",
        );
        deepStrictEqual(
          counter.attributes["activitypub.remote.host"],
          "localhost",
          "remote.host reflects the latest URL we attempted, even after a redirect",
        );
      },
    );

    await t.step(
      "records result=invalid for malformed Location headers",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(
          "begin:https://example.com/.well-known/webfinger?",
          {
            status: 302,
            headers: { Location: "http://[bad" },
          },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        await lookupMock("acct:johndoe@example.com", { meterProvider });
        const counter = recorder.getMeasurement("webfinger.lookup");
        ok(counter != null);
        deepStrictEqual(
          counter.attributes["webfinger.lookup.result"],
          "invalid",
        );
        deepStrictEqual(counter.attributes["http.response.status_code"], 302);
        deepStrictEqual(
          counter.attributes["activitypub.remote.host"],
          "example.com",
        );
      },
    );

    await t.step(
      "buckets unknown resource schemes as 'other' to keep metric cardinality bounded",
      async () => {
        // Lookups whose redirect chain ends on an unusual scheme (or a
        // resource the caller passes with a non-fediverse scheme) must
        // not leak that scheme into the metric attribute.
        fetchMock.removeRoutes();
        const [meterProvider, recorder] = createTestMeterProvider();
        // `ssh:` is not a WebFinger scheme; lookupWebFingerInternal will
        // attempt to build a host from the URL, fail, and return null.
        // The metric still records, and its scheme attribute must be
        // bucketed as `other`.
        await lookupMock("ssh://example.com/foo", { meterProvider });
        const counter = recorder.getMeasurement("webfinger.lookup");
        ok(counter != null);
        deepStrictEqual(
          counter.attributes["webfinger.resource.scheme"],
          "other",
        );
      },
    );

    await t.step(
      "omits measurements when no meterProvider is provided",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(
          "https://example.com/.well-known/webfinger?resource=acct%3Ajohndoe%40example.com",
          { body: expected },
        );
        const [_unused, recorder] = createTestMeterProvider();
        await lookupMock("acct:johndoe@example.com");
        deepStrictEqual(
          recorder.getMeasurements("webfinger.lookup").length,
          0,
        );
        deepStrictEqual(
          recorder.getMeasurements("webfinger.lookup.duration").length,
          0,
        );
      },
    );
  } finally {
    fetchMock.removeRoutes();
    fetchMock.hardReset();
  }
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
      await lookupMock("acct:alice@example.com", {
        allowPrivateAddress: true,
      }),
      null,
    );
    oversized = false;
    deepStrictEqual(
      await lookupMock("acct:alice@example.com", {
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
          await lookupResourceWithDependencies(
            "acct:alice@dns-failure.invalid",
            {},
            {
              openHop: (url) => openPublicFetch(url, { lookup }),
            },
          ),
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

test("lookupWebFinger() with withDiagnostics: true", {
  sanitizeOps: false,
  sanitizeResources: false,
}, async (t) => {
  // Inject the same failed session as the connection-refused transport test,
  // so the diagnostics path does not depend on real DNS or networking.
  await t.step("network_error", async () => {
    const outcome = await lookupMock(
      "acct:johndoe@fedify-test.internal",
      { withDiagnostics: true },
    );
    deepStrictEqual(outcome.resource, null);
    deepStrictEqual(outcome.result, "network_error");
    deepStrictEqual(
      "statusCode" in outcome,
      false,
      "no HTTP response means no status code",
    );
  });

  fetchMock.spyGlobal();
  try {
    await t.step("found", async () => {
      fetchMock.removeRoutes();
      const expected: ResourceDescriptor = {
        subject: "acct:johndoe@example.com",
        links: [],
      };
      fetchMock.get(
        "https://example.com/.well-known/webfinger?resource=acct%3Ajohndoe%40example.com",
        { body: expected },
      );
      const outcome = await lookupMock("acct:johndoe@example.com", {
        withDiagnostics: true,
      });
      deepStrictEqual(outcome.resource, expected);
      deepStrictEqual(outcome.result, "found");
      deepStrictEqual(outcome.statusCode, 200);
      deepStrictEqual(outcome.remoteHost, "example.com");
    });

    await t.step("not_found", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        "begin:https://example.com/.well-known/webfinger?",
        { status: 404 },
      );
      const outcome = await lookupMock("acct:johndoe@example.com", {
        withDiagnostics: true,
      });
      deepStrictEqual(outcome.resource, null);
      deepStrictEqual(outcome.result, "not_found");
      deepStrictEqual(outcome.statusCode, 404);
      deepStrictEqual(outcome.remoteHost, "example.com");
    });

    await t.step("invalid", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        "begin:https://example.com/.well-known/webfinger?",
        { body: "not json" },
      );
      const outcome = await lookupMock("acct:johndoe@example.com", {
        withDiagnostics: true,
      });
      deepStrictEqual(outcome.resource, null);
      deepStrictEqual(outcome.result, "invalid");
      deepStrictEqual(outcome.statusCode, 200);
      deepStrictEqual(outcome.remoteHost, "example.com");
    });

    await t.step(
      "invalid: a literal JSON null body is not a resource descriptor",
      async () => {
        // JSON.parse("null") succeeds and yields the JS value `null`.
        // Regression test for a server that returns 200 with a literal
        // `null` body instead of an object: this must not be classified
        // as "found" with a null resource.
        fetchMock.removeRoutes();
        fetchMock.get(
          "begin:https://example.com/.well-known/webfinger?",
          { body: "null" },
        );
        const outcome = await lookupMock("acct:johndoe@example.com", {
          withDiagnostics: true,
        });
        deepStrictEqual(outcome.resource, null);
        deepStrictEqual(outcome.result, "invalid");
        deepStrictEqual(outcome.statusCode, 200);
        deepStrictEqual(outcome.remoteHost, "example.com");
      },
    );

    await t.step(
      "invalid: a JSON array body is not a resource descriptor",
      async () => {
        // typeof [] === "object" and [] !== null, so the null-only guard
        // above does not catch an array body; it needs its own check.
        fetchMock.removeRoutes();
        fetchMock.get(
          "begin:https://example.com/.well-known/webfinger?",
          { body: "[]" },
        );
        const outcome = await lookupMock("acct:johndoe@example.com", {
          withDiagnostics: true,
        });
        deepStrictEqual(outcome.resource, null);
        deepStrictEqual(outcome.result, "invalid");
        deepStrictEqual(outcome.statusCode, 200);
        deepStrictEqual(outcome.remoteHost, "example.com");
      },
    );

    await t.step("error", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        "begin:https://example.com/.well-known/webfinger?",
        { status: 500 },
      );
      const outcome = await lookupMock("acct:johndoe@example.com", {
        withDiagnostics: true,
      });
      deepStrictEqual(outcome.resource, null);
      deepStrictEqual(outcome.result, "error");
      deepStrictEqual(outcome.statusCode, 500);
      deepStrictEqual(outcome.remoteHost, "example.com");
    });
  } finally {
    fetchMock.removeRoutes();
    fetchMock.hardReset();
  }
});

test(
  "lookupWebFinger() accepts a plain LookupWebFingerOptions-typed variable",
  async () => {
    // Regression test: a variable typed as `LookupWebFingerOptions`, built
    // separately from the call site and never mentioning `withDiagnostics`,
    // must still match the default overload.  This is a type-level
    // concern; the point of this test is that the file compiles at all.
    fetchMock.spyGlobal();
    try {
      const expected: ResourceDescriptor = {
        subject: "acct:johndoe@example.com",
        links: [],
      };
      fetchMock.get(
        "https://example.com/.well-known/webfinger?resource=acct%3Ajohndoe%40example.com",
        { body: expected },
      );
      const options: LookupWebFingerOptions = {
        userAgent: "test-agent",
        allowPrivateAddress: true,
      };
      const result = await lookupWebFinger(
        "acct:johndoe@example.com",
        options,
      );
      deepStrictEqual(result, expected);
    } finally {
      fetchMock.removeRoutes();
      fetchMock.hardReset();
    }
  },
);

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
      await lookupResourceWithDependencies("acct:johndoe@example.com", {}, {
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
      await lookupResourceWithDependencies("acct:johndoe@example.com", {}, {
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
      await lookupResourceWithDependencies("acct:johndoe@example.com", {
        maxRedirection: 1,
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
        await lookupResourceWithDependencies("acct:johndoe@example.com", {}, {
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
        lookupResourceWithDependencies("acct:johndoe@example.com", {}, {
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

nodeTest(
  "lookupWebFinger() records network_error for rejected hop addresses",
  async () => {
    for (
      const lookup of [
        () => Promise.reject(new Error("DNS unavailable")),
        () => Promise.resolve([]),
        () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
      ]
    ) {
      const [meterProvider, recorder] = createTestMeterProvider();
      const result = await lookupWebFingerWithDependencies(
        "acct:alice@dns-failure.invalid",
        { meterProvider },
        { openHop: (url) => openPublicFetch(url, { lookup }) },
      );
      deepStrictEqual(result, null);
      const counter = recorder.getMeasurement("webfinger.lookup");
      ok(counter != null);
      deepStrictEqual(
        counter.attributes["webfinger.lookup.result"],
        "network_error",
      );
      deepStrictEqual(
        counter.attributes["activitypub.remote.host"],
        "dns-failure.invalid",
      );
      deepStrictEqual("http.response.status_code" in counter.attributes, false);
    }
  },
);

nodeTest(
  "WebFinger diagnostics classify non-object JSON after closing the hop",
  async () => {
    for (const body of ["null", "[]", "42", '"text"', "true"]) {
      const hops = recordHops(() => ({ body }));
      const [meterProvider, recorder] = createTestMeterProvider();
      const outcome = await lookupWebFingerWithDependencies(
        "acct:alice@example.com",
        { withDiagnostics: true, meterProvider },
        { openHop: hops.openHop },
      );
      deepStrictEqual(outcome, {
        resource: null,
        result: "invalid",
        statusCode: 200,
        remoteHost: "example.com",
      });
      deepStrictEqual(
        hops.events.at(-1),
        "close https://example.com/.well-known/webfinger?resource=acct%3Aalice%40example.com",
      );
      hops.assertInvariants();
      deepStrictEqual(
        recorder.getMeasurement("webfinger.lookup")
          ?.attributes["webfinger.lookup.result"],
        "invalid",
      );
    }
  },
);
