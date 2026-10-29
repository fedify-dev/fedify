import { testMessageQueue } from "@fedify/testing";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import { deepStrictEqual } from "node:assert/strict";
import { DenoKvMessageQueue, DenoKvStore } from "./mod.ts";

Deno.test("DenoKvStore", async (t) => {
  const kv = await Deno.openKv(":memory:");
  const store = new DenoKvStore(kv);

  await t.step("get()", async () => {
    await kv.set(["foo", "bar"], "foobar");
    deepStrictEqual(await store.get(["foo", "bar"]), "foobar");
  });

  await t.step("set()", async () => {
    await store.set(["foo", "baz"], "baz");
    deepStrictEqual((await kv.get<string>(["foo", "baz"])).value, "baz");
  });

  await t.step("stored null is distinct from a missing key", async () => {
    const key = ["null-value"] as const;
    const child = ["null-value", "child"] as const;
    await store.set(key, null);
    await store.set(child, null);
    deepStrictEqual(await store.get(key), null);
    deepStrictEqual(await store.get(["missing"]), undefined);
    deepStrictEqual(
      await Array.fromAsync(store.list(key)),
      [{ key, value: null }, { key: child, value: null }],
    );
    deepStrictEqual(await store.cas(key, undefined, "wrong"), false);
    deepStrictEqual(await store.cas(key, null, "replaced"), true);
    deepStrictEqual(await store.get(key), "replaced");
    deepStrictEqual(await store.cas(["missing"], null, "wrong"), false);
    await store.delete(key);
    await store.delete(child);
  });

  await t.step("delete()", async () => {
    await store.delete(["foo", "baz"]);
    deepStrictEqual((await kv.get<string>(["foo", "baz"])).value, null);
  });

  await t.step("cas()", async () => {
    await store.set(["foo", "bar"], "foobar");
    deepStrictEqual(await store.cas(["foo", "bar"], "bar", "baz"), false);
    deepStrictEqual(await store.get(["foo", "bar"]), "foobar");
    deepStrictEqual(await store.cas(["foo", "bar"], "foobar", "baz"), true);
    deepStrictEqual(await store.get(["foo", "bar"]), "baz");
    await store.delete(["foo", "bar"]);
    deepStrictEqual(await store.cas(["foo", "bar"], "foobar", "baz"), false);
    deepStrictEqual(await store.get(["foo", "bar"]), undefined);
    deepStrictEqual(await store.cas(["foo", "bar"], undefined, "baz"), true);
    deepStrictEqual(await store.get(["foo", "bar"]), "baz");
  });

  await t.step("list()", async () => {
    await store.set(["prefix", "a"], "value-a");
    await store.set(["prefix", "b"], "value-b");
    await store.set(["prefix", "nested", "c"], "value-c");
    await store.set(["other", "x"], "value-x");

    const entries: { key: Deno.KvKey; value: unknown }[] = [];
    for await (const entry of store.list(["prefix"])) {
      entries.push(entry);
    }

    deepStrictEqual(entries.length, 3);
    deepStrictEqual(
      entries.find((e) => e.key[1] === "a")?.value,
      "value-a",
    );

    // Cleanup
    await store.delete(["prefix", "a"]);
    await store.delete(["prefix", "b"]);
    await store.delete(["prefix", "nested", "c"]);
    await store.delete(["other", "x"]);
  });

  await t.step("list() - single element key", async () => {
    await store.set(["a"], "value-a");
    await store.set(["b"], "value-b");

    const entries: { key: Deno.KvKey; value: unknown }[] = [];
    for await (const entry of store.list(["a"])) {
      entries.push(entry);
    }

    deepStrictEqual(entries.length, 1);
    deepStrictEqual(entries[0].value, "value-a");

    // Cleanup
    await store.delete(["a"]);
    await store.delete(["b"]);
  });

  await t.step(
    "list() - exact prefix key should not be duplicated",
    async () => {
      // Regression test: when the exact prefix key exists alongside child keys,
      // it should only be yielded once, not twice
      await store.set(["exact"], "exact-value");
      await store.set(["exact", "child1"], "child1-value");
      await store.set(["exact", "child2"], "child2-value");

      const entries: { key: Deno.KvKey; value: unknown }[] = [];
      for await (const entry of store.list(["exact"])) {
        entries.push(entry);
      }

      // Should have exactly 3 entries, not 4 (no duplicate of ["exact"])
      deepStrictEqual(entries.length, 3);

      // Count how many times the exact prefix key appears
      const exactKeyCount =
        entries.filter((e) => e.key.length === 1 && e.key[0] === "exact")
          .length;
      deepStrictEqual(
        exactKeyCount,
        1,
        "Exact prefix key should appear only once",
      );

      // Cleanup
      await store.delete(["exact"]);
      await store.delete(["exact", "child1"]);
      await store.delete(["exact", "child2"]);
    },
  );

  await t.step("list() - empty prefix", async () => {
    // Cleanup from previous tests
    await store.delete(["foo", "bar"]);

    await store.set(["a"], "value-a");
    await store.set(["b", "c"], "value-bc");
    await store.set(["d", "e", "f"], "value-def");

    const entries: { key: Deno.KvKey; value: unknown }[] = [];
    for await (const entry of store.list()) {
      entries.push(entry);
    }

    deepStrictEqual(entries.length, 3);

    // Cleanup
    await store.delete(["a"]);
    await store.delete(["b", "c"]);
    await store.delete(["d", "e", "f"]);
  });

  kv.close();
});

Deno.test("DenoKvMessageQueue", async () => {
  const tempDir = await Deno.makeTempDir();
  const kvPath = `${tempDir}/test.db`;
  const kvs: Deno.Kv[] = [];
  try {
    await testMessageQueue(
      async () => {
        const kv = await Deno.openKv(kvPath);
        kvs.push(kv);
        return new DenoKvMessageQueue(kv);
      },
      ({ controller }) => {
        controller.abort();
        for (const kv of kvs) {
          try {
            kv.close();
          } catch {
            // Ignore errors on close
          }
        }
      },
      // Note: testOrderingKey is not enabled because Deno KV's listenQueue
      // cannot be restarted after abort (closing the KV is the only way to
      // stop it, and the ordering key test requires restarting listeners).
      // The ordering key functionality is implemented and works in production.
    );
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

Deno.test("DenoKvStore and DenoKvMessageQueue warn about deprecation", async () => {
  const records: LogRecord[] = [];
  await configure({
    sinks: { buffer: (record) => records.push(record) },
    loggers: [
      {
        category: ["fedify", "denokv", "deprecated"],
        sinks: ["buffer"],
        lowestLevel: "warning",
      },
      { category: ["logtape", "meta"], sinks: [] },
    ],
    reset: true,
  });
  try {
    const kv = await Deno.openKv(":memory:");
    try {
      new DenoKvStore(kv);
      new DenoKvStore(kv);
      new DenoKvMessageQueue(kv);
      new DenoKvMessageQueue(kv);
    } finally {
      kv.close();
    }
    const warnings = records.filter((record) => record.level === "warning");
    deepStrictEqual(warnings.length, 4);
    const messages = warnings.map((record) => JSON.stringify(record.message));
    deepStrictEqual(
      messages.map((message) => message.includes("DenoKvStore")),
      [true, true, false, false],
    );
    deepStrictEqual(
      messages.map((message) => message.includes("DenoKvMessageQueue")),
      [false, false, true, true],
    );
  } finally {
    await reset();
  }
});
