import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import fetchMock from "fetch-mock";
import process from "node:process";
import metadata from "../../deno.json" with { type: "json" };
import type { KvKey, KvStore, KvStoreSetOptions } from "../federation/kv.ts";
import { MemoryKvStore } from "../federation/kv.ts";
import { mockDocumentLoader } from "../testing/docloader.ts";
import { test } from "../testing/mod.ts";
import { createTestTracerProvider } from "../testing/otel.ts";
import preloadedContexts from "./contexts.ts";
import {
  type DocumentLoader,
  FetchError,
  getDocumentLoader,
  getUserAgent,
  kvCache,
} from "./docloader.ts";
import { UrlError } from "./url.ts";

test("new FetchError()", () => {
  const e = new FetchError("https://example.com/", "An error message.");
  assertEquals(e.name, "FetchError");
  assertEquals(e.url, new URL("https://example.com/"));
  assertEquals(e.message, "https://example.com/: An error message.");

  const e2 = new FetchError(new URL("https://example.org/"));
  assertEquals(e2.url, new URL("https://example.org/"));
  assertEquals(e2.message, "https://example.org/");
});

test("getDocumentLoader()", async (t) => {
  const fetchDocumentLoader = getDocumentLoader();

  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/object", {
    body: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/object",
      name: "Fetched object",
      type: "Object",
    },
  });

  await t.step("ok", async () => {
    assertEquals(await fetchDocumentLoader("https://example.com/object"), {
      contextUrl: null,
      documentUrl: "https://example.com/object",
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/object",
        name: "Fetched object",
        type: "Object",
      },
    });
  });

  fetchMock.get("https://example.com/link-ctx", {
    body: {
      id: "https://example.com/link-ctx",
      name: "Fetched object",
      type: "Object",
    },
    headers: {
      "Content-Type": "application/activity+json",
      Link: "<https://www.w3.org/ns/activitystreams>; " +
        'rel="http://www.w3.org/ns/json-ld#context"; ' +
        'type="application/ld+json"',
    },
  });

  fetchMock.get("https://example.com/link-obj", {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      Link: '<https://example.com/object>; rel="alternate"; ' +
        'type="application/activity+json"',
    },
  });

  fetchMock.get("https://example.com/link-obj-relative", {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      Link: '</object>; rel="alternate"; ' +
        'type="application/activity+json"',
    },
  });

  fetchMock.get("https://example.com/obj-w-wrong-link", {
    body: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/obj-w-wrong-link",
      name: "Fetched object",
      type: "Object",
    },
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      Link: '<https://example.com/object>; rel="alternate"; ' +
        'type="application/ld+json; profile="https://www.w3.org/ns/activitystreams""',
    },
  });

  await t.step("Link header", async () => {
    assertEquals(await fetchDocumentLoader("https://example.com/link-ctx"), {
      contextUrl: "https://www.w3.org/ns/activitystreams",
      documentUrl: "https://example.com/link-ctx",
      document: {
        id: "https://example.com/link-ctx",
        name: "Fetched object",
        type: "Object",
      },
    });

    assertEquals(await fetchDocumentLoader("https://example.com/link-obj"), {
      contextUrl: null,
      documentUrl: "https://example.com/object",
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/object",
        name: "Fetched object",
        type: "Object",
      },
    });
  });

  await t.step("Link header relative url", async () => {
    assertEquals(await fetchDocumentLoader("https://example.com/link-ctx"), {
      contextUrl: "https://www.w3.org/ns/activitystreams",
      documentUrl: "https://example.com/link-ctx",
      document: {
        id: "https://example.com/link-ctx",
        name: "Fetched object",
        type: "Object",
      },
    });

    assertEquals(
      await fetchDocumentLoader("https://example.com/link-obj-relative"),
      {
        contextUrl: null,
        documentUrl: "https://example.com/object",
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://example.com/object",
          name: "Fetched object",
          type: "Object",
        },
      },
    );
  });

  await t.step("wrong Link header syntax", async () => {
    assertEquals(
      await fetchDocumentLoader("https://example.com/obj-w-wrong-link"),
      {
        contextUrl: null,
        documentUrl: "https://example.com/obj-w-wrong-link",
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://example.com/obj-w-wrong-link",
          name: "Fetched object",
          type: "Object",
        },
      },
    );
  });

  fetchMock.get("https://example.com/html-link", {
    body: `<html>
        <head>
          <meta charset=utf-8>
          <link
            rel=alternate
            type='application/activity+json'
            href="https://example.com/object">
        </head>
      </html>`,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  await t.step("HTML <link>", async () => {
    assertEquals(await fetchDocumentLoader("https://example.com/html-link"), {
      contextUrl: null,
      documentUrl: "https://example.com/object",
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/object",
        name: "Fetched object",
        type: "Object",
      },
    });
  });

  fetchMock.get("https://example.com/xhtml-link", {
    body: `<html>
        <head>
          <meta charset="utf-8" />
          <link
            rel=alternate
            type="application/activity+json"
            href="https://example.com/object" />
        </head>
      </html>`,
    headers: { "Content-Type": "application/xhtml+xml; charset=utf-8" },
  });

  await t.step("XHTML <link>", async () => {
    assertEquals(await fetchDocumentLoader("https://example.com/xhtml-link"), {
      contextUrl: null,
      documentUrl: "https://example.com/object",
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/object",
        name: "Fetched object",
        type: "Object",
      },
    });
  });

  fetchMock.get("https://example.com/html-a", {
    body: `<html>
        <head>
          <meta charset=utf-8>
        </head>
        <body>
          <a
            rel=alternate
            type=application/activity+json
            href=https://example.com/object>test</a>
        </body>
      </html>`,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  await t.step("HTML <a>", async () => {
    assertEquals(await fetchDocumentLoader("https://example.com/html-a"), {
      contextUrl: null,
      documentUrl: "https://example.com/object",
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/object",
        name: "Fetched object",
        type: "Object",
      },
    });
  });

  fetchMock.get("https://example.com/wrong-content-type", {
    body: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/wrong-content-type",
      name: "Fetched object",
      type: "Object",
    },
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  await t.step("Wrong Content-Type", async () => {
    assertEquals(
      await fetchDocumentLoader("https://example.com/wrong-content-type"),
      {
        contextUrl: null,
        documentUrl: "https://example.com/wrong-content-type",
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://example.com/wrong-content-type",
          name: "Fetched object",
          type: "Object",
        },
      },
    );
  });

  fetchMock.get("https://example.com/404", { status: 404 });

  await t.step("not ok", async () => {
    await assertRejects(
      () => fetchDocumentLoader("https://example.com/404"),
      FetchError,
      "HTTP 404: https://example.com/404",
    );
  });

  await t.step("preloaded contexts", async () => {
    for (const [url, document] of Object.entries(preloadedContexts)) {
      assertEquals(await fetchDocumentLoader(url), {
        contextUrl: null,
        documentUrl: url,
        document,
      });
    }
  });

  await t.step("deny non-HTTP/HTTPS", async () => {
    await assertRejects(
      () => fetchDocumentLoader("ftp://localhost"),
      UrlError,
    );
  });

  fetchMock.get("https://example.com/localhost-redirect", {
    status: 302,
    headers: { Location: "https://localhost/object" },
  });

  fetchMock.get("https://example.com/localhost-link", {
    body: `<html>
        <head>
          <meta charset=utf-8>
          <link
            rel=alternate
            type='application/activity+json'
            href="https://localhost/object">
        </head>
      </html>`,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  fetchMock.get("https://localhost/object", {
    body: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://localhost/object",
      name: "Fetched object",
      type: "Object",
    },
  });

  await t.step("allowPrivateAddress: false", async () => {
    await assertRejects(
      () => fetchDocumentLoader("https://localhost/object"),
      UrlError,
    );
    await assertRejects(
      () => fetchDocumentLoader("https://example.com/localhost-redirect"),
      UrlError,
    );
    await assertRejects(
      () => fetchDocumentLoader("https://example.com/localhost-link"),
      UrlError,
    );
  });

  const fetchDocumentLoader2 = getDocumentLoader({ allowPrivateAddress: true });

  await t.step("allowPrivateAddress: true", async () => {
    const expected = {
      contextUrl: null,
      documentUrl: "https://localhost/object",
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://localhost/object",
        name: "Fetched object",
        type: "Object",
      },
    };
    assertEquals(
      await fetchDocumentLoader2("https://localhost/object"),
      expected,
    );
    assertEquals(
      await fetchDocumentLoader2("https://example.com/localhost-redirect"),
      expected,
    );
    assertEquals(
      await fetchDocumentLoader2("https://example.com/localhost-link"),
      expected,
    );
  });

  fetchMock.hardReset();
});

test("kvCache()", async (t) => {
  const kv = new MemoryKvStore();

  await t.step("cached", async () => {
    const loader = kvCache({
      kv,
      loader: mockDocumentLoader,
      rules: [
        ["https://example.org/", Temporal.Duration.from({ days: 1 })],
        [new URL("https://example.net/"), Temporal.Duration.from({ days: 1 })],
        [
          new URLPattern("https://example.com/*"),
          Temporal.Duration.from({ days: 30 }),
        ],
      ],
      prefix: ["_test", "cached"],
    });
    const result = await loader("https://example.com/object");
    assertEquals(result, {
      contextUrl: null,
      documentUrl: "https://example.com/object",
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/object",
        name: "Fetched object",
        type: "Object",
      },
    });
    const cache = await kv.get([
      "_test",
      "cached",
      "https://example.com/object",
    ]);
    assertEquals(cache, result);

    await kv.set(
      ["_test", "cached", "https://example.org/"],
      {
        contextUrl: null,
        documentUrl: "https://example.org/",
        document: {
          "id": "https://example.org/",
        },
      },
    );
    const result2 = await loader("https://example.org/");
    assertEquals(result2, {
      contextUrl: null,
      documentUrl: "https://example.org/",
      document: {
        "id": "https://example.org/",
      },
    });

    await kv.set(
      ["_test", "cached", "https://example.net/"],
      {
        contextUrl: null,
        documentUrl: "https://example.net/",
        document: {
          "id": "https://example.net/",
        },
      },
    );
    const result3 = await loader("https://example.net/");
    assertEquals(result3, {
      contextUrl: null,
      documentUrl: "https://example.net/",
      document: {
        "id": "https://example.net/",
      },
    });
  });

  await t.step("not cached", async () => {
    const loader = kvCache({
      kv,
      loader: mockDocumentLoader,
      rules: [],
      prefix: ["_test", "not cached"],
    });
    const result = await loader("https://example.com/object");
    assertEquals(result, {
      contextUrl: null,
      documentUrl: "https://example.com/object",
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/object",
        name: "Fetched object",
        type: "Object",
      },
    });
    const cache = await kv.get([
      "test2",
      "not cached",
      "https://example.com/object",
    ]);
    assertEquals(cache, undefined);
  });

  await t.step("maximum cache duration", () => {
    assertThrows(
      () =>
        kvCache({
          kv,
          loader: mockDocumentLoader,
          rules: [
            [
              "https://example.com/",
              Temporal.Duration.from({ days: 30, seconds: 1 }),
            ],
          ],
        }),
      TypeError,
      "The maximum cache duration is 30 days",
    );
    assertThrows(
      () =>
        kvCache({
          kv,
          loader: mockDocumentLoader,
          rules: [
            [
              new URLPattern("https://example.com/*"),
              Temporal.Duration.from({ days: 30, seconds: 1 }),
            ],
          ],
        }),
      TypeError,
      "The maximum cache duration is 30 days",
    );
  });

  await t.step("on kv store exception", async () => {
    class KvStoreThrowsException implements KvStore {
      get<T = unknown>(_key: KvKey): Promise<T | undefined> {
        throw new Error("Failed to get key");
      }
      set(
        _key: KvKey,
        _value: unknown,
        _options?: KvStoreSetOptions,
      ): Promise<void> {
        throw new Error("Failed to set key");
      }
      delete(_key: KvKey): Promise<void> {
        throw new Error("Failed to delete key");
      }
    }

    const loader = kvCache({
      kv: new KvStoreThrowsException(),
      loader: mockDocumentLoader,
      rules: [
        ["https://example.org/", Temporal.Duration.from({ days: 1 })],
        [new URL("https://example.net/"), Temporal.Duration.from({ days: 1 })],
        [
          new URLPattern("https://example.com/*"),
          Temporal.Duration.from({ days: 30 }),
        ],
      ],
      prefix: ["_test", "not cached"],
    });
    const result = await loader("https://example.com/object");
    assertEquals(result, {
      contextUrl: null,
      documentUrl: "https://example.com/object",
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/object",
        name: "Fetched object",
        type: "Object",
      },
    });
  });

  await t.step("preloaded contexts bypass cache", async () => {
    const kv = new MemoryKvStore();
    let loaderCalled = false;
    const mockLoader: DocumentLoader = (url: string) => {
      loaderCalled = true;
      return Promise.resolve({
        contextUrl: null,
        documentUrl: url,
        document: { "mock": "document" },
      });
    };

    const loader = kvCache({
      kv,
      loader: mockLoader,
      prefix: ["_test", "preloaded"],
    });

    // Test that preloaded context URLs return preloaded data without calling the wrapped loader
    const activityStreamsUrl = "https://www.w3.org/ns/activitystreams";
    loaderCalled = false;
    const result = await loader(activityStreamsUrl);

    assertEquals(result, {
      contextUrl: null,
      documentUrl: activityStreamsUrl,
      document: preloadedContexts[activityStreamsUrl],
    });
    assertEquals(
      loaderCalled,
      false,
      "Loader should not be called for preloaded contexts",
    );

    // Verify that the preloaded context was not cached in KV store
    const cachedValue = await kv.get([
      "_test",
      "preloaded",
      activityStreamsUrl,
    ]);
    assertEquals(
      cachedValue,
      undefined,
      "Preloaded contexts should not be cached in KV store",
    );

    // Test another preloaded context
    const securityUrl = "https://w3id.org/security/v1";
    loaderCalled = false;
    const result2 = await loader(securityUrl);

    assertEquals(result2, {
      contextUrl: null,
      documentUrl: securityUrl,
      document: preloadedContexts[securityUrl],
    });
    assertEquals(
      loaderCalled,
      false,
      "Loader should not be called for preloaded contexts",
    );

    // Test that non-preloaded URLs still use the cache normally
    const nonPreloadedUrl = "https://example.com/not-preloaded";
    loaderCalled = false;
    const result3 = await loader(nonPreloadedUrl);

    assertEquals(result3, {
      contextUrl: null,
      documentUrl: nonPreloadedUrl,
      document: { "mock": "document" },
    });
    assertEquals(
      loaderCalled,
      true,
      "Loader should be called for non-preloaded URLs",
    );

    // Verify that non-preloaded URL was cached
    const cachedValue2 = await kv.get(["_test", "preloaded", nonPreloadedUrl]);
    assertEquals(cachedValue2, result3, "Non-preloaded URLs should be cached");
  });
});

test("getUserAgent()", () => {
  if ("Deno" in globalThis) {
    assertEquals(
      getUserAgent(),
      `Fedify/${metadata.version} (Deno/${Deno.version.deno})`,
    );
    assertEquals(
      getUserAgent({ software: "MyApp/1.0.0" }),
      `MyApp/1.0.0 (Fedify/${metadata.version}; Deno/${Deno.version.deno})`,
    );
    assertEquals(
      getUserAgent({ url: "https://example.com/" }),
      `Fedify/${metadata.version} (Deno/${Deno.version.deno}; +https://example.com/)`,
    );
    assertEquals(
      getUserAgent({
        software: "MyApp/1.0.0",
        url: new URL("https://example.com/"),
      }),
      `MyApp/1.0.0 (Fedify/${metadata.version}; Deno/${Deno.version.deno}; +https://example.com/)`,
    );
  } else if ("Bun" in globalThis) {
    assertEquals(
      getUserAgent(),
      // @ts-ignore: `Bun` is a global variable in Bun
      `Fedify/${metadata.version} (Bun/${Bun.version})`,
    );
    assertEquals(
      getUserAgent({ software: "MyApp/1.0.0" }),
      // @ts-ignore: `Bun` is a global variable in Bun
      `MyApp/1.0.0 (Fedify/${metadata.version}; Bun/${Bun.version})`,
    );
    assertEquals(
      getUserAgent({ url: "https://example.com/" }),
      // @ts-ignore: `Bun` is a global variable in Bun
      `Fedify/${metadata.version} (Bun/${Bun.version}; +https://example.com/)`,
    );
    assertEquals(
      getUserAgent({
        software: "MyApp/1.0.0",
        url: new URL("https://example.com/"),
      }),
      // @ts-ignore: `Bun` is a global variable in Bun
      `MyApp/1.0.0 (Fedify/${metadata.version}; Bun/${Bun.version}; +https://example.com/)`,
    );
  } else if (navigator.userAgent === "Cloudflare-Workers") {
    assertEquals(
      getUserAgent(),
      `Fedify/${metadata.version} (Cloudflare-Workers)`,
    );
    assertEquals(
      getUserAgent({ software: "MyApp/1.0.0" }),
      `MyApp/1.0.0 (Fedify/${metadata.version}; Cloudflare-Workers)`,
    );
    assertEquals(
      getUserAgent({ url: "https://example.com/" }),
      `Fedify/${metadata.version} (Cloudflare-Workers; +https://example.com/)`,
    );
    assertEquals(
      getUserAgent({
        software: "MyApp/1.0.0",
        url: new URL("https://example.com/"),
      }),
      `MyApp/1.0.0 (Fedify/${metadata.version}; Cloudflare-Workers; +https://example.com/)`,
    );
  } else {
    assertEquals(
      getUserAgent(),
      `Fedify/${metadata.version} (Node.js/${process.versions.node})`,
    );
    assertEquals(
      getUserAgent({ software: "MyApp/1.0.0" }),
      `MyApp/1.0.0 (Fedify/${metadata.version}; Node.js/${process.versions.node})`,
    );
    assertEquals(
      getUserAgent({ url: "https://example.com/" }),
      `Fedify/${metadata.version} (Node.js/${process.versions.node}; +https://example.com/)`,
    );
    assertEquals(
      getUserAgent({
        software: "MyApp/1.0.0",
        url: new URL("https://example.com/"),
      }),
      `MyApp/1.0.0 (Fedify/${metadata.version}; Node.js/${process.versions.node}; +https://example.com/)`,
    );
  }
});

test("getDocumentLoader() records OpenTelemetry span", async (t) => {
  const [tracerProvider, exporter] = createTestTracerProvider();
  fetchMock.spyGlobal();

  await t.step("successful fetch", async () => {
    fetchMock.get("https://example.com/doc", {
      status: 200,
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Note",
      }),
    });

    const loader = getDocumentLoader();
    // We need to temporarily set the tracer provider on the global trace
    const { trace } = await import("@opentelemetry/api");
    const originalProvider = trace.getTracerProvider();
    trace.setGlobalTracerProvider(tracerProvider);

    try {
      const result = await loader("https://example.com/doc");
      assertEquals(result.documentUrl, "https://example.com/doc");

      // Check that the span was recorded
      const spans = exporter.getSpans("activitypub.fetch_document");
      assertEquals(spans.length, 1);
      const span = spans[0];

      // Check span attributes
      assertEquals(span.attributes["url.full"], "https://example.com/doc");
      assertEquals(span.attributes["http.response.status_code"], 200);
      assertEquals(
        span.attributes["docloader.document_url"],
        "https://example.com/doc",
      );
    } finally {
      trace.setGlobalTracerProvider(originalProvider);
      exporter.clear();
      fetchMock.hardReset();
    }
  });

  await t.step("redirect", async () => {
    fetchMock.spyGlobal();
    fetchMock.get("https://example.com/doc", {
      status: 302,
      headers: { "Location": "https://example.com/new-doc" },
    });
    fetchMock.get("https://example.com/new-doc", {
      status: 200,
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Note",
      }),
    });

    const loader = getDocumentLoader();
    const { trace } = await import("@opentelemetry/api");
    const originalProvider = trace.getTracerProvider();
    trace.setGlobalTracerProvider(tracerProvider);

    try {
      const result = await loader("https://example.com/doc");
      assertEquals(result.documentUrl, "https://example.com/new-doc");

      // Check that both spans were recorded (original + redirect)
      const spans = exporter.getSpans("activitypub.fetch_document");
      assertEquals(spans.length, 2);

      // Check the redirect span (last span is the original request that redirected)
      const redirectSpan = spans[spans.length - 1];
      assertEquals(
        redirectSpan.attributes["url.full"],
        "https://example.com/doc",
      );
      assertEquals(redirectSpan.attributes["http.response.status_code"], 302);
      assertEquals(
        redirectSpan.attributes["http.redirect.url"],
        "https://example.com/new-doc",
      );
    } finally {
      trace.setGlobalTracerProvider(originalProvider);
      exporter.clear();
      fetchMock.hardReset();
    }
  });
});
