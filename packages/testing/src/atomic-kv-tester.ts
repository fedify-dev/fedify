// Setup, bounded race iterations, and disposal require sequential operations.
/* oxlint-disable eslint/no-await-in-loop */
import type {
  AtomicKvStore,
  KvKey,
  KvStoreCasEntry,
  KvStoreSetEntry,
} from "@fedify/fedify";
import {
  deepStrictEqual,
  notDeepStrictEqual,
  ok,
  rejects,
  strictEqual,
} from "node:assert/strict";

/**
 * Two clients sharing a fresh, isolated backing store for one conformance case.
 * Persistent adapters must use independent clients.  Memory implementations
 * may return the same instance twice.  The factory owns cleanup if construction
 * fails before it returns this pair.
 * @since 2.5.0
 */
export interface AtomicKvStoreTestPair {
  /** The first client. */
  readonly first: AtomicKvStore;
  /** The second client, sharing the first client's backing store. */
  readonly second: AtomicKvStore;
  /** Releases both clients and their isolated backing state. */
  dispose(): void | Promise<void>;
}

/**
 * Calls that exceed a backend's documented batch limits or atomic key scope.
 * Keys must be individually usable by ordinary store operations.  Mutation
 * probes must contain distinct keys and attempt observable changes.  CAS
 * expectations are seeded before testing the rejection.  Supply supported
 * values and TTLs so rejection tests the intended limit or scope.
 * @since 2.5.0
 */
export interface TestAtomicKvStoreRejections {
  /** An unsupported snapshot read. */
  readonly getMany?: readonly KvKey[];
  /** An unsupported unconditional write. */
  readonly setMany?: readonly KvStoreSetEntry[];
  /** An unsupported deletion. */
  readonly deleteMany?: readonly KvKey[];
  /** An unsupported conditional write. */
  readonly casMany?: readonly KvStoreCasEntry[];
}

/**
 * Configuration for {@link testAtomicKvStore}.
 * @since 2.5.0
 */
export interface TestAtomicKvStoreOptions {
  /**
   * Positive expiry-test timing.  Defaults to a 500 ms TTL and a 1 s wait.
   * Choose a wait longer than the backend's rounded TTL and expected latency.
   * Zero and negative TTL policies are adapter-specific and are not tested.
   */
  readonly ttl?: {
    readonly short: Temporal.Duration;
    readonly wait: Temporal.Duration;
  };
  /**
   * Maps generated keys into the backend's atomic scope, for example a Redis
   * Cluster hash tag.  The mapping must be injective and preserve structural
   * key equality; it need not preserve prefixes.  Each case uses a fresh
   * random key prefix before mapping.
   */
  readonly key?: (key: KvKey) => KvKey;
  /**
   * Whether reordered object members compare equally in CAS.  Omit this to
   * leave member-order behavior unspecified.  Nested JSON round trips and
   * single/batch CAS equivalence are always tested.
   */
  readonly objectKeyOrder?: "ignored" | "significant";
  /**
   * Supplies optional backend limit/scope probes.  The key factory already
   * applies {@link TestAtomicKvStoreOptions.key}; returned keys are used
   * verbatim and may deliberately cross atomic scopes.  Each probe runs on
   * a fresh pair.  Oversized operations must reject rather than return false
   * or partially commit.  No universal batch maximum is assumed.
   */
  readonly rejections?: (
    key: (...segments: string[]) => KvKey,
  ) => TestAtomicKvStoreRejections;
}

type KeyFactory = (...segments: string[]) => KvKey;
type ConformanceCase = (
  pair: AtomicKvStoreTestPair,
  key: KeyFactory,
) => Promise<void>;

/**
 * Tests an {@link AtomicKvStore} using fresh client pairs for independent cases.
 *
 * Covers ordered snapshot reads, all-or-nothing writes/deletes/CAS, absent-key
 * races, single/batch CAS interaction, logical expiry, validation, and optional
 * backend-limit probes.  Baseline successful calls use at most three keys or
 * entries; choose a backend scope that supports them.  Concurrent checks use
 * bounded repetition; they are
 * not an exhaustive linearizability proof.  Add adapter-specific transaction
 * rollback, injected-failure, persistence, and supported-isolation tests.
 * Run `testKvStore()` separately for ordinary KV and prefix-listing behavior.
 *
 * All started racing operations settle before pair disposal, even when an
 * assertion fails.  Assertion and disposal errors are retained together in
 * an {@link AggregateError}.  Configure TTL timing for the adapter's documented
 * expiry precision and expected operation latency.
 *
 * @example
 * ```typescript ignore
 * import { test } from "node:test";
 * import { MemoryKvStore } from "@fedify/fedify";
 * import { testAtomicKvStore } from "@fedify/testing";
 *
 * test("Memory atomic contract", () => testAtomicKvStore(() => {
 *   const store = new MemoryKvStore();
 *   return { first: store, second: store, dispose() {} };
 * }, { objectKeyOrder: "ignored" }));
 * ```
 * @param createPair Creates a fresh pair sharing isolated backing state.
 * @param options Backend scope, comparison, expiry, and rejection probes.
 * @since 2.5.0
 */
export default async function testAtomicKvStore(
  createPair: () => AtomicKvStoreTestPair | Promise<AtomicKvStoreTestPair>,
  options: TestAtomicKvStoreOptions = {},
): Promise<void> {
  const short =
    options.ttl?.short ?? Temporal.Duration.from({ milliseconds: 500 });
  const wait =
    options.ttl?.wait ?? Temporal.Duration.from({ milliseconds: 1000 });
  const shortMs = short.total("millisecond");
  const waitMs = wait.total("millisecond");
  if (
    !Number.isFinite(shortMs) ||
    shortMs <= 0 ||
    !Number.isFinite(waitMs) ||
    waitMs <= shortMs ||
    waitMs > 2_147_483_647
  ) {
    throw new RangeError(
      "TTL timing requires 0 < short < wait <= 2147483647 ms",
    );
  }

  const cases: ConformanceCase[] = [
    async ({ first, second }, key) => {
      const values = [
        "text",
        42,
        true,
        null,
        [1, "two", false],
        { nested: { items: [{ value: "test" }], active: true } },
      ];
      const keys = values.map((_, index) => key("values", String(index)));
      for (const [index, value] of values.entries()) {
        await first.set(keys[index], value);
        deepStrictEqual(await second.getMany([keys[index]]), [value]);
      }
      deepStrictEqual(
        await second.getMany([keys[5], keys[3], copyKey(keys[5])]),
        [values[5], null, values[5]],
        "snapshot reads must preserve order and duplicates",
      );
      deepStrictEqual(
        await second.getMany([key("missing"), keys[3]]),
        [undefined, null],
        "snapshot reads must preserve null and absence",
      );
      const nested = { children: [{ label: "one" }], enabled: false };
      const nestedKey = key("nested-roundtrip");
      await first.set(nestedKey, nested);
      const read = await second.getMany<typeof nested>([nestedKey]);
      deepStrictEqual(read, [nested]);
      strictEqual(
        await first.cas(nestedKey, read[0], { replaced: true }),
        true,
        "single-key CAS must accept a supported value returned by getMany",
      );
      deepStrictEqual(await second.get(nestedKey), { replaced: true });
      await first.set(nestedKey, nested);
      strictEqual(
        await first.casMany([
          {
            key: nestedKey,
            expectedValue: read[0],
            newValue: { replaced: true },
          },
        ]),
        true,
        "CAS must accept a supported value returned by getMany",
      );
      deepStrictEqual(await second.get(nestedKey), { replaced: true });
    },
    async ({ first, second }, key) => {
      const valueKey = key("empty");
      await first.set(valueKey, "kept");
      deepStrictEqual(await second.getMany([]), []);
      strictEqual(await first.setMany([]), undefined);
      strictEqual(await first.deleteMany([]), undefined);
      strictEqual(await first.casMany([]), true);
      strictEqual(await second.get(valueKey), "kept");
    },
    async ({ first, second }, key) => {
      const a = key("duplicate", "a");
      const b = key("duplicate", "b");
      await first.setMany([
        { key: a, value: 1 },
        { key: b, value: 2 },
      ]);
      const check = async () => {
        deepStrictEqual(await readSeparately(second, [a, b]), [1, 2]);
      };
      await rejects(() =>
        first.setMany([
          { key: a, value: 10 },
          { key: b, value: 20 },
          { key: copyKey(b), value: 30 },
        ]),
      );
      await check();
      await rejects(() => first.deleteMany([a, b, copyKey(b)]));
      await check();
      await rejects(() =>
        first.casMany([
          { key: a, expectedValue: 1, newValue: 10 },
          { key: b, expectedValue: 2, newValue: 20 },
          { key: copyKey(b), expectedValue: 2, newValue: 30 },
        ]),
      );
      await check();
      await rejects(
        () =>
          first.casMany([
            { key: a, expectedValue: "wrong", newValue: 10 },
            { key: b, expectedValue: 2, newValue: 20 },
            { key: copyKey(b), expectedValue: 2, newValue: 30 },
          ]),
        "duplicate CAS keys must reject even on mismatch",
      );
      await check();
    },
    async ({ first, second }, key) => {
      const a = key("undefined", "a");
      const b = key("undefined", "b");
      await first.setMany([
        { key: a, value: "before-a" },
        {
          key: b,
          value: null,
        },
      ]);
      await rejects(() => first.set(a, undefined));
      deepStrictEqual(await readSeparately(second, [a, b]), ["before-a", null]);
      await rejects(() =>
        first.setMany([
          { key: a, value: "after-a" },
          { key: b, value: undefined },
        ]),
      );
      deepStrictEqual(await readSeparately(second, [a, b]), ["before-a", null]);
    },
    async ({ first, second }, key) => {
      const a = key("cas", "a");
      const b = key("cas", "b");
      const c = key("cas", "c");
      await first.setMany([
        { key: a, value: 1 },
        { key: b, value: null },
      ]);
      strictEqual(
        await first.casMany([
          { key: a, expectedValue: 1, newValue: 10 },
          { key: b, expectedValue: "wrong", newValue: 20 },
        ]),
        false,
      );
      deepStrictEqual(await readSeparately(second, [a, b, c]), [
        1,
        null,
        undefined,
      ]);
      strictEqual(
        await first.casMany([
          { key: a, expectedValue: 1, newValue: 2 },
          { key: b, expectedValue: null, newValue: undefined },
          { key: c, expectedValue: undefined, newValue: { created: true } },
        ]),
        true,
      );
      deepStrictEqual(await second.getMany([a, b, c]), [
        2,
        undefined,
        {
          created: true,
        },
      ]);
      await assertUnlisted(second, [b]);
      strictEqual(await first.cas(b, undefined, null), true);
      strictEqual(await second.get(b), null);
      strictEqual(await first.cas(b, null, undefined, {}), true);
      strictEqual(await first.cas(b, undefined, undefined, {}), true);
      strictEqual(
        await first.casMany([
          {
            key: b,
            expectedValue: undefined,
            newValue: undefined,
            options: {},
          },
        ]),
        true,
      );
      await assertUnlisted(second, [b]);
      await first.deleteMany([a, c, key("missing-delete")]);
      deepStrictEqual(await second.getMany([a, c]), [undefined, undefined]);
      await assertUnlisted(second, [a, c]);
    },
    async ({ first, second }, key) => {
      const a = key("delete-ttl", "a");
      const b = key("delete-ttl", "b");
      await first.setMany([
        { key: a, value: 1 },
        { key: b, value: 2 },
      ]);
      await rejects(() => first.cas(a, 1, undefined, { ttl: short }));
      await rejects(() => first.cas(a, "wrong", undefined, { ttl: short }));
      await rejects(() =>
        first.casMany([
          { key: a, expectedValue: 1, newValue: 10 },
          {
            key: b,
            expectedValue: 2,
            newValue: undefined,
            options: { ttl: short },
          },
        ]),
      );
      await rejects(() =>
        first.casMany([
          { key: a, expectedValue: "wrong", newValue: 10 },
          {
            key: b,
            expectedValue: 2,
            newValue: undefined,
            options: { ttl: short },
          },
        ]),
      );
      deepStrictEqual(await readSeparately(second, [a, b]), [1, 2]);
    },
    async ({ first, second }, key) => {
      const valueKey = key("comparison");
      const distinctions = [
        { value: 1, different: "1" },
        { value: [1, 2], different: { "0": 1, "1": 2 } },
        { value: [1, 2], different: [2, 1] },
        { value: null, different: undefined },
      ];
      for (const { value, different } of distinctions) {
        await first.set(valueKey, value);
        strictEqual(await first.cas(valueKey, different, "changed"), false);
        strictEqual(
          await first.casMany([
            { key: valueKey, expectedValue: different, newValue: "changed" },
          ]),
          false,
        );
        deepStrictEqual(await second.get(valueKey), value);
      }
      const missing = key("comparison", "missing");
      strictEqual(
        await first.cas(missing, null, "changed"),
        false,
        "single CAS must not match null against absence",
      );
      strictEqual(
        await first.casMany([
          { key: missing, expectedValue: null, newValue: "changed" },
        ]),
        false,
        "batch CAS must not match null against absence",
      );
      strictEqual(await second.get(missing), undefined);
      if (options.objectKeyOrder != null) {
        const value = { a: 1, b: { c: 2 } };
        const reordered = { b: { c: 2 }, a: 1 };
        const expected = options.objectKeyOrder === "ignored";
        await first.set(valueKey, value);
        strictEqual(await first.cas(valueKey, reordered, "changed"), expected);
        await first.set(valueKey, value);
        strictEqual(
          await first.casMany([
            { key: valueKey, expectedValue: reordered, newValue: "changed" },
          ]),
          expected,
        );
      }
    },
    async ({ first, second }, key) => {
      for (let round = 0; round < 4; round++) {
        const a = key("absent-race", String(round), "a");
        const b = key("absent-race", String(round), "b");
        const results = await runTogether([
          () =>
            first.casMany([
              { key: a, expectedValue: undefined, newValue: 1 },
              { key: b, expectedValue: undefined, newValue: 1 },
            ]),
          () =>
            second.casMany([
              { key: b, expectedValue: undefined, newValue: 2 },
              { key: a, expectedValue: undefined, newValue: 2 },
            ]),
        ]);
        strictEqual(
          results.filter(Boolean).length,
          1,
          "only one absent-key batch may win",
        );
        const winner = results[0] ? 1 : 2;
        deepStrictEqual(await first.getMany([a, b]), [winner, winner]);
      }
    },
    async ({ first, second }, key) => {
      for (let round = 0; round < 4; round++) {
        const a = key("opposing-race", String(round), "a");
        const b = key("opposing-race", String(round), "b");
        await first.setMany([
          { key: a, value: 0 },
          { key: b, value: 0 },
        ]);
        const results = await runTogether([
          () =>
            first.casMany([
              { key: a, expectedValue: 0, newValue: 1 },
              { key: b, expectedValue: 0, newValue: 1 },
            ]),
          () =>
            second.casMany([
              { key: b, expectedValue: 0, newValue: 2 },
              { key: a, expectedValue: 0, newValue: 2 },
            ]),
        ]);
        strictEqual(
          results.filter(Boolean).length,
          1,
          "only one competing batch may win",
        );
        const winner = results[0] ? 1 : 2;
        deepStrictEqual(await first.getMany([a, b]), [winner, winner]);
      }
    },
    async ({ first, second }, key) => {
      for (let round = 0; round < 4; round++) {
        const a = key("single-batch-race", String(round), "a");
        const b = key("single-batch-race", String(round), "b");
        await first.setMany([
          { key: a, value: 0 },
          { key: b, value: 0 },
        ]);
        const results = await runTogether([
          () => first.cas(a, 0, 1),
          () =>
            second.casMany([
              { key: b, expectedValue: 0, newValue: 2 },
              { key: a, expectedValue: 0, newValue: 2 },
            ]),
        ]);
        strictEqual(
          results.filter(Boolean).length,
          1,
          "single and batch CAS must compete",
        );
        deepStrictEqual(
          await first.getMany([a, b]),
          results[0] ? [1, 0] : [2, 2],
        );
      }
    },
    snapshotCase("setMany"),
    snapshotCase("casMany"),
    snapshotCase("deleteMany"),
    async ({ first, second }, key) => {
      const a = key("expiry", "read");
      const b = key("expiry", "persistent");
      const c = key("expiry", "conditional");
      const d = key("expiry", "single");
      await first.set(b, "persistent");
      for (const expiring of [a, c, d]) {
        await first.set(expiring, "temporary", { ttl: short });
      }
      deepStrictEqual(await second.getMany([a, b]), [
        "temporary",
        "persistent",
      ]);
      await sleep(waitMs);
      strictEqual(
        await first.casMany([
          { key: c, expectedValue: undefined, newValue: "recreated" },
          { key: b, expectedValue: "persistent", newValue: "updated" },
        ]),
        true,
        "expired keys must compare as absent",
      );
      strictEqual(await first.cas(d, undefined, "recreated"), true);
      deepStrictEqual(await second.getMany([a, b]), [undefined, "updated"]);
      deepStrictEqual(await second.getMany([c, d]), ["recreated", "recreated"]);
      await assertUnlisted(second, [a]);
    },
    async ({ first, second }, key) => {
      const a = key("ttl-update", "set-clear");
      const b = key("ttl-update", "set-expire");
      const c = key("ttl-update", "cas-clear");
      const d = key("ttl-update", "cas-expire");
      const e = key("ttl-update", "failed");
      const f = key("ttl-update", "mismatch");
      const g = key("ttl-update", "failed-clear");
      const h = key("ttl-update", "single-clear");
      for (const persistent of [b, d]) {
        await first.set(persistent, "persistent");
      }
      await first.set(f, "unchanged");
      for (const expiring of [a, c, e, g, h]) {
        await first.set(expiring, "temporary", { ttl: short });
      }
      await first.setMany([
        { key: a, value: "persistent" },
        { key: b, value: "temporary", options: { ttl: short } },
      ]);
      strictEqual(await first.cas(h, "temporary", "persistent"), true);
      strictEqual(
        await first.casMany([
          { key: c, expectedValue: "temporary", newValue: "persistent" },
          {
            key: d,
            expectedValue: "persistent",
            newValue: "temporary",
            options: { ttl: short },
          },
        ]),
        true,
      );
      strictEqual(
        await first.casMany([
          {
            key: e,
            expectedValue: "temporary",
            newValue: "incorrectly-renewed",
            options: { ttl: wait.add(short) },
          },
          {
            key: g,
            expectedValue: "temporary",
            newValue: "incorrectly-persistent",
          },
          { key: f, expectedValue: "wrong", newValue: "changed" },
        ]),
        false,
      );
      deepStrictEqual(await readSeparately(second, [e, g]), [
        "temporary",
        "temporary",
      ]);
      await sleep(waitMs);
      deepStrictEqual(
        await readSeparately(second, [a, b, c, d, e, f, g, h]),
        [
          "persistent",
          undefined,
          "persistent",
          undefined,
          undefined,
          "unchanged",
          undefined,
          "persistent",
        ],
        "replacement must clear or replace TTLs, while failed CAS preserves TTLs",
      );
    },
  ];

  if (options.rejections != null) {
    const probes = options.rejections;
    for (const operation of [
      "getMany",
      "setMany",
      "deleteMany",
      "casMany",
    ] as const) {
      cases.splice(cases.length - 2, 0, async ({ first, second }, key) => {
        const probe = probes(key)[operation];
        if (probe == null) return;
        if (probe.length === 0) {
          throw new TypeError(
            "Rejection probes must attempt non-empty operations",
          );
        }
        let keys: readonly KvKey[];
        let invoke: () => Promise<unknown>;
        if (operation === "getMany" || operation === "deleteMany") {
          keys = probe as readonly KvKey[];
          assertDistinctKeys(keys);
          for (const [index, probeKey] of keys.entries()) {
            await first.set(probeKey, {
              before: index,
              nonce: crypto.randomUUID(),
            });
          }
          invoke =
            operation === "getMany"
              ? () => first.getMany(keys)
              : () => first.deleteMany(keys);
        } else if (operation === "setMany") {
          const entries = probe as readonly KvStoreSetEntry[];
          keys = entries.map((entry) => entry.key);
          assertDistinctKeys(keys);
          for (const [index, entry] of entries.entries()) {
            if (entry.value === undefined) {
              throw new TypeError(
                "setMany limit probes must supply storable values",
              );
            }
            const before = { before: index, nonce: crypto.randomUUID() };
            notDeepStrictEqual(entry.value, before);
            await first.set(entry.key, before);
          }
          invoke = () => first.setMany(entries);
        } else {
          const entries = probe as readonly KvStoreCasEntry[];
          keys = entries.map((entry) => entry.key);
          assertDistinctKeys(keys);
          for (const entry of entries) {
            notDeepStrictEqual(
              entry.newValue,
              entry.expectedValue,
              "every CAS limit probe entry must attempt an observable change",
            );
            if (entry.expectedValue === undefined) {
              await first.delete(entry.key);
            } else await first.set(entry.key, entry.expectedValue);
          }
          invoke = () => first.casMany(entries);
        }
        const before = await readSeparately(second, keys);
        await rejects(
          invoke,
          `${operation} must reject unsupported scope or limits`,
        );
        deepStrictEqual(
          await readSeparately(second, keys),
          before,
          `${operation} rejection must leave every key unchanged`,
        );
      });
    }
  }

  for (const run of cases) {
    const prefix = `fedify_atomic_${crypto.randomUUID()}`;
    const pair = await createPair();
    const key: KeyFactory = (...segments) => {
      const raw: KvKey = [prefix, ...segments];
      return options.key == null ? raw : options.key(raw);
    };
    let failed = false;
    let failure: unknown;
    let disposalFailed = false;
    let disposalFailure: unknown;
    try {
      await run(pair, key);
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      try {
        await pair.dispose();
      } catch (error) {
        disposalFailed = true;
        disposalFailure = error;
      }
    }
    if (failed && disposalFailed) {
      throw new AggregateError(
        [failure, disposalFailure],
        "Atomic KV assertions and disposal failed",
      );
    }
    if (failed) throw failure;
    if (disposalFailed) throw disposalFailure;
  }
}

function copyKey(key: KvKey): KvKey {
  return [key[0], ...key.slice(1)];
}

function assertDistinctKeys(keys: readonly KvKey[]): void {
  strictEqual(
    new Set(keys.map((key) => JSON.stringify(key))).size,
    keys.length,
    "limit/scope probes must contain distinct structural keys",
  );
}

async function readSeparately(
  store: AtomicKvStore,
  keys: readonly KvKey[],
): Promise<unknown[]> {
  const values: unknown[] = [];
  for (const key of keys) values.push(await store.get(key));
  return values;
}

async function assertUnlisted(
  store: AtomicKvStore,
  keys: readonly KvKey[],
): Promise<void> {
  const encoded = new Set(keys.map((key) => JSON.stringify(key)));
  for await (const entry of store.list()) {
    ok(
      !encoded.has(JSON.stringify(entry.key)),
      "deleted or expired keys must not appear in list()",
    );
  }
}

async function runTogether<T>(
  operations: readonly (() => Promise<T>)[],
): Promise<T[]> {
  const results = await Promise.allSettled(
    operations.map((operation) => Promise.resolve().then(operation)),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      "Concurrent atomic KV operations failed",
    );
  }
  return results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
}

function snapshotCase(
  operation: "setMany" | "casMany" | "deleteMany",
): ConformanceCase {
  return async ({ first, second }, key) => {
    for (const readerFirst of [true, false]) {
      for (let round = 0; round < 2; round++) {
        const a = key(
          "snapshot",
          operation,
          String(readerFirst),
          String(round),
          "a",
        );
        const b = key(
          "snapshot",
          operation,
          String(readerFirst),
          String(round),
          "b",
        );
        await first.setMany([
          { key: a, value: 0 },
          { key: b, value: 0 },
        ]);
        const write = async () => {
          for (let version = 1; version <= 8; version++) {
            if (operation === "casMany") {
              strictEqual(
                await first.casMany([
                  { key: a, expectedValue: version - 1, newValue: version },
                  { key: b, expectedValue: version - 1, newValue: version },
                ]),
                true,
              );
            } else {
              await first.setMany([
                { key: a, value: version },
                {
                  key: b,
                  value: version,
                },
              ]);
              if (operation === "deleteMany") await first.deleteMany([a, b]);
            }
          }
        };
        const read = async () => {
          for (let observation = 0; observation < 16; observation++) {
            const values = await second.getMany<number>([a, b, copyKey(a)]);
            strictEqual(values.length, 3);
            if (operation !== "deleteMany") {
              strictEqual(typeof values[0], "number");
            }
            strictEqual(
              values[0],
              values[1],
              `${operation} snapshot must not tear`,
            );
            strictEqual(
              values[0],
              values[2],
              "duplicate snapshot keys must agree",
            );
          }
        };
        await runTogether(readerFirst ? [read, write] : [write, read]);
      }
    }
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
