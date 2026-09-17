import { test } from "@fedify/fixture";
import { assertEquals } from "@std/assert/assert-equals";
import {
  type KvKey,
  type KvStore,
  type KvStoreListEntry,
  type KvStoreSetOptions,
  MemoryKvStore,
} from "../federation/kv.ts";
import { createFederation } from "../federation/middleware.ts";
import { ManualClockKvStore } from "./kv.ts";
import { baseOptions, MockQueue, stringSchema } from "./tasks.ts";

// `MemoryKvStore` drops an entry only when `until(expiration).sign < 0`, in
// `get()`, `cas()`, and `list()` alike, so an entry is still live at the
// instant it expires and is gone one nanosecond later.  `ManualClockKvStore`
// exists to stand in for that store under a virtual clock, so it has to sit on
// the same side of the boundary.  These tests pin that down from both sides:
// without them, `advance(ttl)` alone never exercises the comparison, and either
// store could drift across the boundary unnoticed.

test("ManualClockKvStore keeps an entry at its exact expiration instant", async () => {
  const kv = new ManualClockKvStore();
  const ttl = Temporal.Duration.from({ minutes: 10 });
  await kv.set(["k"], "v", { ttl });

  kv.advance(ttl);
  assertEquals(kv.now, Temporal.Instant.fromEpochMilliseconds(600_000));
  assertEquals(await kv.get(["k"]), "v");

  kv.advance({ nanoseconds: 1 });
  assertEquals(await kv.get(["k"]), undefined);
});

test("ManualClockKvStore.list() applies the same boundary", async () => {
  const kv = new ManualClockKvStore();
  const ttl = Temporal.Duration.from({ minutes: 10 });
  await kv.set(["k"], "v", { ttl });

  kv.advance(ttl);
  assertEquals(await Array.fromAsync(kv.list()), [{ key: ["k"], value: "v" }]);

  kv.advance({ nanoseconds: 1 });
  assertEquals(await Array.fromAsync(kv.list()), []);
});

test("ManualClockKvStore.cas() applies the same boundary", async () => {
  const ttl = Temporal.Duration.from({ minutes: 10 });

  const atBoundary = new ManualClockKvStore();
  await atBoundary.set(["k"], "v", { ttl });
  atBoundary.advance(ttl);
  // Still live, so the swap sees "v" as the current value.
  assertEquals(await atBoundary.cas?.(["k"], "v", "w"), true);

  const pastBoundary = new ManualClockKvStore();
  await pastBoundary.set(["k"], "v", { ttl });
  pastBoundary.advance(ttl);
  pastBoundary.advance({ nanoseconds: 1 });
  // Gone, so the current value reads as `undefined` and a swap expecting the
  // old value fails.
  assertEquals(await pastBoundary.cas?.(["k"], "v", "w"), false);
  assertEquals(await pastBoundary.get(["k"]), undefined);
});

test("ManualClockKvStore.cas() without a TTL clears the expiration", async () => {
  // `MemoryKvStore.cas()` stores `null` for the expiration when no TTL is
  // given, so a successful swap makes a previously expiring entry permanent.
  // The decorator has to drop its recorded expiration for the same reason.
  const kv = new ManualClockKvStore();
  const ttl = Temporal.Duration.from({ minutes: 10 });
  await kv.set(["k"], "v", { ttl });

  assertEquals(await kv.cas?.(["k"], "v", "w"), true);
  kv.advance({ hours: 1 });
  assertEquals(await kv.get(["k"]), "w");
});

test("ManualClockKvStore withholds the TTL from the wrapped store", async () => {
  const inner = new MemoryKvStore();
  const kv = new ManualClockKvStore(inner);
  await kv.set(["k"], "v", { ttl: Temporal.Duration.from({ nanoseconds: 1 }) });

  // A TTL this short would already have elapsed on the real clock. It has not
  // on the virtual one, and the wrapped store was never told about it.
  assertEquals(await inner.get(["k"]), "v");
  assertEquals(await kv.get(["k"]), "v");
});

/**
 * A {@link KvStore} without `cas()`, standing in for backends that offer no
 * conditional write.
 */
class CaslessKvStore implements KvStore {
  readonly #inner = new MemoryKvStore();
  get<T = unknown>(key: KvKey): Promise<T | undefined> {
    return this.#inner.get<T>(key);
  }
  set(key: KvKey, value: unknown, options?: KvStoreSetOptions): Promise<void> {
    return this.#inner.set(key, value, options);
  }
  delete(key: KvKey): Promise<void> {
    return this.#inner.delete(key);
  }
  list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    return this.#inner.list(prefix);
  }
}

test("ManualClockKvStore exposes cas() only when the wrapped store does", () => {
  assertEquals(new ManualClockKvStore(new CaslessKvStore()).cas, undefined);
  assertEquals(
    typeof new ManualClockKvStore(new MemoryKvStore()).cas,
    "function",
  );
});

test("ManualClockKvStore over a store without cas() keeps the open deduplication fallback", async () => {
  // `planDeduplication()` takes the CAS path whenever `kv.cas != null`, so a
  // decorator that always exposed `cas()` would make this enqueue throw
  // instead of proceeding without deduplication as configured.
  const queue = new MockQueue();
  const federation = createFederation<void>({
    ...baseOptions,
    kv: new ManualClockKvStore(new CaslessKvStore()),
    queue: { task: queue },
    taskDeduplicationFallback: "open",
  });
  const task = federation.defineTask("casless-open-fallback", {
    schema: stringSchema,
    handler: () => {},
  });
  const ctx = federation.createContext(
    new URL("https://example.com/"),
    undefined,
  );
  await ctx.enqueueTask(task, "payload", { deduplicationKey: "k" });
  assertEquals(queue.enqueued.length, 1);
  assertEquals(queue.enqueued[0].options?.deduplicationKey, undefined);
});
