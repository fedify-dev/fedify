import { mockDocumentLoader, test } from "@fedify/fixture";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import { preloadedContexts } from "@fedify/vocab-runtime";
import { deepStrictEqual, throws } from "node:assert";
import type {
  KvKey,
  KvStore,
  KvStoreListEntry,
  KvStoreSetOptions,
} from "../federation/kv.ts";
import { kvCache, MockKvStore } from "./kv-cache.ts";

test("kvCache()", async (t) => {
  const kv = new MockKvStore();

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
    deepStrictEqual(result, {
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
    deepStrictEqual(cache, result);

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
    deepStrictEqual(result2, {
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
    deepStrictEqual(result3, {
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
    deepStrictEqual(result, {
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
    deepStrictEqual(cache, undefined);
  });

  await t.step("maximum cache duration", () => {
    throws(
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
    throws(
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
      // deno-lint-ignore require-yield
      async *list(_prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
        throw new Error("Failed to list keys");
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
    deepStrictEqual(result, {
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
    const kv = new MockKvStore();
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

    deepStrictEqual(result, {
      contextUrl: null,
      documentUrl: activityStreamsUrl,
      document: preloadedContexts[activityStreamsUrl],
    });
    deepStrictEqual(
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
    deepStrictEqual(
      cachedValue,
      undefined,
      "Preloaded contexts should not be cached in KV store",
    );

    // Test another preloaded context
    const securityUrl = "https://w3id.org/security/v1";
    loaderCalled = false;
    const result2 = await loader(securityUrl);

    deepStrictEqual(result2, {
      contextUrl: null,
      documentUrl: securityUrl,
      document: preloadedContexts[securityUrl],
    });
    deepStrictEqual(
      loaderCalled,
      false,
      "Loader should not be called for preloaded contexts",
    );

    // Test that non-preloaded URLs still use the cache normally
    const nonPreloadedUrl = "https://example.com/not-preloaded";
    loaderCalled = false;
    const result3 = await loader(nonPreloadedUrl);

    deepStrictEqual(result3, {
      contextUrl: null,
      documentUrl: nonPreloadedUrl,
      document: { "mock": "document" },
    });
    deepStrictEqual(
      loaderCalled,
      true,
      "Loader should be called for non-preloaded URLs",
    );

    // Verify that non-preloaded URL was cached
    const cachedValue2 = await kv.get(["_test", "preloaded", nonPreloadedUrl]);
    deepStrictEqual(
      cachedValue2,
      result3,
      "Non-preloaded URLs should be cached",
    );
  });
});
