import { test } from "@fedify/fixture";
import { assertEquals } from "@std/assert";
import { withTimeout } from "es-toolkit";
import fetchMock from "fetch-mock";
import type { ResourceDescriptor } from "./jrd.ts";
import { lookupWebFinger } from "./lookup.ts";

test({
  name: "lookupWebFinger()",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    await t.step("invalid resource", async () => {
      assertEquals(await lookupWebFinger("acct:johndoe"), null);
      assertEquals(await lookupWebFinger(new URL("acct:johndoe")), null);
      assertEquals(await lookupWebFinger("acct:johndoe@"), null);
      assertEquals(await lookupWebFinger(new URL("acct:johndoe@")), null);
    });

    await t.step("connection refused", async () => {
      assertEquals(
        await lookupWebFinger("acct:johndoe@fedify-test.internal"),
        null,
      );
      assertEquals(
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
      assertEquals(await lookupWebFinger("acct:johndoe@example.com"), null);
      assertEquals(await lookupWebFinger("https://example.com/foo"), null);
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
      assertEquals(await lookupWebFinger("acct:johndoe@example.com"), expected);
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
      assertEquals(await lookupWebFinger("https://example.com/foo"), expected2);
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://example.com/.well-known/webfinger?",
      { body: "not json" },
    );

    await t.step("invalid response", async () => {
      assertEquals(await lookupWebFinger("acct:johndoe@example.com"), null);
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
      assertEquals(await lookupWebFinger("acct:test@localhost"), null);
      assertEquals(
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
      assertEquals(await lookupWebFinger("acct:johndoe@example.com"), expected);
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
      assertEquals(result, null);
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
      assertEquals(await lookupWebFinger("acct:johndoe@example.com"), null);
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
      assertEquals(await lookupWebFinger("acct:johndoe@example.com"), null);
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
      assertEquals(
        await lookupWebFinger("acct:johndoe@example.com", {
          maxRedirection: 2,
        }),
        null,
      );

      // Test with maxRedirection: 3 (should succeed)
      redirectCount = 0;
      assertEquals(
        await lookupWebFinger("acct:johndoe@example.com", {
          maxRedirection: 3,
        }),
        expected,
      );

      // Test with default maxRedirection: 5 (should succeed)
      redirectCount = 0;
      assertEquals(
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
      assertEquals(await promise, null);
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
      assertEquals(await promise, null);
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
      assertEquals(result, null);
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
      assertEquals(result, expected);
    });

    fetchMock.hardReset();
  },
});

// cSpell: ignore johndoe
