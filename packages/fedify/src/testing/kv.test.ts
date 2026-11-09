import { test } from "@fedify/fixture";
import { assertEquals } from "@std/assert/assert-equals";
import { assertRejects } from "@std/assert/assert-rejects";
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

test("ManualClockKvStore serializes replacement writes and expiry reads", async () => {
  const kv = new ManualClockKvStore();
  await kv.set(["key"], "old", {
    ttl: Temporal.Duration.from({ minutes: 10 }),
  });
  kv.advance({ minutes: 11 });
  const write = kv.set(["key"], "new");
  const read = kv.get(["key"]);
  await write;
  assertEquals(await read, "new");
  assertEquals(await kv.get(["key"]), "new");

  await kv.set(["key"], "old", {
    ttl: Temporal.Duration.from({ minutes: 10 }),
  });
  kv.advance({ minutes: 11 });
  const replacement = kv.set(["key"], "new");
  const entries = Array.fromAsync(kv.list());
  await replacement;
  assertEquals(await entries, [{ key: ["key"], value: "new" }]);
});

test("ManualClockKvStore.list() keeps initial eviction and reading together", async () => {
  const kv = new ManualClockKvStore();
  const iterator = kv.list()[Symbol.asyncIterator]();
  const first = iterator.next();
  const write = kv.set(["expired"], "value", {
    ttl: Temporal.Duration.from({ seconds: 0 }),
  });
  await write;
  assertEquals(await first, { done: true, value: undefined });
  assertEquals(await kv.get(["expired"]), undefined);
});

test("ManualClockKvStore.list() yields entries before a later backend failure", async () => {
  const prefix: KvKey = ["wanted"];
  class FailingListStore extends MemoryKvStore {
    override async *list(received?: KvKey): AsyncIterable<KvStoreListEntry> {
      assertEquals(received, prefix);
      assertEquals(await this.get(["expired"]), undefined);
      yield { key: ["wanted", "first"], value: 1 };
      throw new Error("later list failure");
    }
  }
  const kv = new ManualClockKvStore(new FailingListStore());
  await kv.set(["expired"], "old", {
    ttl: Temporal.Duration.from({ minutes: 1 }),
  });
  kv.advance({ minutes: 1 });
  const iterator = kv.list(prefix)[Symbol.asyncIterator]();
  assertEquals(await iterator.next(), {
    done: false,
    value: { key: ["wanted", "first"], value: 1 },
  });
  await assertRejects(() => iterator.next(), Error, "later list failure");
});

test("ManualClockKvStore.list() streams lazily and closes on consumer exits", async () => {
  let pulls = 0;
  let closed = false;
  class CountingListStore extends MemoryKvStore {
    override async *list(): AsyncIterable<KvStoreListEntry> {
      try {
        pulls++;
        yield { key: ["first"], value: 1 };
        pulls++;
        yield { key: ["second"], value: 2 };
      } finally {
        closed = true;
      }
    }
  }
  const kv = new ManualClockKvStore(new CountingListStore());
  const entries = kv.list();
  assertEquals(pulls, 0);
  for await (const entry of entries) {
    assertEquals(entry, { key: ["first"], value: 1 });
    assertEquals(pulls, 1);
    assertEquals(closed, false);
    // Store operations must complete while the consumer suspends iteration.
    await kv.set(["state"], "after");
    assertEquals(await kv.get(["state"]), "after");
    break;
  }
  assertEquals(pulls, 1);
  assertEquals(closed, true);

  closed = false;
  const iterator = kv.list()[Symbol.asyncIterator]();
  await iterator.next();
  assertEquals(closed, false);
  await assertRejects(
    () => iterator.throw!(new Error("consumer failure")),
    Error,
    "consumer failure",
  );
  assertEquals(closed, true);
});

test("ManualClockKvStore.list() serializes next() with store writes", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const events: string[] = [];
  class BlockingListStore extends MemoryKvStore {
    override async *list(): AsyncIterable<KvStoreListEntry> {
      events.push("next:start");
      started.resolve();
      await release.promise;
      events.push("next:end");
      yield { key: ["first"], value: 1 };
    }
    override async set(
      key: KvKey,
      value: unknown,
      options?: KvStoreSetOptions,
    ): Promise<void> {
      events.push("set");
      await super.set(key, value, options);
    }
  }
  const kv = new ManualClockKvStore(new BlockingListStore());
  const iterator = kv.list()[Symbol.asyncIterator]();
  const next = iterator.next();
  await started.promise;
  const write = kv.set(["during-next"], "written");
  // An unserialized write would run before the released next() continuation.
  release.resolve();
  await Promise.all([next, write]);
  assertEquals(events, ["next:start", "next:end", "set"]);
  await iterator.return?.();
});

test("ManualClockKvStore.list() serializes return() with store writes", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const events: string[] = [];
  class ClosingListStore extends MemoryKvStore {
    override list(): AsyncIterable<KvStoreListEntry> {
      return {
        [Symbol.asyncIterator]() {
          let yielded = false;
          return {
            next(): Promise<IteratorResult<KvStoreListEntry>> {
              if (yielded)
                return Promise.resolve({ done: true, value: undefined });
              yielded = true;
              return Promise.resolve({
                done: false,
                value: { key: ["first"], value: 1 },
              });
            },
            async return(): Promise<IteratorResult<KvStoreListEntry>> {
              events.push("return:start");
              started.resolve();
              await release.promise;
              events.push("return:end");
              return { done: true, value: undefined };
            },
          };
        },
      };
    }
    override async set(
      key: KvKey,
      value: unknown,
      options?: KvStoreSetOptions,
    ): Promise<void> {
      events.push("set");
      await super.set(key, value, options);
    }
  }
  const kv = new ManualClockKvStore(new ClosingListStore());
  const iterator = kv.list()[Symbol.asyncIterator]();
  await iterator.next();
  const close = iterator.return!();
  // A missing return() forward must fail instead of leaving this test waiting.
  const forwarded = await Promise.race([
    started.promise.then(() => true),
    close.then(() => false),
  ]);
  assertEquals(forwarded, true);
  const write = kv.set(["during-return"], "written");
  release.resolve();
  await Promise.all([close, write]);
  assertEquals(events, ["return:start", "return:end", "set"]);
});

// `MemoryKvStore` treats an entry as absent at its expiration instant in
// `get()`, `cas()`, and `list()` alike.  The virtual-clock decorator must use
// the same boundary: live one nanosecond before expiry, absent at expiry.

test("ManualClockKvStore expires an entry at its exact expiration instant", async () => {
  const kv = new ManualClockKvStore();
  const ttl = Temporal.Duration.from({ minutes: 10 });
  await kv.set(["k"], "v", { ttl });

  kv.advance(ttl.subtract({ nanoseconds: 1 }));
  assertEquals(kv.now.epochNanoseconds, 599_999_999_999n);
  assertEquals(await kv.get(["k"]), "v");

  kv.advance({ nanoseconds: 1 });
  assertEquals(kv.now.epochNanoseconds, 600_000_000_000n);
  assertEquals(await kv.get(["k"]), undefined);
});

test("ManualClockKvStore.list() applies the same boundary", async () => {
  const kv = new ManualClockKvStore();
  const ttl = Temporal.Duration.from({ minutes: 10 });
  await kv.set(["k"], "v", { ttl });

  kv.advance(ttl.subtract({ nanoseconds: 1 }));
  assertEquals(await Array.fromAsync(kv.list()), [{ key: ["k"], value: "v" }]);

  kv.advance({ nanoseconds: 1 });
  assertEquals(await Array.fromAsync(kv.list()), []);
});

test("ManualClockKvStore.cas() applies the same boundary", async () => {
  const ttl = Temporal.Duration.from({ minutes: 10 });

  const beforeBoundary = new ManualClockKvStore();
  await beforeBoundary.set(["k"], "v", { ttl });
  beforeBoundary.advance(ttl.subtract({ nanoseconds: 1 }));
  assertEquals(await beforeBoundary.cas?.(["k"], "v", "w"), true);

  const atBoundary = new ManualClockKvStore();
  await atBoundary.set(["k"], "v", { ttl });
  atBoundary.advance(ttl);
  assertEquals(await atBoundary.cas?.(["k"], "v", "w"), false);
  assertEquals(await atBoundary.get(["k"]), undefined);
  assertEquals(await atBoundary.cas?.(["k"], undefined, "w"), true);
});

test("ManualClockKvStore failed set(undefined) does not add an expiration", async () => {
  const kv = new ManualClockKvStore();
  await kv.set(["k"], "v");

  await assertRejects(
    () =>
      kv.set(["k"], undefined, {
        ttl: Temporal.Duration.from({ minutes: 10 }),
      }),
    TypeError,
  );
  kv.advance({ minutes: 11 });
  assertEquals(await kv.get(["k"]), "v");
});

test("ManualClockKvStore failed set(undefined) does not clear an expiration", async () => {
  const kv = new ManualClockKvStore();
  await kv.set(["k"], "v", {
    ttl: Temporal.Duration.from({ minutes: 10 }),
  });

  await assertRejects(() => kv.set(["k"], undefined), TypeError);
  kv.advance({ minutes: 11 });
  assertEquals(await kv.get(["k"]), undefined);
});

test("ManualClockKvStore invalid set TTL preserves the old value and expiration", async () => {
  const kv = new ManualClockKvStore();
  const ttl = Temporal.Duration.from({ minutes: 10 });
  await kv.set(["k"], "before", { ttl });

  await assertRejects(
    () =>
      kv.set(["k"], "after", {
        ttl: Temporal.Duration.from({ months: 1 }),
      }),
    RangeError,
  );
  assertEquals(await kv.get(["k"]), "before");
  kv.advance(ttl);
  assertEquals(await kv.get(["k"]), undefined);
});

async function assertRejectedCasPreservesEntry(
  expectedValue: unknown,
  newValue: unknown,
  ttl: Temporal.Duration,
  errorType: typeof RangeError | typeof TypeError,
  key: KvKey = ["k"],
): Promise<void> {
  const kv = new ManualClockKvStore();
  const originalTtl = Temporal.Duration.from({ minutes: 10 });
  await kv.set(["k"], "before", { ttl: originalTtl });
  kv.advance(originalTtl.subtract({ nanoseconds: 1 }));

  await assertRejects(
    () => kv.cas!(key, expectedValue, newValue, { ttl }),
    errorType,
  );
  assertEquals(await kv.get(["k"]), "before");
  kv.advance({ nanoseconds: 1 });
  assertEquals(await kv.get(["k"]), undefined);
}

test("ManualClockKvStore validates matching CAS TTL before mutation", () =>
  assertRejectedCasPreservesEntry(
    "before",
    "after",
    Temporal.Duration.from({ months: 1 }),
    RangeError,
  ));

test("ManualClockKvStore validates mismatching CAS TTL before comparison", () =>
  assertRejectedCasPreservesEntry(
    "wrong",
    "after",
    Temporal.Duration.from({ months: 1 }),
    RangeError,
  ));

test("ManualClockKvStore rejects TTL on matching CAS deletion", () =>
  assertRejectedCasPreservesEntry(
    "before",
    undefined,
    Temporal.Duration.from({ seconds: 1 }),
    TypeError,
  ));

test("ManualClockKvStore rejects TTL on mismatching CAS deletion", () =>
  assertRejectedCasPreservesEntry(
    "wrong",
    undefined,
    Temporal.Duration.from({ seconds: 1 }),
    TypeError,
  ));

test("ManualClockKvStore rejects TTL on absent CAS deletion", () =>
  assertRejectedCasPreservesEntry(
    undefined,
    undefined,
    Temporal.Duration.from({ seconds: 1 }),
    TypeError,
    ["missing"],
  ));

test("ManualClockKvStore failed CAS preserves the original expiration", async () => {
  const kv = new ManualClockKvStore();
  const originalTtl = Temporal.Duration.from({ minutes: 10 });
  await kv.set(["k"], "before", { ttl: originalTtl });
  assertEquals(
    await kv.cas!(["k"], "wrong", "after", {
      ttl: Temporal.Duration.from({ hours: 1 }),
    }),
    false,
  );
  assertEquals(await kv.cas!(["k"], "wrong", "after"), false);
  kv.advance(originalTtl.subtract({ nanoseconds: 1 }));
  assertEquals(await kv.get(["k"]), "before");
  kv.advance({ nanoseconds: 1 });
  assertEquals(await kv.get(["k"]), undefined);
});

test("ManualClockKvStore CAS backend errors preserve the original expiration", async () => {
  class FailingCasStore extends MemoryKvStore {
    override cas(..._args: Parameters<MemoryKvStore["cas"]>): Promise<boolean> {
      return Promise.reject(new Error("backend CAS failure"));
    }
  }
  const kv = new ManualClockKvStore(new FailingCasStore());
  const originalTtl = Temporal.Duration.from({ minutes: 10 });
  await kv.set(["k"], "before", { ttl: originalTtl });
  await assertRejects(
    () =>
      kv.cas!(["k"], "before", "after", {
        ttl: Temporal.Duration.from({ hours: 1 }),
      }),
    Error,
    "backend CAS failure",
  );
  kv.advance(originalTtl.subtract({ nanoseconds: 1 }));
  assertEquals(await kv.get(["k"]), "before");
  kv.advance({ nanoseconds: 1 });
  assertEquals(await kv.get(["k"]), undefined);
});

test("ManualClockKvStore withholds CAS TTL from the wrapped store", async () => {
  const inner = new MemoryKvStore();
  const kv = new ManualClockKvStore(inner);
  await kv.set(["k"], "before");
  assertEquals(
    await kv.cas!(["k"], "before", "after", {
      ttl: Temporal.Duration.from({ nanoseconds: 1 }),
    }),
    true,
  );
  assertEquals(await inner.get(["k"]), "after");
  assertEquals(await kv.get(["k"]), "after");
  kv.advance({ nanoseconds: 1 });
  assertEquals(await kv.get(["k"]), undefined);
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
