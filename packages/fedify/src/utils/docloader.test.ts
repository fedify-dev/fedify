import { mockDocumentLoader, test } from "@fedify/fixture";
import { FetchError, UrlError } from "@fedify/vocab-runtime";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import { assertEquals, assertRejects } from "@std/assert";
import fetchMock from "fetch-mock";
import dns from "node:dns/promises";
import { verifyRequest } from "../sig/http.ts";
import { rsaPrivateKey2 } from "../testing/keys.ts";
import { getAuthenticatedDocumentLoader } from "./docloader.ts";

test("getAuthenticatedDocumentLoader()", async (t) => {
  fetchMock.spyGlobal();

  fetchMock.get(
    "begin:https://example.com/object",
    async (cl) => {
      const v = await verifyRequest(
        cl.request!,
        {
          documentLoader: mockDocumentLoader,
          contextLoader: mockDocumentLoader,
          currentTime: Temporal.Now.instant(),
        },
      );
      return new Response(JSON.stringify(v != null), {
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  await t.step("test", async () => {
    const loader = await getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });
    assertEquals(await loader("https://example.com/object"), {
      contextUrl: null,
      documentUrl: "https://example.com/object",
      document: true,
    });
  });

  fetchMock.hardReset();

  await t.step("deny non-HTTP/HTTPS", async () => {
    const loader = await getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });
    assertRejects(() => loader("ftp://localhost"), UrlError);
  });

  await t.step("deny private network", async () => {
    const loader = await getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });
    assertRejects(() => loader("http://localhost"), UrlError);
  });
});

test("getAuthenticatedDocumentLoader() validates redirects", async (t) => {
  fetchMock.spyGlobal();

  let privateRequestCount = 0;
  fetchMock.get(
    "https://example.com/redirect-to-private",
    () => Response.redirect("http://localhost/private", 302),
  );
  fetchMock.get("http://localhost/private", () => {
    privateRequestCount++;
    return Response.json({ private: true });
  });

  await t.step("deny public-to-private redirects", async () => {
    const loader = getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });
    await assertRejects(
      () => loader("https://example.com/redirect-to-private"),
      UrlError,
    );
    assertEquals(privateRequestCount, 0);
  });

  fetchMock.get(
    "https://example.com/redirect-to-public",
    () => Response.redirect("https://www.example.com/document", 302),
  );
  fetchMock.get(
    "https://www.example.com/document",
    () => Response.json({ public: true }),
  );

  await t.step("allow public-to-public redirects", async () => {
    const loader = getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });
    const remoteDocument = await loader(
      "https://example.com/redirect-to-public",
    );
    assertEquals(remoteDocument.document, { public: true });
  });

  await t.step("allow private redirects when explicitly enabled", async () => {
    const loader = getAuthenticatedDocumentLoader(
      {
        keyId: new URL("https://example.com/key2"),
        privateKey: rsaPrivateKey2,
      },
      { allowPrivateAddress: true },
    );
    const remoteDocument = await loader(
      "https://example.com/redirect-to-private",
    );
    assertEquals(remoteDocument.document, { private: true });
    assertEquals(privateRequestCount, 1);
  });

  fetchMock.hardReset();
});

test("getAuthenticatedDocumentLoader() cancellation", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  fetchMock.spyGlobal();

  await t.step("document loader cancellation", async () => {
    fetchMock.get(
      "https://example.com/slow-object",
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              status: 200,
              headers: { "Content-Type": "application/activity+json" },
              body: {
                "@context": "https://www.w3.org/ns/activitystreams",
                type: "Note",
                content: "Slow response",
              },
            });
          }, 1000);
        }),
    );

    const loader = getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });

    const controller = new AbortController();
    const promise = loader("https://example.com/slow-object", {
      signal: controller.signal,
    });

    controller.abort();

    await assertRejects(
      () => promise,
      Error,
    );

    await assertRejects(
      () => loader("https://example.com/object", { signal: controller.signal }),
      Error,
    );
  });

  await t.step("immediate cancellation", async () => {
    const loader = getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });

    const controller = new AbortController();
    controller.abort();

    await assertRejects(
      () => loader("https://example.com/object", { signal: controller.signal }),
      Error,
    );
  });

  fetchMock.hardReset();
});

test("getAuthenticatedDocumentLoader() bounds JSON after redirects", async () => {
  fetchMock.mockGlobal();
  let oversized = true;
  try {
    const url = "https://example.com/bounded";
    fetchMock.get(url, {
      status: 302,
      headers: { Location: `${url}/document` },
    });
    fetchMock.get(`${url}/document`, () =>
      new Response('{"name":"hello"}', {
        headers: {
          "Content-Type": "application/activity+json",
          ...(oversized
            ? { "Content-Length": String(16 * 1024 * 1024 + 1) }
            : {}),
        },
      }));
    const identity = {
      privateKey: rsaPrivateKey2,
      keyId: new URL("https://example.com/key2"),
    };
    const loader = getAuthenticatedDocumentLoader(identity, {
      allowPrivateAddress: true,
    });
    await assertRejects(() => loader(url), FetchError);
    oversized = false;
    assertEquals((await loader(url)).document, { name: "hello" });
  } finally {
    fetchMock.hardReset();
  }
});

test("getAuthenticatedDocumentLoader() logs DNS failures as such", {
  // The validator skips DNS when Deno has no network permission.
  ignore: "Deno" in globalThis &&
    (await Deno.permissions.query({ name: "net" })).state !== "granted",
}, async (t) => {
  const loader = getAuthenticatedDocumentLoader({
    keyId: new URL("https://example.com/key2"),
    privateKey: rsaPrivateKey2,
  });
  for (const result of ["throws", "empty", "private"] as const) {
    await t.step(result, async () => {
      // Stubbing works only because vocab-runtime's url.ts uses the default
      // node:dns/promises import; see the FIXME there.
      const originalLookup = dns.lookup;
      dns.lookup = (() =>
        result === "throws"
          ? Promise.reject(new Error("Resolver unavailable"))
          : Promise.resolve(
            result === "empty" ? [] : [{ address: "127.0.0.1", family: 4 }],
          )) as typeof dns.lookup;
      const records: LogRecord[] = [];
      await configure({
        sinks: {
          buffer: (record) =>
            records.push(record),
        },
        loggers: [
          { category: "fedify", sinks: ["buffer"], lowestLevel: "debug" },
          { category: ["logtape", "meta"], sinks: [] },
        ],
        reset: true,
      });
      try {
        const url = "https://dns-failure.invalid/object";
        const error = await assertRejects(() => loader(url), UrlError);
        assertEquals(error.reason, result === "private" ? "disallowed" : "dns");
        assertEquals(
          records.map((r) => [r.level, r.rawMessage, r.properties.url]),
          [
            result === "private"
              ? ["error", "Disallowed private URL: {url}", url]
              : ["debug", "DNS lookup failed for {url}", url],
          ],
        );
        assertEquals(records[0].properties.error, error);
      } finally {
        await reset();
        dns.lookup = originalLookup;
      }
    });
  }
});
