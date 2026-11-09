// These tests intentionally sequence setup reads and yield between torn reads.
/* oxlint-disable eslint/no-await-in-loop */
import {
  type AtomicKvStore,
  type KvKey,
  type KvStoreCasEntry,
  type KvStoreSetEntry,
  type KvStoreSetOptions,
  MemoryKvStore,
} from "@fedify/fedify";
import { test } from "@fedify/fixture";
import {
  AssertionError,
  deepStrictEqual,
  ok,
  rejects,
  strictEqual,
} from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import "temporal-polyfill/global";
import testAtomicKvStore, {
  type AtomicKvStoreTestPair,
  type TestAtomicKvStoreOptions,
  type TestAtomicKvStoreRejections,
} from "./atomic-kv-tester.ts";

const memoryOptions = { objectKeyOrder: "ignored" } as const;

test("testAtomicKvStore() validates Memory with fresh pairs and disposes each", async () => {
  let created = 0;
  let disposed = 0;
  await testAtomicKvStore(() => {
    created++;
    const store = new MemoryKvStore();
    return {
      first: store,
      second: store,
      dispose() {
        disposed++;
      },
    };
  }, memoryOptions);
  ok(created > 10);
  strictEqual(disposed, created);
});

test("testAtomicKvStore() supports scoped non-prefix-preserving keys and limit probes", () =>
  testAtomicKvStore(() => pair(new ScopedMemoryKvStore()), {
    ...memoryOptions,
    key: (key): KvKey => ["{atomic}", ...[...key].reverse()],
    rejections: limitProbes,
  }));

test("testAtomicKvStore() accepts repeated keys in snapshot limit probes", async () => {
  let probed = false;
  class ObservedLimitStore extends LimitedMemoryKvStore {
    override async getMany<T = unknown>(
      keys: readonly KvKey[],
    ): Promise<(T | undefined)[]> {
      if (keys.length > 8) {
        deepStrictEqual(
          keys,
          Array.from({ length: 9 }, () => keys[0]),
        );
        probed = true;
      }
      return await super.getMany<T>(keys);
    }
  }
  await testAtomicKvStore(() => pair(new ObservedLimitStore()), {
    ...memoryOptions,
    rejections: (key) => ({
      getMany: Array.from({ length: 9 }, () => key("repeated-read-limit")),
    }),
  });
  strictEqual(probed, true);
});

test("testAtomicKvStore() rejects repeated keys in deletion limit probes", async () => {
  let probed = false;
  class ObservedDeleteStore extends MemoryKvStore {
    override async deleteMany(keys: readonly KvKey[]): Promise<void> {
      if (keys.some((key) => key.includes("repeated-delete-limit"))) {
        probed = true;
      }
      await super.deleteMany(keys);
    }
  }
  await rejects(
    () =>
      testAtomicKvStore(() => pair(new ObservedDeleteStore()), {
        ...memoryOptions,
        rejections: (key) => ({
          deleteMany: [
            key("repeated-delete-limit"),
            key("repeated-delete-limit"),
          ],
        }),
      }),
    /limit\/scope probes must contain distinct structural keys/,
  );
  strictEqual(probed, false);
});

test("testAtomicKvStore() detects partial setMany before limit rejection", async () => {
  await rejects(
    () =>
      testAtomicKvStore(() => pair(new LimitedMemoryKvStore("setMany")), {
        ...memoryOptions,
        rejections: limitProbes,
      }),
    /setMany rejection must leave every key unchanged/,
  );
});

test("testAtomicKvStore() detects partial deleteMany before limit rejection", async () => {
  await rejects(
    () =>
      testAtomicKvStore(() => pair(new LimitedMemoryKvStore("deleteMany")), {
        ...memoryOptions,
        rejections: limitProbes,
      }),
    /deleteMany rejection must leave every key unchanged/,
  );
});

test("testAtomicKvStore() detects partial casMany before limit rejection", async () => {
  await rejects(
    () =>
      testAtomicKvStore(() => pair(new LimitedMemoryKvStore("casMany")), {
        ...memoryOptions,
        rejections: limitProbes,
      }),
    /casMany rejection must leave every key unchanged/,
  );
});

test("testAtomicKvStore() detects actual torn reads with a yielding read mutant", async () => {
  await rejects(
    () =>
      testAtomicKvStore(() => pair(new TornReadMemoryKvStore()), memoryOptions),
    /setMany snapshot must not tear/,
  );
});

test("testAtomicKvStore() detects duplicate CAS keys hidden by mismatch", async () => {
  class CompareBeforeValidationKvStore extends MemoryKvStore {
    override async casMany(
      entries: readonly KvStoreCasEntry[],
    ): Promise<boolean> {
      if (
        new Set(entries.map((entry) => JSON.stringify(entry.key))).size <
        entries.length
      ) {
        for (const entry of entries) {
          if (
            !isDeepStrictEqual(await this.get(entry.key), entry.expectedValue)
          )
            return false;
        }
      }
      return await super.casMany(entries);
    }
  }
  await rejects(
    () =>
      testAtomicKvStore(
        () => pair(new CompareBeforeValidationKvStore()),
        memoryOptions,
      ),
    /duplicate CAS keys must reject even on mismatch/,
  );
});

for (const mode of ["single", "batch"] as const) {
  test(`testAtomicKvStore() detects ${mode} CAS matching null against absence`, async () => {
    class NullAbsenceKvStore extends MemoryKvStore {
      override async cas(
        key: KvKey,
        expectedValue: unknown,
        newValue: unknown,
        options?: KvStoreSetOptions,
      ): Promise<boolean> {
        if (
          mode === "single" &&
          expectedValue === null &&
          (await this.get(key)) === undefined
        ) {
          expectedValue = undefined;
        }
        return await super.cas(key, expectedValue, newValue, options);
      }
      override async casMany(
        entries: readonly KvStoreCasEntry[],
      ): Promise<boolean> {
        const normalized: KvStoreCasEntry[] = [];
        for (const entry of entries) {
          normalized.push(
            mode === "batch" &&
              entry.expectedValue === null &&
              (await this.get(entry.key)) === undefined
              ? { ...entry, expectedValue: undefined }
              : entry,
          );
        }
        return await super.casMany(normalized);
      }
    }
    await rejects(
      () =>
        testAtomicKvStore(() => pair(new NullAbsenceKvStore()), memoryOptions),
      new RegExp(`${mode} CAS must not match null against absence`),
    );
  });
}

test("testAtomicKvStore() detects single CAS retaining an old TTL", async () => {
  class RetainedTtlKvStore extends MemoryKvStore {
    ttls = new Map<string, Temporal.Duration>();
    override async set(
      key: KvKey,
      value: unknown,
      options?: KvStoreSetOptions,
    ): Promise<void> {
      await super.set(key, value, options);
      const encoded = JSON.stringify(key);
      if (options?.ttl == null) this.ttls.delete(encoded);
      else this.ttls.set(encoded, options.ttl);
    }
    override cas(
      key: KvKey,
      expectedValue: unknown,
      newValue: unknown,
      options?: KvStoreSetOptions,
    ): Promise<boolean> {
      const ttl = this.ttls.get(JSON.stringify(key));
      return super.cas(
        key,
        expectedValue,
        newValue,
        options ?? (ttl == null ? undefined : { ttl }),
      );
    }
  }
  await rejects(
    () =>
      testAtomicKvStore(() => pair(new RetainedTtlKvStore()), memoryOptions),
    /replacement must clear or replace TTLs/,
  );
});

test("testAtomicKvStore() detects partial writes before sparse input rejection", async () => {
  class SparseWriteKvStore extends MemoryKvStore {
    override async setMany(entries: readonly KvStoreSetEntry[]): Promise<void> {
      if (Array.from(entries).some((entry) => entry == null)) {
        for (const entry of entries) {
          if (entry == null) throw new TypeError("missing batch element");
          await super.set(entry.key, entry.value, entry.options);
        }
      } else await super.setMany(entries);
    }
  }
  await rejects(
    () =>
      testAtomicKvStore(() => pair(new SparseWriteKvStore()), memoryOptions),
    /setMany must reject sparse input without changing state/,
  );
});

test("testAtomicKvStore() disposes a pair after an assertion failure", async () => {
  let disposed = 0;
  await rejects(
    () =>
      testAtomicKvStore(
        () => ({
          ...pair(new EmptyReadMemoryKvStore()),
          dispose() {
            disposed++;
          },
        }),
        memoryOptions,
      ),
    AssertionError,
  );
  strictEqual(disposed, 1);
});

test("testAtomicKvStore() retains assertion and disposal failures", async () => {
  const cleanup = new Error("disposal failed");
  await rejects(
    () =>
      testAtomicKvStore(
        () => ({
          ...pair(new EmptyReadMemoryKvStore()),
          dispose() {
            throw cleanup;
          },
        }),
        memoryOptions,
      ),
    (error: unknown) => {
      ok(error instanceof AggregateError);
      strictEqual(error.errors.length, 2);
      ok(error.errors[0] instanceof AssertionError);
      strictEqual(error.errors[1], cleanup);
      return true;
    },
  );
});

test("testAtomicKvStore() propagates a disposal-only failure", async () => {
  const cleanup = new Error("disposal alone failed");
  await rejects(
    () =>
      testAtomicKvStore(
        () => ({
          ...pair(new MemoryKvStore()),
          dispose() {
            throw cleanup;
          },
        }),
        memoryOptions,
      ),
    (error: unknown) => error === cleanup,
  );
});

test("testAtomicKvStore() drains racing writes before disposal after a failed read", async () => {
  const readFailure = new Error("snapshot read failed");
  let completedWrites = 0;
  let raceReached = false;
  class FailingReadMemoryKvStore extends MemoryKvStore {
    pending = 0;
    disposed = false;

    override async getMany<T = unknown>(
      keys: readonly KvKey[],
    ): Promise<(T | undefined)[]> {
      if (keys[0]?.includes("snapshot")) {
        raceReached = true;
        throw readFailure;
      }
      return await super.getMany<T>(keys);
    }

    override async setMany(entries: readonly KvStoreSetEntry[]): Promise<void> {
      if (entries[0]?.key.includes("snapshot") && entries[0].value !== 0) {
        this.pending++;
        try {
          await pause(1);
          strictEqual(
            this.disposed,
            false,
            "a racing write must finish before disposal",
          );
          await super.setMany(entries);
          completedWrites++;
        } finally {
          this.pending--;
        }
      } else await super.setMany(entries);
    }
  }
  await rejects(
    () =>
      testAtomicKvStore(() => {
        const store = new FailingReadMemoryKvStore();
        return {
          first: store,
          second: store,
          dispose() {
            strictEqual(
              store.pending,
              0,
              "disposal must wait for started operations",
            );
            store.disposed = true;
          },
        };
      }, memoryOptions),
    (error: unknown) => error === readFailure,
  );
  strictEqual(raceReached, true);
  strictEqual(completedWrites, 8);
});

test("testAtomicKvStore() accepts omitted object-key-order claims", () =>
  testAtomicKvStore(() => pair(new MemoryKvStore())));

test("testAtomicKvStore() rejects an incorrect object-key-order claim", async () => {
  await rejects(
    () =>
      testAtomicKvStore(() => pair(new MemoryKvStore()), {
        objectKeyOrder: "significant",
      }),
    AssertionError,
  );
});

test("testAtomicKvStore() waits through fractional truncation and early callbacks", async () => {
  const maximum = 2_147_483_647;
  for (const scenario of [
    { short: 1_250_000, wait: 1_500_000, early: false, origin: 0 },
    { short: 1_250_000, wait: 1_500_000, early: true, origin: 0 },
    {
      short: maximum * 1_000_000 - 500_000,
      wait: maximum * 1_000_000,
      early: true,
      origin: 2 ** 53,
    },
  ]) {
    const instantDescriptor = Object.getOwnPropertyDescriptor(
      Temporal.Now,
      "instant",
    );
    const performanceDescriptor = Object.getOwnPropertyDescriptor(
      performance,
      "now",
    );
    const timerDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "setTimeout",
    );
    let elapsed = 0n;
    let early = scenario.early;
    const delays: number[] = [];
    try {
      Object.defineProperty(Temporal.Now, "instant", {
        configurable: instantDescriptor?.configurable ?? true,
        value: () => Temporal.Instant.fromEpochNanoseconds(elapsed),
      });
      Object.defineProperty(performance, "now", {
        configurable: performanceDescriptor?.configurable ?? true,
        value: () => scenario.origin + Number(elapsed) / 1_000_000,
      });
      Object.defineProperty(globalThis, "setTimeout", {
        configurable: timerDescriptor?.configurable ?? true,
        value: (callback: () => void, delay: number) => {
          ok(
            delay > 0 && delay <= maximum,
            "timer delays must stay within the valid range",
          );
          delays.push(delay);
          // Match Node's integer truncation, with one optional early callback.
          const advance = early ? 0 : Math.max(1, Math.trunc(delay));
          early = false;
          queueMicrotask(() => {
            elapsed += BigInt(advance) * 1_000_000n;
            callback();
          });
          return 0;
        },
      });
      await testAtomicKvStore(() => pair(new MemoryKvStore()), {
        ...memoryOptions,
        ttl: {
          short: Temporal.Duration.from({ nanoseconds: scenario.short }),
          wait: Temporal.Duration.from({ nanoseconds: scenario.wait }),
        },
      });
      ok(
        elapsed >= BigInt(scenario.wait) * 2n,
        "both expiry waits must complete",
      );
      ok(
        delays.every(Number.isInteger),
        "fractional timer delays must be rounded up",
      );
      if (scenario.early)
        ok(delays.length >= 3, "early callbacks must be retried");
    } finally {
      for (const [target, name, descriptor] of [
        [Temporal.Now, "instant", instantDescriptor],
        [performance, "now", performanceDescriptor],
        [globalThis, "setTimeout", timerDescriptor],
      ] as const) {
        if (descriptor == null) Reflect.deleteProperty(target, name);
        else Object.defineProperty(target, name, descriptor);
      }
    }
    deepStrictEqual(
      Object.getOwnPropertyDescriptor(Temporal.Now, "instant"),
      instantDescriptor,
    );
    deepStrictEqual(
      Object.getOwnPropertyDescriptor(performance, "now"),
      performanceDescriptor,
    );
    deepStrictEqual(
      Object.getOwnPropertyDescriptor(globalThis, "setTimeout"),
      timerDescriptor,
    );
  }
});

test("testAtomicKvStore() rejects invalid timing before creating clients", async () => {
  let created = false;
  await rejects(
    () =>
      testAtomicKvStore(
        () => {
          created = true;
          return pair(new MemoryKvStore());
        },
        {
          ttl: {
            short: Temporal.Duration.from({ milliseconds: 0 }),
            wait: Temporal.Duration.from({ milliseconds: 1 }),
          },
        },
      ),
    RangeError,
  );
  strictEqual(created, false);
});

test("testAtomicKvStore() seeds mixed absent and existing CAS rejection expectations", async () => {
  let checked = false;
  class InspectingMemoryKvStore extends MemoryKvStore {
    override async casMany(
      entries: readonly KvStoreCasEntry[],
    ): Promise<boolean> {
      if (entries[0]?.key.includes("mixed-limit-probe")) {
        for (const entry of entries) {
          deepStrictEqual(await this.get(entry.key), entry.expectedValue);
        }
        checked = true;
        throw new Error("outside atomic scope");
      }
      return await super.casMany(entries);
    }
  }
  await testAtomicKvStore(() => pair(new InspectingMemoryKvStore()), {
    ...memoryOptions,
    rejections: (key) => ({
      casMany: [
        {
          key: key("mixed-limit-probe", "existing"),
          expectedValue: null,
          newValue: 1,
        },
        {
          key: key("mixed-limit-probe", "absent"),
          expectedValue: undefined,
          newValue: 2,
        },
      ],
    }),
  });
  strictEqual(checked, true);
});

function pair(store: AtomicKvStore): AtomicKvStoreTestPair {
  return { first: store, second: store, dispose() {} };
}

const limitProbes: NonNullable<TestAtomicKvStoreOptions["rejections"]> = (
  key,
) => {
  const keys = Array.from({ length: 9 }, (_, index) =>
    key("limit-probe", String(index)),
  );
  return {
    getMany: keys,
    setMany: keys.map((key, index) => ({ key, value: `replacement-${index}` })),
    deleteMany: keys,
    casMany: keys.map((key, index) => ({
      key,
      expectedValue: index,
      newValue: index + 100,
    })),
  } satisfies TestAtomicKvStoreRejections;
};

class LimitedMemoryKvStore extends MemoryKvStore {
  #partial: "setMany" | "deleteMany" | "casMany" | undefined;

  constructor(partial?: "setMany" | "deleteMany" | "casMany") {
    super();
    this.#partial = partial;
  }

  override async getMany<T = unknown>(
    keys: readonly KvKey[],
  ): Promise<(T | undefined)[]> {
    if (keys.length > 8) throw new Error("batch limit exceeded");
    return await super.getMany<T>(keys);
  }

  override async setMany(entries: readonly KvStoreSetEntry[]): Promise<void> {
    if (entries.length > 8) {
      if (this.#partial === "setMany") {
        const entry = entries[0];
        await super.set(entry.key, entry.value, entry.options);
      }
      throw new Error("batch limit exceeded");
    }
    await super.setMany(entries);
  }

  override async deleteMany(keys: readonly KvKey[]): Promise<void> {
    if (keys.length > 8) {
      if (this.#partial === "deleteMany") await super.delete(keys[0]);
      throw new Error("batch limit exceeded");
    }
    await super.deleteMany(keys);
  }

  override async casMany(
    entries: readonly KvStoreCasEntry[],
  ): Promise<boolean> {
    if (entries.length > 8) {
      if (this.#partial === "casMany") {
        const entry = entries[0];
        strictEqual(
          await super.cas(
            entry.key,
            entry.expectedValue,
            entry.newValue,
            entry.options,
          ),
          true,
        );
      }
      throw new Error("batch limit exceeded");
    }
    return await super.casMany(entries);
  }
}

class ScopedMemoryKvStore extends LimitedMemoryKvStore {
  override get<T = unknown>(key: KvKey): Promise<T | undefined> {
    assertMappedKey(key);
    return super.get<T>(key);
  }

  override async getMany<T = unknown>(
    keys: readonly KvKey[],
  ): Promise<(T | undefined)[]> {
    for (const key of keys) assertMappedKey(key);
    return await super.getMany<T>(keys);
  }
}

function assertMappedKey(key: KvKey): void {
  strictEqual(key[0], "{atomic}", "keys must use the mapped atomic scope");
  ok(
    key.at(-1)?.startsWith("fedify_atomic_"),
    "keys must be mapped exactly once",
  );
}

class TornReadMemoryKvStore extends MemoryKvStore {
  override async getMany<T = unknown>(
    keys: readonly KvKey[],
  ): Promise<(T | undefined)[]> {
    const values: (T | undefined)[] = [];
    for (const key of keys) {
      values.push(await this.get<T>(key));
      await pause(0);
    }
    return values;
  }
}

class EmptyReadMemoryKvStore extends MemoryKvStore {
  override getMany<T = unknown>(
    _keys: readonly KvKey[],
  ): Promise<(T | undefined)[]> {
    return Promise.resolve([]);
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
