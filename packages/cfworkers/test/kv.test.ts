import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { WorkersKvStore } from "../src/mod.ts";

// Mock Temporal.Duration for testing in Cloudflare Workers environment
const mockDuration = (seconds: number) => ({
  total: (unit: string) => {
    if (unit === "milliseconds" || unit === "millisecond") return seconds * 1000;
    if (unit === "seconds" || unit === "second") return seconds;
    return seconds;
  },
});

describe("WorkersKvStore", () => {
  it("set() & get()", async () => {
    const store = new WorkersKvStore(env.KV1);

    await store.set(["foo", "bar"], { foo: 1, bar: 2 });
    expect(await store.get(["foo", "bar"])).toEqual({ foo: 1, bar: 2 });
    expect(await store.get(["foo"])).toBeUndefined();
  });

  it("set() with TTL stores expiration metadata", async () => {
    const store = new WorkersKvStore(env.KV1);

    // Set a value with TTL - it should be retrievable immediately
    await store.set(["ttl", "test"], "ttl-value", {
      ttl: mockDuration(3600) as unknown as Temporal.Duration, // 1 hour
    });
    expect(await store.get(["ttl", "test"])).toBe("ttl-value");
  });

  it("delete()", async () => {
    const store = new WorkersKvStore(env.KV1);

    await store.set(["delete", "test"], "value");
    expect(await store.get(["delete", "test"])).toBe("value");

    await store.delete(["delete", "test"]);
    expect(await store.get(["delete", "test"])).toBeUndefined();
  });

  it("list()", async () => {
    const store = new WorkersKvStore(env.KV1);

    await store.set(["list-prefix", "a"], "value-a");
    await store.set(["list-prefix", "b"], "value-b");
    await store.set(["list-prefix", "nested", "c"], "value-c");
    await store.set(["list-other", "x"], "value-x");

    const entries: { key: readonly unknown[]; value: unknown }[] = [];
    for await (const entry of store.list(["list-prefix"])) {
      entries.push({ key: entry.key, value: entry.value });
    }

    expect(entries.length).toBe(3);
    expect(entries.some((e) => e.key[1] === "a" && e.value === "value-a")).toBe(
      true,
    );
    expect(entries.some((e) => e.key[1] === "b")).toBe(true);
    expect(entries.some((e) => e.key[1] === "nested")).toBe(true);
  });

  it("list() - single element key", async () => {
    const store = new WorkersKvStore(env.KV1);

    await store.set(["single-a"], "value-a");
    await store.set(["single-b"], "value-b");

    const entries: { key: readonly unknown[]; value: unknown }[] = [];
    for await (const entry of store.list(["single-a"])) {
      entries.push({ key: entry.key, value: entry.value });
    }

    expect(entries.length).toBe(1);
    expect(entries[0].value).toBe("value-a");
  });

  it("list() - empty prefix", async () => {
    const store = new WorkersKvStore(env.KV1);

    // Clear any existing data by setting known keys
    await store.set(["empty-test", "a"], "value-a");
    await store.set(["empty-test", "b", "c"], "value-bc");
    await store.set(["empty-test", "d", "e", "f"], "value-def");

    const entries: { key: readonly unknown[]; value: unknown }[] = [];
    for await (const entry of store.list()) {
      // Only count our test entries
      if (
        Array.isArray(entry.key) && entry.key[0] === "empty-test"
      ) {
        entries.push({ key: entry.key, value: entry.value });
      }
    }

    expect(entries.length).toBe(3);
  });
});
