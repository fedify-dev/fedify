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
    await kv.get(["pk", "2", "https://example.com/key"]),
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
    await kv.get(["pk", "2", "https://example.com/key2"]),
    {
      "@context": "https://w3id.org/security/multikey/v1",
      id: "https://example.com/key2",
      type: "Multikey",
    },
  );

  await cache.set(new URL("https://example.com/null"), null);
  assert(cache.nullKeys.has("https://example.com/null"));
  assertEquals(
    await kv.get(["pk", "2", "https://example.com/null"]),
    { _fedify: "key-unavailable" },
  );
});

test("KvKeyCache.get()", async () => {
  const kv = new MemoryKvStore();
  const cache = new KvKeyCache(kv, ["pk"]);

  await kv.set(["pk", "2", "https://example.com/key"], {
    "@context": "https://w3id.org/security/v1",
    id: "https://example.com/key",
    type: "CryptographicKey",
  });
  const cryptoKey = await cache.get(new URL("https://example.com/key"));
  assertInstanceOf(cryptoKey, CryptographicKey);
  assertEquals(cryptoKey?.id?.href, "https://example.com/key");

  await kv.set(["pk", "2", "https://example.com/key2"], {
    "@context": "https://w3id.org/security/multikey/v1",
    id: "https://example.com/key2",
    type: "Multikey",
  });
  const multikey = await cache.get(new URL("https://example.com/key2"));
  assertInstanceOf(multikey, Multikey);
  assertEquals(multikey?.id?.href, "https://example.com/key2");

  cache.nullKeys.add("https://example.com/null");
  assertEquals(await cache.get(new URL("https://example.com/null")), null);

  await kv.set(
    ["pk", "2", "https://example.com/null2"],
    { _fedify: "key-unavailable" },
  );
  const cache2 = new KvKeyCache(kv, ["pk"]);
  assertEquals(await cache2.get(new URL("https://example.com/null2")), null);
});

test("KvKeyCache.get() ignores entries from an earlier generation", async () => {
  const kv = new MemoryKvStore();
  const cache = new KvKeyCache(kv, ["pk"]);

  // A key cached before ownership was verified may name any owner at all, so
  // the whole previous generation has to be left behind rather than trusted
  // after an upgrade.  See GHSA-q9f8-5hc7-898f.
  await kv.set(["pk", "https://example.com/key"], {
    "@context": "https://w3id.org/security/v1",
    id: "https://example.com/key",
    owner: "https://example.com/impersonated",
    type: "CryptographicKey",
  });
  assertEquals(await cache.get(new URL("https://example.com/key")), undefined);
});
