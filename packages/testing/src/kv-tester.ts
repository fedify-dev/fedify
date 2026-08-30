import type { KvKey, KvStore, KvStoreListEntry } from "@fedify/fedify";
import { delay } from "es-toolkit";
import { deepStrictEqual, strictEqual } from "node:assert/strict";

/**
 * Options for {@link testKvStore}.
 */
export interface TestKvStoreOptions {
  /**
   * Whether to test compare-and-swap support.  By default, these tests run
   * when the store implements {@link KvStore.cas}.
   */
  readonly testCas?: boolean;

  /**
   * Whether to test time-to-live support.  `true` by default.
   * @default true
   */
  readonly testTtl?: boolean;
}

/**
 * Tests a {@link KvStore} implementation with a standard set of tests.
 *
 * The suite covers reads and writes, deletion, structured keys and values,
 * prefix listing, TTL expiration, and optional compare-and-swap behavior.
 * Every key is isolated below a random prefix and is deleted after the suite.
 *
 * @example
 * ```typescript ignore
 * import { test } from "@fedify/fixture";
 * import { testKvStore } from "@fedify/testing";
 * import { MyKvStore } from "./my-kv.ts";
 *
 * test("MyKvStore", () =>
 *   testKvStore(
 *     () => new MyKvStore(),
 *     async ({ store }) => await store.close(),
 *   )
 * );
 * ```
 *
 * @param getKvStore A factory that creates the store to test.
 * @param onFinally A cleanup function called after the suite completes.
 * @param options Optional configuration for the suite.
 */
export default async function testKvStore<KV extends KvStore>(
  getKvStore: () => KV | Promise<KV>,
  onFinally: ({ store }: { store: KV }) => Promise<void> | void,
  options: TestKvStoreOptions = {},
): Promise<void> {
  const store = await getKvStore();
  const prefix = [`fedify_test_${crypto.randomUUID()}`] as KvKey;
  const key = (...segments: string[]): KvKey =>
    [...prefix, ...segments] as KvKey;

  try {
    strictEqual(await store.get(key("missing")), undefined);

    const values = [
      "text",
      42,
      true,
      null,
      [1, "two", false],
      { nested: { value: "test" } },
    ] as const;
    for (const [index, value] of values.entries()) {
      const valueKey = key("values", index.toString());
      await store.set(valueKey, value);
      deepStrictEqual(await store.get(valueKey), value);
    }

    const overwriteKey = key("overwrite");
    await store.set(overwriteKey, "before");
    await store.set(overwriteKey, "after");
    strictEqual(await store.get(overwriteKey), "after");

    const deleteKey = key("delete");
    await store.set(deleteKey, "value");
    await store.delete(deleteKey);
    strictEqual(await store.get(deleteKey), undefined);
    await store.delete(deleteKey);

    const isolatedKeys = [
      key("a", "b"),
      key("a,b"),
      key("a:b"),
    ] as const;
    for (const [index, isolatedKey] of isolatedKeys.entries()) {
      await store.set(isolatedKey, index);
    }
    for (const [index, isolatedKey] of isolatedKeys.entries()) {
      strictEqual(await store.get(isolatedKey), index);
    }

    if (options.testTtl ?? true) {
      const expiringKey = key("ttl", "expiring");
      await store.set(expiringKey, "expired", {
        ttl: Temporal.Duration.from({ milliseconds: 50 }),
      });
      await delay(100);
      strictEqual(await store.get(expiringKey), undefined);
      deepStrictEqual(await collect(store.list(key("ttl"))), []);

      const refreshedKey = key("ttl", "refreshed");
      await store.set(refreshedKey, "temporary", {
        ttl: Temporal.Duration.from({ milliseconds: 50 }),
      });
      await store.set(refreshedKey, "persistent");
      await delay(100);
      strictEqual(await store.get(refreshedKey), "persistent");
    }

    const listPrefix = key("list");
    const listEntries = [
      { key: listPrefix, value: "exact" },
      { key: key("list", "child"), value: "child" },
      { key: key("list", "child", "nested"), value: "nested" },
      { key: key("list-other"), value: "other" },
    ] as const;
    for (const entry of listEntries) await store.set(entry.key, entry.value);

    deepStrictEqual(
      normalize(await collect(store.list(listPrefix))),
      normalize(listEntries.slice(0, 3)),
    );
    const prefixedEntries = await collect(store.list(prefix));
    const allEntries = await collect(store.list());
    deepStrictEqual(
      normalize(filterByPrefix(allEntries, prefix)),
      normalize(prefixedEntries),
    );
    const emptyPrefixEntries = await collect(
      store.list([] as unknown as KvKey),
    );
    deepStrictEqual(
      normalize(filterByPrefix(emptyPrefixEntries, prefix)),
      normalize(prefixedEntries),
    );

    if (options.testCas ?? store.cas != null) {
      if (store.cas == null) {
        throw new TypeError("KvStore.cas is not implemented");
      }
      const cas = store.cas.bind(store);
      const casKey = key("cas", "value");
      strictEqual(await cas(casKey, "wrong", "value"), false);
      strictEqual(await cas(casKey, undefined, "created"), true);
      strictEqual(await cas(casKey, "wrong", "updated"), false);
      strictEqual(await cas(casKey, "created", "updated"), true);
      strictEqual(await store.get(casKey), "updated");
      strictEqual(await cas(casKey, "updated", undefined), true);
      strictEqual(await store.get(casKey), undefined);

      if (options.testTtl ?? true) {
        const expiredCasKey = key("cas", "expired");
        await store.set(expiredCasKey, "old", {
          ttl: Temporal.Duration.from({ milliseconds: 50 }),
        });
        await delay(100);
        strictEqual(await cas(expiredCasKey, undefined, "replaced"), true);

        const ttlCasKey = key("cas", "ttl");
        strictEqual(
          await cas(ttlCasKey, undefined, "temporary", {
            ttl: Temporal.Duration.from({ milliseconds: 50 }),
          }),
          true,
        );
        await delay(100);
        strictEqual(await store.get(ttlCasKey), undefined);
      }

      const concurrentKey = key("cas", "concurrent");
      const results = await Promise.all(
        Array.from(
          { length: 8 },
          (_, index) => cas(concurrentKey, undefined, index),
        ),
      );
      strictEqual(results.filter(Boolean).length, 1);
    }
  } finally {
    for await (const entry of store.list(prefix)) await store.delete(entry.key);
    await onFinally({ store });
  }
}

async function collect(
  entries: AsyncIterable<KvStoreListEntry>,
): Promise<KvStoreListEntry[]> {
  const results: KvStoreListEntry[] = [];
  for await (const entry of entries) results.push(entry);
  return results;
}

function normalize(
  entries: readonly KvStoreListEntry[],
): string[] {
  return entries.map((entry) => JSON.stringify(entry)).sort();
}

function filterByPrefix(
  entries: readonly KvStoreListEntry[],
  prefix: KvKey,
): KvStoreListEntry[] {
  return entries.filter((entry) =>
    prefix.every((segment, index) => entry.key[index] === segment)
  );
}
