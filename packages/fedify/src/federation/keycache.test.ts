import { test } from "@fedify/fixture";
import { CryptographicKey, Multikey } from "@fedify/vocab";
import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/assert-equals";
import { assertInstanceOf } from "@std/assert/assert-instance-of";
import { KvKeyCache } from "./keycache.ts";
import { MemoryKvStore } from "./kv.ts";

test("KvKeyCache.set()", async () => {
  const kv = new MemoryKvStore();
  const cache = new KvKeyCache(kv, ["pk"]);

  await cache.set(
    new URL("https://example.com/key"),
    new CryptographicKey({ id: new URL("https://example.com/key") }),
  );
  assertEquals(
    await kv.get(["pk", "https://example.com/key"]),
    {
      "@context": "https://w3id.org/security/v1",
      id: "https://example.com/key",
      type: "CryptographicKey",
    },
  );

  await cache.set(
    new URL("https://example.com/key2"),
    new Multikey({ id: new URL("https://example.com/key2") }),
  );
  assertEquals(
    await kv.get(["pk", "https://example.com/key2"]),
    {
      "@context": "https://w3id.org/security/multikey/v1",
      id: "https://example.com/key2",
      type: "Multikey",
    },
  );

  await cache.set(new URL("https://example.com/null"), null);
  assert(cache.nullKeys.has("https://example.com/null"));
  assertEquals(await kv.get(["pk", "https://example.com/null"]), null);
});

test("KvKeyCache.get()", async () => {
  const kv = new MemoryKvStore();
  const cache = new KvKeyCache(kv, ["pk"]);

  await kv.set(["pk", "https://example.com/key"], {
    "@context": "https://w3id.org/security/v1",
    id: "https://example.com/key",
    type: "CryptographicKey",
  });
  const cryptoKey = await cache.get(new URL("https://example.com/key"));
  assertInstanceOf(cryptoKey, CryptographicKey);
  assertEquals(cryptoKey?.id?.href, "https://example.com/key");

  await kv.set(["pk", "https://example.com/key2"], {
    "@context": "https://w3id.org/security/multikey/v1",
    id: "https://example.com/key2",
    type: "Multikey",
  });
  const multikey = await cache.get(new URL("https://example.com/key2"));
  assertInstanceOf(multikey, Multikey);
  assertEquals(multikey?.id?.href, "https://example.com/key2");

  cache.nullKeys.add("https://example.com/null");
  assertEquals(await cache.get(new URL("https://example.com/null")), null);

  await kv.set(["pk", "https://example.com/null2"], null);
  const cache2 = new KvKeyCache(kv, ["pk"]);
  assertEquals(await cache2.get(new URL("https://example.com/null2")), null);
});

test("KvKeyCache fetch error metadata", async () => {
  const kv = new MemoryKvStore();
  const cache = new KvKeyCache(kv, ["pk"]);
  const keyId = new URL("https://example.com/key");

  await cache.setFetchError(keyId, {
    status: 410,
    response: new Response("gone", {
      status: 410,
      statusText: "Gone",
      headers: { "content-type": "text/plain" },
    }),
  });
  const httpError = await cache.getFetchError(keyId);
  assert(httpError != null && "status" in httpError);
  if (httpError == null || !("status" in httpError)) {
    throw new Error("Expected HTTP fetch error metadata.");
  }
  assertEquals(httpError.status, 410);
  assertEquals(httpError.response.status, 410);
  assertEquals(await httpError.response.text(), "gone");

  await cache.setFetchError(keyId, {
    error: Object.assign(new Error("boom"), { name: "TypeError" }),
  });
  const nonHttpError = await cache.getFetchError(keyId);
  assert(nonHttpError != null && "error" in nonHttpError);
  if (nonHttpError == null || !("error" in nonHttpError)) {
    throw new Error("Expected non-HTTP fetch error metadata.");
  }
  assertEquals(nonHttpError.error.name, "TypeError");
  assertEquals(nonHttpError.error.message, "boom");

  await cache.setFetchError(keyId, null);
  assertEquals(await cache.getFetchError(keyId), undefined);
});
