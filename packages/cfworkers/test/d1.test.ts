import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  WorkersD1KvStore,
  type WorkersD1DatabaseLike,
  type WorkersD1PreparedStatementLike,
} from "../src/mod.ts";

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

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

interface D1SpyOptions {
  /** A hook that runs, and can hold, a query or batch before sending it. */
  readonly gate?: (queries: readonly string[]) => Promise<void> | void;
  /** Whether to fail a batch instead of sending it, by its statements. */
  readonly failBatch?: (queries: readonly string[]) => boolean;
}

/** A prepared statement that remembers its query and the underlying one. */
class SpyStatement implements WorkersD1PreparedStatementLike {
  constructor(
    readonly spy: D1Spy,
    readonly query: string,
    readonly inner: D1PreparedStatement,
  ) {}

  bind(...values: unknown[]): SpyStatement {
    return new SpyStatement(this.spy, this.query, this.inner.bind(...values));
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    await this.spy.send([this.query]);
    return await this.inner.first<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<
    { readonly results: T[] }
  > {
    await this.spy.send([this.query]);
    return await this.inner.all<T>();
  }

  async run(): Promise<{ readonly meta: { readonly changes: number } }> {
    await this.spy.send([this.query]);
    return await this.inner.run();
  }
}

/**
 * Wraps a D1 binding to record the queries it runs, and optionally to delay
 * or fail batches.
 */
class D1Spy implements WorkersD1DatabaseLike {
  readonly queries: string[] = [];
  readonly batches: string[][] = [];

  constructor(
    readonly db: D1Database,
    readonly options: D1SpyOptions = {},
  ) {}

  prepare(query: string): SpyStatement {
    return new SpyStatement(this, query, this.db.prepare(query));
  }

  async send(queries: string[]): Promise<void> {
    this.queries.push(...queries);
    await this.options.gate?.(queries);
  }

  async batch(
    statements: WorkersD1PreparedStatementLike[],
  ): Promise<{ readonly meta: { readonly changes: number } }[]> {
    const spyStatements = statements as SpyStatement[];
    const queries = spyStatements.map((s) => s.query);
    this.batches.push(queries);
    if (this.options.failBatch?.(queries)) throw new Error("Injected failure");
    await this.send(queries);
    return await this.db.batch(spyStatements.map((s) => s.inner));
  }

  get ddlBatches(): number {
    return this.batches.filter((b) => b.some((q) => q.includes("CREATE")))
      .length;
  }
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
    for (const tableName of ["foo; DROP", "sqlite_kv", "SQLITE_kv", "_cf_KV"]) {
      expect(() => new WorkersD1KvStore(env.D1, { tableName }))
        .toThrow(TypeError);
    }
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

  it("initializes the table once per store instance", async () => {
    const spy = new D1Spy(env.D1);
    const store = new WorkersD1KvStore(spy);
    await Promise.all([store.get(["a"]), store.get(["b"])]);
    await store.set(["a"], 1);
    await store.cas(["a"], 1, 2);
    expect(spy.ddlBatches).toBe(1);
    const index = await env.D1.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).bind("idx_fedify_kv_expires").first<{ name: string }>();
    expect(index?.name).toBe("idx_fedify_kv_expires");
  });

  it("skips initialization when initialized is set", async () => {
    await new WorkersD1KvStore(env.D1).initialize();
    const spy = new D1Spy(env.D1);
    const store = new WorkersD1KvStore(spy, { initialized: true });
    await store.set(["a"], 1);
    expect(await store.get(["a"])).toBe(1);
    expect(await store.cas(["a"], 1, 2)).toBe(true);
    await collect(store.list());
    await store.delete(["a"]);
    expect(spy.ddlBatches).toBe(0);
    expect(spy.queries.some((q) => q.includes("CREATE"))).toBe(false);
  });

  it("retries initialization after a failure", async () => {
    let fail = true;
    const spy = new D1Spy(env.D1, {
      failBatch: (queries) => fail && queries.some((q) => q.includes("CREATE")),
    });
    const store = new WorkersD1KvStore(spy);
    await expect(store.get(["a"])).rejects.toThrow("Injected failure");
    fail = false;
    await store.set(["a"], 1);
    expect(await store.get(["a"])).toBe(1);
    expect(spy.ddlBatches).toBe(2);
  });

  it("drop()", async () => {
    const store = new WorkersD1KvStore(env.D1, { tableName: "drop_test" });
    await store.set(["a"], 1);
    await store.drop();
    const row = await env.D1.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).bind("drop_test").first();
    expect(row).toBeNull();
    // The store re-creates the table on its next use:
    expect(await store.get(["a"])).toBeUndefined();
  });

  it("works with a D1 session", async () => {
    const store = new WorkersD1KvStore(env.D1.withSession("first-primary"));
    await store.set(["session"], { a: 1 });
    expect(await store.get(["session"])).toEqual({ a: 1 });
    expect(await store.cas(["session"], { a: 1 }, 2)).toBe(true);
    expect(await collect(store.list(["session"]))).toEqual([
      { key: ["session"], value: 2 },
    ]);
  });

  it("set() purges a bounded number of expired entries", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.initialize();
    const expired = Date.now() - 1000;
    await env.D1.batch(
      Array.from(
        { length: 150 },
        (_, i) =>
          env.D1.prepare(
            "INSERT INTO fedify_kv (key, value, expires) VALUES (?, ?, ?)",
          ).bind(JSON.stringify(["expired", `${i}`]), "null", expired),
      ),
    );
    const countExpired = async () =>
      (await env.D1.prepare(
        "SELECT count(*) AS count FROM fedify_kv WHERE expires IS NOT NULL",
      ).first<{ count: number }>())?.count;
    await store.set(["a"], 1);
    expect(await countExpired()).toBe(50);
    // cas() purges them as well:
    await store.cas(["a"], 1, 2);
    expect(await countExpired()).toBe(0);
  });

  it("cas() does not match an entry that expires while in flight", async () => {
    // Regression test: the expiration must be checked against the time the
    // statement runs, not the time the Worker sent it.
    const key = ["in-flight"] as const;
    const store = new WorkersD1KvStore(env.D1);
    let liveAtGate: boolean | undefined;
    let absentObserved: boolean | undefined;
    const delayed = new WorkersD1KvStore(
      new D1Spy(env.D1, {
        async gate(queries) {
          if (!queries.some((q) => q.trimStart().startsWith("UPDATE"))) return;
          // The entry must still be live when the CAS is sent:
          liveAtGate = (await store.get(key)) !== undefined;
          // Hold the CAS until D1's clock passes the expiration, and let
          // another reader observe the entry as absent meanwhile:
          while ((await store.get(key)) !== undefined) await delay(50);
          absentObserved = await store.cas(key, undefined, undefined);
        },
      }),
    );
    await store.initialize();
    await insertRaw(key, "old", Date.now() + 500);
    expect(await delayed.cas(key, "old", "new")).toBe(false);
    expect(liveAtGate).toBe(true);
    expect(absentObserved).toBe(true);
    expect(await store.get(key)).toBeUndefined();
  });

  it("cas() with an explicit TTL on update", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.set(["ttl-update"], "a");
    expect(
      await store.cas(["ttl-update"], "a", "b", { ttl: mockDuration(3600) }),
    ).toBe(true);
    const row = await env.D1.prepare(
      "SELECT expires FROM fedify_kv WHERE key = ?",
    ).bind(JSON.stringify(["ttl-update"])).first<{ expires: number }>();
    expect(row?.expires).toBeGreaterThan(Date.now() + 3_500_000);
    expect(row?.expires).toBeLessThanOrEqual(Date.now() + 3_600_000);
  });

  it("cas() does not delete an expired entry", async () => {
    const store = new WorkersD1KvStore(env.D1);
    await store.initialize();
    await insertRaw(["expired-delete"], "stale", Date.now() - 1000);
    expect(await store.cas(["expired-delete"], "stale", undefined)).toBe(false);
  });

  it("cas() compares deeply nested values", async () => {
    const store = new WorkersD1KvStore(env.D1);
    // Deeper than json_tree() can parse:
    let deep: unknown = "leaf";
    for (let i = 0; i < 1001; i++) deep = [deep];
    await store.set(["deep"], deep);
    expect(await store.get(["deep"])).toEqual(deep);
    expect(await store.cas(["deep"], ["other"], 1)).toBe(false);
    expect(await store.cas(["deep"], deep, 1)).toBe(true);
    expect(await store.cas(["deep"], 1, deep)).toBe(true);
    expect(await store.cas(["deep"], deep, undefined)).toBe(true);
    expect(await store.get(["deep"])).toBeUndefined();
  });

  it("cas() lets only one of separate store instances win", async () => {
    const stores = Array.from(
      { length: 5 },
      () => new WorkersD1KvStore(env.D1),
    );
    await stores[0].initialize();
    const absent = await Promise.all(
      stores.map((s, i) => s.cas(["absent"], undefined, i)),
    );
    expect(absent.filter((r) => r).length).toBe(1);

    await insertRaw(["expired-race"], "stale", Date.now() - 1000);
    const expired = await Promise.all(
      stores.map((s, i) => s.cas(["expired-race"], undefined, i)),
    );
    expect(expired.filter((r) => r).length).toBe(1);
  });

  it("list() fetches up to 1,000 entries per query", async () => {
    const spy = new D1Spy(env.D1);
    const store = new WorkersD1KvStore(spy);
    await store.initialize();
    const keys = Array.from(
      { length: 2500 },
      (_, i) => ["paged", `${i}`.padStart(4, "0")] as const,
    );
    for (let i = 0; i < keys.length; i += 500) {
      await env.D1.batch(
        keys.slice(i, i + 500).map((key) =>
          env.D1.prepare(
            "INSERT INTO fedify_kv (key, value, expires) VALUES (?, ?, NULL)",
          ).bind(JSON.stringify(key), JSON.stringify(key[1])),
        ),
      );
    }
    await store.set(["paged-other"], "other");
    await store.set(["other"], "other");

    let before = spy.queries.length;
    const entries = await collect(store.list(["paged"]));
    expect(entries).toEqual(keys.map((key) => ({ key, value: key[1] })));
    // 2,500 entries in pages of 1,000, without a query to find the end:
    expect(spy.queries.length - before).toBe(3);

    before = spy.queries.length;
    expect((await collect(store.list())).length).toBe(2502);
    expect(spy.queries.length - before).toBe(3);

    // A page that ends exactly at the row limit needs one more query:
    await store.delete(["paged-other"]);
    await store.delete(["other"]);
    for (const key of keys.slice(2000)) await store.delete(key);
    before = spy.queries.length;
    expect((await collect(store.list())).length).toBe(2000);
    expect(spy.queries.length - before).toBe(3);
  });

  it("list() limits the size of each query result", async () => {
    const spy = new D1Spy(env.D1);
    const store = new WorkersD1KvStore(spy);
    // About 1.9 MB each, so 8 MiB fits five of them per query:
    const value = "x".repeat(1_900_000);
    const keys = Array.from({ length: 6 }, (_, i) => ["large", `${i}`] as const);
    for (const key of keys) await store.set(key, value);

    const before = spy.queries.length;
    const entries = await collect(store.list(["large"]));
    expect(entries.map((e) => e.key)).toEqual(keys);
    expect(entries.every((e) => e.value === value)).toBe(true);
    expect(spy.queries.length - before).toBe(2);
  });

  it("list() handles escaped, Unicode, and numeric-looking prefixes", async () => {
    const store = new WorkersD1KvStore(env.D1);
    const keys = [
      ['a"b'],
      ['a"b', "x"],
      ['a"bc'],
      ["a\\"],
      ["a\\", "x"],
      ["한글"],
      ["한글", "1"],
      ["한글x"],
      ["😀"],
      ["1"],
      ["1", "0"],
      ["10"],
      ["-1"],
      ["-10"],
    ] as const;
    for (const key of keys) await store.set(key, key.join("/"));
    const listKeys = async (prefix: readonly [string, ...string[]]) =>
      (await collect(store.list(prefix))).map((e) => e.key);
    expect(await listKeys(['a"b'])).toEqual([['a"b', "x"], ['a"b']]);
    expect(await listKeys(["a\\"])).toEqual([["a\\", "x"], ["a\\"]]);
    expect(await listKeys(["한글"])).toEqual([["한글", "1"], ["한글"]]);
    expect(await listKeys(["😀"])).toEqual([["😀"]]);
    expect(await listKeys(["1"])).toEqual([["1", "0"], ["1"]]);
    expect(await listKeys(["-1"])).toEqual([["-1"]]);
    expect(await listKeys(["1", "0"])).toEqual([["1", "0"]]);
  });
});
