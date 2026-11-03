import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { WorkersD1KvStore } from "../src/mod.ts";

// Mock Temporal.Duration for testing in Cloudflare Workers environment
const mockDuration = (seconds: number) => ({
  total: (unit: string) => {
    if (unit === "milliseconds" || unit === "millisecond") return seconds * 1000;
    if (unit === "seconds" || unit === "second") return seconds;
    return seconds;
  },
}) as unknown as Temporal.Duration;

async function insertRaw(
  key: readonly string[],
  value: unknown,
  expires: number | null,
  tableName = "fedify_kv",
): Promise<void> {
  await env.D1.prepare(
    `INSERT OR REPLACE INTO "${tableName}" (key, value, expires)
     VALUES (?, ?, ?)`,
  ).bind(JSON.stringify(key), JSON.stringify(value), expires).run();
}

async function collect(
  iterable: AsyncIterable<{ key: readonly string[]; value: unknown }>,
): Promise<{ key: readonly string[]; value: unknown }[]> {
  const entries = [];
  for await (const entry of iterable) entries.push(entry);
  return entries;
}

describe("WorkersD1KvStore", () => {
  it("rejects an invalid table name", () => {
    expect(() => new WorkersD1KvStore(env.D1, { tableName: "foo; DROP" }))
      .toThrow(TypeError);
  });

  it("initialize() creates the table", async () => {
    const store = new WorkersD1KvStore(env.D1, { tableName: "init_test" });
    await store.initialize();
    await store.initialize();
    const row = await env.D1.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).bind("init_test").first<{ name: string }>();
    expect(row?.name).toBe("init_test");
  });

  it("set() & get()", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.set(["foo", "bar"], { foo: 1, bar: 2 });
    expect(await store.get(["foo", "bar"])).toEqual({ foo: 1, bar: 2 });
    expect(await store.get(["foo"])).toBeUndefined();

    await store.set(["foo", "bar"], [1, "two"]);
    expect(await store.get(["foo", "bar"])).toEqual([1, "two"]);
  });

  it("keeps stored null distinct from a missing key", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.set(["null-value"], null);
    expect(await store.get(["null-value"])).toBeNull();
    expect(await store.get(["missing"])).toBeUndefined();
  });

  it("set() with TTL", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.set(["ttl"], "value", { ttl: mockDuration(3600) });
    expect(await store.get(["ttl"])).toBe("value");
    const row = await env.D1.prepare(
      "SELECT expires FROM fedify_kv WHERE key = ?",
    ).bind(JSON.stringify(["ttl"])).first<{ expires: number }>();
    expect(row?.expires).toBeGreaterThan(Date.now() + 3_500_000);
  });

  it("get() excludes expired entries", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.initialize();
    await insertRaw(["expired"], "stale", Date.now() - 1000);
    await insertRaw(["fresh"], "live", Date.now() + 60_000);
    expect(await store.get(["expired"])).toBeUndefined();
    expect(await store.get(["fresh"])).toBe("live");
  });

  it("set() purges expired entries", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.initialize();
    await insertRaw(["expired"], "stale", Date.now() - 1000);
    await store.set(["other"], "value");
    const row = await env.D1.prepare(
      "SELECT count(*) AS count FROM fedify_kv WHERE key = ?",
    ).bind(JSON.stringify(["expired"])).first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  it("delete()", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.set(["delete"], "value");
    await store.delete(["delete"]);
    expect(await store.get(["delete"])).toBeUndefined();
    await store.delete(["nonexistent"]);
  });

  it("uses a custom table name", async () => {
    const store = new WorkersD1KvStore(env.D1, { tableName: "custom_kv" });
    await store.set(["custom"], "value");
    const row = await env.D1.prepare(
      "SELECT value FROM custom_kv WHERE key = ?",
    ).bind(JSON.stringify(["custom"])).first<{ value: string }>();
    expect(row?.value).toBe('"value"');
  });

  it("cas()", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.set(["foo", "bar"], "foobar");
    expect(await store.cas(["foo", "bar"], "bar", "baz")).toBe(false);
    expect(await store.get(["foo", "bar"])).toBe("foobar");
    expect(await store.cas(["foo", "bar"], "foobar", "baz")).toBe(true);
    expect(await store.get(["foo", "bar"])).toBe("baz");

    // Creates a missing entry only when undefined is expected:
    expect(await store.cas(["new"], "x", "y")).toBe(false);
    expect(await store.get(["new"])).toBeUndefined();
    expect(await store.cas(["new"], undefined, "created")).toBe(true);
    expect(await store.get(["new"])).toBe("created");
    expect(await store.cas(["new"], undefined, "again")).toBe(false);
    expect(await store.get(["new"])).toBe("created");

    // Deletes the entry when the new value is undefined:
    expect(await store.cas(["new"], "wrong", undefined)).toBe(false);
    expect(await store.cas(["new"], "created", undefined)).toBe(true);
    expect(await store.get(["new"])).toBeUndefined();
    expect(await store.cas(["new"], undefined, undefined)).toBe(true);
    await store.set(["new"], null);
    expect(await store.cas(["new"], undefined, undefined)).toBe(false);
  });

  it("cas() compares values structurally", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.set(["obj"], { a: 1, b: [1, 2, { c: null }] });
    // Order of object members does not matter:
    expect(await store.cas(["obj"], { b: [1, 2, { c: null }], a: 1 }, 1))
      .toBe(true);
    expect(await store.get(["obj"])).toBe(1);

    await store.set(["arr"], [1, 2]);
    // Order of array elements matters:
    expect(await store.cas(["arr"], [2, 1], "x")).toBe(false);
    // Missing or extra elements and members do not match:
    expect(await store.cas(["arr"], [1], "x")).toBe(false);
    expect(await store.cas(["arr"], [1, 2, 3], "x")).toBe(false);
    // Scalar types matter:
    expect(await store.cas(["arr"], ["1", "2"], "x")).toBe(false);
    expect(await store.get(["arr"])).toEqual([1, 2]);

    await store.set(["empty"], {});
    expect(await store.cas(["empty"], [], "x")).toBe(false);
    expect(await store.cas(["empty"], { a: 1 }, "x")).toBe(false);
    expect(await store.cas(["empty"], {}, "x")).toBe(true);

    await store.set(["nullish"], null);
    expect(await store.cas(["nullish"], false, "x")).toBe(false);
    expect(await store.cas(["nullish"], null, "x")).toBe(true);
  });

  it("cas() treats expired entries as missing", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.initialize();
    await insertRaw(["expired"], "stale", Date.now() - 1000);
    expect(await store.cas(["expired"], "stale", "x")).toBe(false);
    expect(await store.cas(["expired"], undefined, "fresh")).toBe(true);
    expect(await store.get(["expired"])).toBe("fresh");
  });

  it("cas() with TTL", async () => {
    const store = new WorkersD1KvStore(env.D1);
    expect(
      await store.cas(["ttl"], undefined, "a", { ttl: mockDuration(3600) }),
    ).toBe(true);
    expect(await store.cas(["ttl"], "a", "b")).toBe(true);
    const row = await env.D1.prepare(
      "SELECT expires FROM fedify_kv WHERE key = ?",
    ).bind(JSON.stringify(["ttl"])).first<{ expires: number | null }>();
    expect(row?.expires).toBeNull();
  });

  it("cas() is atomic under concurrency", async () => {
    const store = new WorkersD1KvStore(env.D1);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.cas(["lock"], undefined, i)),
    );
    expect(results.filter((r) => r).length).toBe(1);

    await store.set(["counter"], 0);
    const swaps = await Promise.all(
      Array.from({ length: 10 }, () => store.cas(["counter"], 0, 1)),
    );
    expect(swaps.filter((r) => r).length).toBe(1);
  });

  it("list()", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.set(["prefix"], "root");
    await store.set(["prefix", "a"], "value-a");
    await store.set(["prefix", "b"], "value-b");
    await store.set(["prefix", "nested", "c"], "value-c");
    await store.set(["prefixed", "x"], "value-x");
    await store.set(["other", "x"], "value-x");

    // Entries are ordered by their JSON-encoded keys:
    expect(await collect(store.list(["prefix"]))).toEqual([
      { key: ["prefix", "a"], value: "value-a" },
      { key: ["prefix", "b"], value: "value-b" },
      { key: ["prefix", "nested", "c"], value: "value-c" },
      { key: ["prefix"], value: "root" },
    ]);
    expect(await collect(store.list(["prefix", "nested"]))).toEqual([
      { key: ["prefix", "nested", "c"], value: "value-c" },
    ]);
    expect((await collect(store.list())).length).toBe(6);
    expect(await collect(store.list(["missing"]))).toEqual([]);
  });

  it("list() handles LIKE wildcards literally", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.set(["a%", "1"], 1);
    await store.set(["a_", "2"], 2);
    await store.set(["ab", "3"], 3);
    expect(await collect(store.list(["a%"]))).toEqual([
      { key: ["a%", "1"], value: 1 },
    ]);
    expect(await collect(store.list(["a_"]))).toEqual([
      { key: ["a_", "2"], value: 2 },
    ]);
  });

  it("list() excludes expired entries", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.initialize();
    await insertRaw(["expired-list"], "stale-root", Date.now() - 1000);
    await insertRaw(["expired-list", "stale"], "stale", Date.now() - 1000);
    await insertRaw(["expired-list", "fresh"], "fresh", null);
    expect(await collect(store.list(["expired-list"]))).toEqual([
      { key: ["expired-list", "fresh"], value: "fresh" },
    ]);
  });
});
