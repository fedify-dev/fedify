import { assertEquals } from "@std/assert";
import { test } from "../testing/mod.ts";
import type { KvKey } from "./kv.ts";
import { MemoryKvStore } from "./kv.ts";

test("MemoryKvStore", async (t) => {
  const store = new MemoryKvStore();

  await t.step("set() & get()", async () => {
    await store.set(["foo", "bar"], "foobar");
    assertEquals(await store.get(["foo", "bar"]), "foobar");
    assertEquals(await store.get(["foo"]), undefined);

    await store.set(["foo", "baz"], "baz", {
      ttl: Temporal.Duration.from({ seconds: 0 }),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(await store.get(["foo", "baz"]), undefined);
  });

  await t.step("delete()", async () => {
    await store.delete(["foo", "bar"]);
    assertEquals(await store.get(["foo", "bar"]), undefined);
  });

  await t.step("cas()", async () => {
    await store.set(["foo", "bar"], "foobar");
    assertEquals(await store.cas(["foo", "bar"], "bar", "baz"), false);
    assertEquals(await store.get(["foo", "bar"]), "foobar");
    assertEquals(await store.cas(["foo", "bar"], "foobar", "baz"), true);
    assertEquals(await store.get(["foo", "bar"]), "baz");
    await store.delete(["foo", "bar"]);
    assertEquals(await store.cas(["foo", "bar"], "foobar", "baz"), false);
    assertEquals(await store.get(["foo", "bar"]), undefined);
    assertEquals(await store.cas(["foo", "bar"], undefined, "baz"), true);
    assertEquals(await store.get(["foo", "bar"]), "baz");
  });

  await t.step("list()", async () => {
    // Setup
    await store.set(["prefix", "a"], "value-a");
    await store.set(["prefix", "b"], "value-b");
    await store.set(["prefix", "nested", "c"], "value-c");
    await store.set(["other", "x"], "value-x");
    await store.set(["prefix"], "exact-match");

    // Test: list with prefix
    const entries: { key: KvKey; value: unknown }[] = [];
    for await (const entry of store.list!({ prefix: ["prefix"] })) {
      entries.push(entry);
    }
    assertEquals(entries.length, 4); // prefix, prefix/a, prefix/b, prefix/nested/c

    // Test: verify a value
    const entryA = entries.find((e) => e.key.length === 2 && e.key[1] === "a");
    assertEquals(entryA?.value, "value-a");

    // Test: non-matching prefix returns empty
    const noMatch: { key: KvKey; value: unknown }[] = [];
    for await (const entry of store.list!({ prefix: ["nonexistent"] })) {
      noMatch.push(entry);
    }
    assertEquals(noMatch.length, 0);

    // Cleanup
    await store.delete(["prefix", "a"]);
    await store.delete(["prefix", "b"]);
    await store.delete(["prefix", "nested", "c"]);
    await store.delete(["other", "x"]);
    await store.delete(["prefix"]);
  });

  await t.step("list() filters expired entries", async () => {
    await store.set(["expired", "old"], "old-value", {
      ttl: Temporal.Duration.from({ milliseconds: 1 }),
    });
    await store.set(["expired", "valid"], "valid-value");

    await new Promise((r) => setTimeout(r, 10));

    const entries: { key: KvKey; value: unknown }[] = [];
    for await (const entry of store.list!({ prefix: ["expired"] })) {
      entries.push(entry);
    }

    assertEquals(entries.length, 1);
    assertEquals(entries[0].value, "valid-value");

    await store.delete(["expired", "valid"]);
  });
});
