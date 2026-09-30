import { test } from "@fedify/fixture";
import { CryptographicKey, Multikey } from "@fedify/vocab";
import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/assert-equals";
import { assertInstanceOf } from "@std/assert/assert-instance-of";
import { ManualClockKvStore } from "../testing/kv.ts";
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
  assertEquals(await kv.get(["pk", "2", "https://example.com/null"]), null);
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

  cache.nullKeys.set(
    "https://example.com/null",
    Temporal.Now.instant().add(Temporal.Duration.from({ minutes: 10 })),
  );
  assertEquals(await cache.get(new URL("https://example.com/null")), null);

  await kv.set(["pk", "2", "https://example.com/null2"], null);
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

test("KvKeyCache unavailable entries expire", async () => {
  const kv = new ManualClockKvStore();
  const unavailableKeyTtl = Temporal.Duration.from({ minutes: 10 });
  const cache = new KvKeyCache(kv, ["pk"], { unavailableKeyTtl });
  const keyId = new URL("https://example.com/expired");

  await cache.set(keyId, null);
  await cache.setFetchError(keyId, {
    status: 410,
    response: new Response(null, { status: 410 }),
  });

  kv.advance({ minutes: 20 });

  // `KvKeyCache` also keeps negative results in an in-process map keyed on
  // the real clock.  A fresh cache over the same store stands in for a later
  // process, whose map starts empty, so these reads go to the store, which is
  // what this test is about.
  const later = new KvKeyCache(kv, ["pk"], { unavailableKeyTtl });
  assertEquals(await later.get(keyId), undefined);
  assertEquals(await later.getFetchError(keyId), undefined);
});

test("KvKeyCache.keyTtl defaults to 30 days", () => {
  const kv = new MemoryKvStore();
  const cache = new KvKeyCache(kv, ["pk"]);
  assertEquals(cache.keyTtl.total("day"), 30);
});

test("KvKeyCache.keyTtl is configurable", () => {
  const kv = new MemoryKvStore();
  const cache = new KvKeyCache(kv, ["pk"], {
    keyTtl: Temporal.Duration.from({ days: 7 }),
  });
  assertEquals(cache.keyTtl.total("day"), 7);
});

test("KvKeyCache cached keys expire after keyTtl", async () => {
  const kv = new ManualClockKvStore();
  const cache = new KvKeyCache(kv, ["pk"], {
    keyTtl: Temporal.Duration.from({ days: 30 }),
  });
  const keyId = new URL("https://example.com/key");

  await cache.set(
    keyId,
    new CryptographicKey({ id: keyId }),
  );
  // The value is written immediately, and stays readable for as long as the
  // TTL has not elapsed, however long the test itself takes to run.
  assert(await kv.get(["pk", "2", keyId.href]) != null);
  assertInstanceOf(await cache.get(keyId), CryptographicKey);

  // ...but disappears from the underlying KvStore once keyTtl elapses.
  kv.advance({ days: 31 });
  assertEquals(await kv.get(["pk", "2", keyId.href]), undefined);

  // A miss is reported as `undefined` (key unknown), not `null` (key known
  // to be unavailable), so the caller refetches the key instead of treating
  // the actor as keyless.
  assertEquals(await cache.get(keyId), undefined);
  assertEquals(cache.nullKeys.has(keyId.href), false);

  // Refetching and caching the key again repopulates the cache.
  await cache.set(keyId, new CryptographicKey({ id: keyId }));
  const refetched = await cache.get(keyId);
  assertInstanceOf(refetched, CryptographicKey);
  assertEquals(refetched.id?.href, keyId.href);
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

test("KvKeyCache.compatibleKeyScope() keeps each purpose apart", async () => {
  const kv = new MemoryKvStore();
  const cache = new KvKeyCache(kv, ["pk"]);
  const keyId = new URL(
    "https://gw.example/.well-known/apgateway/did:key:z6Mk/actor#main-key",
  );
  const http = cache.compatibleKeyScope("httpSignature");
  await http.set(keyId, new CryptographicKey({ id: keyId }));
  await cache.compatibleKeyScope("multikey").set(keyId, null);
  assertInstanceOf(await http.get(keyId), CryptographicKey);
  assertEquals(await cache.compatibleKeyScope("multikey").get(keyId), null);
  assertEquals(
    await cache.compatibleKeyScope("cryptographicKey").get(keyId),
    undefined,
  );
  // Nor are the entries visible in the shared namespace:
  assertEquals(await cache.get(keyId), undefined);
  await http.delete(keyId);
  assertEquals(await http.get(keyId), undefined);
});

test("KvKeyCache.compatibleKeyScope() entries expire", async () => {
  const kv = new ManualClockKvStore();
  let now = Temporal.Instant.fromEpochMilliseconds(0);
  const cache = new KvKeyCache(kv, ["pk"], {
    now: () => now,
    keyTtl: Temporal.Duration.from({ days: 30 }),
    unavailableKeyTtl: Temporal.Duration.from({ minutes: 10 }),
  });
  const scope = cache.compatibleKeyScope("httpSignature");
  const keyId = new URL("https://gw.example/.well-known/apgateway/did:key:z/a");
  const nullId = new URL(
    "https://gw.example/.well-known/apgateway/did:key:z/b",
  );
  const expiringId = new URL(
    "https://gw.example/.well-known/apgateway/did:key:z/c",
  );
  await scope.set(keyId, new CryptographicKey({ id: keyId }));
  await scope.set(nullId, null);
  await scope.set(expiringId, new CryptographicKey({ id: expiringId }), {
    expires: now.add({ minutes: 5 }),
  });
  now = now.add({ minutes: 5 });
  assertInstanceOf(await scope.get(keyId), CryptographicKey);
  assertEquals(await scope.get(nullId), null);
  // The given expiration is checked on read, whenever the store evicts it:
  assertEquals(await scope.get(expiringId), undefined);
  now = now.add({ minutes: 5 });
  assertEquals(await scope.get(nullId), undefined);
  // Keys are cached for an hour at most, however long keyTtl is:
  now = Temporal.Instant.fromEpochMilliseconds(0).add({ hours: 1 });
  assertEquals(await scope.get(keyId), undefined);
  // The store evicts them as well:
  kv.advance({ hours: 1 });
  assertEquals(
    await kv.get(["pk", "__compatible", "httpSignature", keyId.href]),
    undefined,
  );
});

test("KvKeyCache.compatibleKeyScope() drops an entry replaced by an expired one", async () => {
  const kv = new MemoryKvStore();
  const now = Temporal.Now.instant();
  const cache = new KvKeyCache(kv, ["pk"], { now: () => now });
  const scope = cache.compatibleKeyScope("httpSignature");
  const keyId = new URL("https://gw.example/.well-known/apgateway/did:key:z/a");
  await scope.set(keyId, new CryptographicKey({ id: keyId }));
  await scope.set(keyId, new CryptographicKey({ id: keyId }), {
    expires: now,
  });
  assertEquals(await scope.get(keyId), undefined);
});

test("KvKeyCache.compatibleKeyScope() ignores malformed entries", async () => {
  const kv = new MemoryKvStore();
  const cache = new KvKeyCache(kv, ["pk"]);
  const keyId = new URL("https://gw.example/.well-known/apgateway/did:key:z/a");
  const entryKey = ["pk", "__compatible", "multikey", keyId.href] as const;
  await kv.set(entryKey, { key: "garbage" });
  assertEquals(
    await cache.compatibleKeyScope("multikey").get(keyId),
    undefined,
  );
  assertEquals(await kv.get(entryKey), undefined);
  // An expiration that is no time at all:
  const httpEntryKey = [
    "pk",
    "__compatible",
    "httpSignature",
    keyId.href,
  ] as const;
  await kv.set(httpEntryKey, {
    key: await new CryptographicKey({ id: keyId }).toJsonLd(),
    expires: 1e300,
  });
  assertEquals(
    await cache.compatibleKeyScope("httpSignature").get(keyId),
    undefined,
  );
  assertEquals(await kv.get(httpEntryKey), undefined);
});

test("KvKeyCache.compatibleKeyScope() keeps the owners of keys", async () => {
  const kv = new MemoryKvStore();
  const now = Temporal.Instant.fromEpochMilliseconds(0);
  const cache = new KvKeyCache(kv, ["pk"], {
    now: () => now,
    keyTtl: Temporal.Duration.from({ minutes: 5 }),
  });
  const scope = cache.compatibleKeyScope("httpSignature");
  const keyId = new URL("https://gw.example/.well-known/apgateway/did:key:z/a");
  const owner = { "@id": "ap://did:key:z/a", "@type": ["urn:example:Actor"] };
  // The configured TTL is shorter than the proof is valid, so it decides when
  // the entry expires:
  assertEquals(
    await scope.set(keyId, new CryptographicKey({ id: keyId }), {
      expires: now.add({ hours: 1 }),
      owner,
    }),
    now.add({ minutes: 5 }),
  );
  const entry = await scope.getEntry(keyId);
  assertInstanceOf(entry?.key, CryptographicKey);
  assertEquals(entry?.owner, owner);
  assertEquals(entry?.expires, now.add({ minutes: 5 }));
  // Stored entries survive a round trip through JSON:
  const entryKey = ["pk", "__compatible", "httpSignature", keyId.href] as const;
  await kv.set(entryKey, JSON.parse(JSON.stringify(await kv.get(entryKey))));
  assertEquals((await scope.getEntry(keyId))?.owner, owner);
  // A malformed owner costs the key only its owner:
  await kv.set(entryKey, { ...await kv.get(entryKey) ?? {}, owner: "bogus" });
  const malformed = await scope.getEntry(keyId);
  assertInstanceOf(malformed?.key, CryptographicKey);
  assertEquals(malformed?.owner, undefined);
  // An owner too large for some stores is not stored:
  await scope.set(keyId, new CryptographicKey({ id: keyId }), {
    owner: { ...owner, "urn:example:padding": "x".repeat(64 * 1024) },
  });
  const oversized = await scope.getEntry(keyId);
  assertInstanceOf(oversized?.key, CryptographicKey);
  assertEquals(oversized?.owner, undefined);
  // Invalid keys have neither owners nor expirations to tell:
  assertEquals(await scope.set(keyId, null, { owner }), undefined);
  assertEquals(await kv.get(entryKey), { key: null, expires: 600000 });
  assertEquals(await scope.getEntry(keyId), null);
  // Nor is anything stored with an expired proof:
  assertEquals(
    await scope.set(keyId, new CryptographicKey({ id: keyId }), {
      expires: now,
      owner,
    }),
    undefined,
  );
  assertEquals(await scope.getEntry(keyId), undefined);
});
