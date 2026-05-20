import { createTestMeterProvider, test } from "@fedify/fixture";
import { withTimeout } from "es-toolkit";
import fetchMock from "fetch-mock";
import { deepStrictEqual, ok } from "node:assert/strict";
import type { ResourceDescriptor } from "./jrd.ts";
import { lookupWebFinger } from "./lookup.ts";

test({
  name: "lookupWebFinger()",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
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

    fetchMock.spyGlobal();
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger?",
      { status: 404 },
    );

    await t.step("not found", async () => {
      deepStrictEqual(await lookupWebFinger("acct:johndoe@example.com"), null);
      deepStrictEqual(await lookupWebFinger("https://example.com/foo"), null);
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
        await lookupWebFinger("acct:johndoe@example.com"),
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
        await lookupWebFinger("https://example.com/foo"),
        expected2,
      );
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger?",
      { body: "not json" },
    );

    await t.step("invalid response", async () => {
      deepStrictEqual(await lookupWebFinger("acct:johndoe@example.com"), null);
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
        await lookupWebFinger("acct:johndoe@example.com"),
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
        () => lookupWebFinger("acct:johndoe@example.com"),
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
      deepStrictEqual(await lookupWebFinger("acct:johndoe@example.com"), null);
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
      deepStrictEqual(await lookupWebFinger("acct:johndoe@example.com"), null);
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
        await lookupWebFinger("acct:johndoe@example.com", {
          maxRedirection: 2,
        }),
        null,
      );

      // Test with maxRedirection: 3 (should succeed)
      redirectCount = 0;
      deepStrictEqual(
        await lookupWebFinger("acct:johndoe@example.com", {
          maxRedirection: 3,
        }),
        expected,
      );

      // Test with default maxRedirection: 5 (should succeed)
      redirectCount = 0;
      deepStrictEqual(
        await lookupWebFinger("acct:johndoe@example.com"),
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

          return () => clearTimeout(timeoutId);
        }),
    );

    await t.step("request cancellation", async () => {
      // Test cancelling a request immediately using AbortController
      const controller = new AbortController();
      const promise = lookupWebFinger("acct:johndoe@example.com", {
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

          return () => clearTimeout(timeoutId);
        });
      },
    );

    await t.step("cancellation during redirection", async () => {
      // Test cancelling a request during redirection process
      const controller = new AbortController();
      const promise = lookupWebFinger("acct:johndoe@example.com", {
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

          return () => clearTimeout(timeoutId);
        }),
    );

    await t.step("cancellation with immediate abort", async () => {
      // Test starting a request with an already aborted AbortController
      const controller = new AbortController();
      controller.abort();

      // Use a signal that was already aborted before starting the request
      const result = await lookupWebFinger("acct:johndoe@example.com", {
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
      const result = await lookupWebFinger("acct:johndoe@example.com", {
        signal: controller.signal,
      });
      deepStrictEqual(result, expected);
    });

    fetchMock.hardReset();
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
        const result = await lookupWebFinger("acct:johndoe@example.com", {
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
        await lookupWebFinger("https://example.com/foo", { meterProvider });
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

    await t.step("records result=not_found with status 404", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        "begin:https://example.com/.well-known/webfinger?",
        { status: 404 },
      );
      const [meterProvider, recorder] = createTestMeterProvider();
      const result = await lookupWebFinger("acct:johndoe@example.com", {
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
      await lookupWebFinger("acct:johndoe@example.com", { meterProvider });
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
        await lookupWebFinger("acct:johndoe@example.com", { meterProvider });
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
        await lookupWebFinger("acct:johndoe@example.com", { meterProvider });
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
        const result = await lookupWebFinger(
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
        const result = await lookupWebFinger("acct:johndoe", { meterProvider });
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
            lookupWebFinger("acct:johndoe@example.com", {
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
        await lookupWebFinger("acct:johndoe@example.com", { meterProvider });
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
        await lookupWebFinger("acct:johndoe@example.com", { meterProvider });
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
        await lookupWebFinger("acct:johndoe@example.com", { meterProvider });
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
        await lookupWebFinger("ssh://example.com/foo", { meterProvider });
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
        await lookupWebFinger("acct:johndoe@example.com");
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
