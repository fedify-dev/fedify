import { isEqual } from "es-toolkit";

/**
 * A key for a key–value store.  An array of one or more strings.
 *
 * @since 0.5.0
 */
export type KvKey = readonly [string] | readonly [string, ...string[]];

/**
 * Additional options for setting a value in a key–value store.
 *
 * @since 0.5.0
 */
export interface KvStoreSetOptions {
  /**
   * The time-to-live (TTL) for the value.
   */
  ttl?: Temporal.Duration;
}

/**
 * An entry returned by the {@link KvStore.list} method.
 *
 * @since 1.10.0
 */
export interface KvStoreListEntry {
  /**
   * The key of the entry.
   */
  readonly key: KvKey;

  /**
   * The value of the entry.
   */
  readonly value: unknown;
}

/**
 * A write in an atomic batch.  `undefined` is not a storable value.
 * @since 2.5.0
 */
export interface KvStoreSetEntry {
  /** The key to write. */
  readonly key: KvKey;
  /** The value to store, including `null`, but not `undefined`. */
  readonly value: unknown;
  /** The TTL for this entry; omitting it clears any previous TTL. */
  readonly options?: KvStoreSetOptions;
}

/**
 * A comparison and mutation in an atomic conditional batch.
 * @since 2.5.0
 */
export interface KvStoreCasEntry {
  /** The key to compare and change. */
  readonly key: KvKey;
  /** The expected value; `undefined` checks for absence or logical expiry. */
  readonly expectedValue: unknown;
  /** The replacement value; `undefined` deletes the entry. */
  readonly newValue: unknown;
  /** The replacement TTL.  A deletion must not specify a TTL. */
  readonly options?: KvStoreSetOptions;
}

/**
 * An abstract interface for a key–value store.
 *
 * @since 0.5.0
 */
export interface KvStore {
  /**
   * Gets the value for the given key.
   * @param key The key to get the value for.
   * @returns The value for the key, including `null` if stored, or `undefined`
   *          if the key does not exist.
   * @template T The type of the value to get.
   */
  get<T = unknown>(key: KvKey): Promise<T | undefined>;

  /**
   * Sets the value for the given key.
   * @param key The key to set the value for.
   * @param value The value to set.  `null` is a storable value.
   * @param options Additional options for setting the value.
   */
  set(key: KvKey, value: unknown, options?: KvStoreSetOptions): Promise<void>;

  /**
   * Deletes the value for the given key.
   * @param key The key to delete.
   */
  delete(key: KvKey): Promise<void>;

  /**
   * Compare-and-swap (CAS) operation for the key–value store.
   * @param key The key to perform the CAS operation on.
   * @param expectedValue The expected value for the key.
   * @param newValue The new value to set if the expected value matches.
   * @param options Additional options for setting the value.
   * @return `true` if the CAS operation was successful, `false` otherwise.
   * @since 1.8.0
   */
  cas?: (
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ) => Promise<boolean>;

  /**
   * Reads an input-ordered snapshot of the given keys.  Missing or expired
   * entries are `undefined`; stored `null` remains `null`.  Repeated keys
   * repeat the same snapshot value.  Empty input returns an empty array.
   * This does not provide a snapshot of {@link KvStore.list}.
   * @see {@link AtomicKvStore} for the atomic operation contract.
   * @since 2.5.0
   */
  getMany?<T = unknown>(keys: readonly KvKey[]): Promise<(T | undefined)[]>;

  /**
   * Writes all entries atomically, with a separate TTL for each entry.
   * Duplicate keys and `undefined` values reject before any write.  Empty
   * input is a no-op.  An operation must never be split to fit a batch limit.
   * @see {@link AtomicKvStore} for supported scope and error semantics.
   * @since 2.5.0
   */
  setMany?(entries: readonly KvStoreSetEntry[]): Promise<void>;

  /**
   * Deletes all given keys atomically.  Duplicate keys reject before any
   * deletion.  Empty input is a no-op; absent keys are ignored.
   * @see {@link AtomicKvStore} for supported scope and error semantics.
   * @since 2.5.0
   */
  deleteMany?(keys: readonly KvKey[]): Promise<void>;

  /**
   * Compares every expected value against one pre-mutation state and applies
   * all replacements/deletions atomically only if every comparison matches.
   * `undefined` means absence when expected, and deletion when new.  Duplicate
   * keys and a TTL on deletion reject before any mutation, even on mismatch.
   * Empty input returns `true`.  `false` means only a comparison mismatch,
   * leaving all values and their TTLs unchanged.
   * @see {@link AtomicKvStore} for comparison, scope, and failure semantics.
   * @since 2.5.0
   */
  casMany?(entries: readonly KvStoreCasEntry[]): Promise<boolean>;

  /**
   * Lists all entries in the store that match the given prefix.
   * If no prefix is given, all entries are returned.
   * @param prefix The prefix to filter keys by.  If not specified, all entries
   *               are returned.
   * @returns An async iterable of entries matching the prefix.
   * @since 1.10.0
   * @since 2.0.0 This method is now required instead of optional.
   */
  list(prefix?: KvKey): AsyncIterable<KvStoreListEntry>;
}

/**
 * A store providing atomic snapshots and conditional multi-key mutations.
 *
 * Every operation is atomic within the adapter's documented backing-store
 * scope.  Adapters must document supported values/codecs, comparison, TTL
 * precision, key scope, and size limits.  Single and multi-key CAS use the
 * same comparison rules.  Invalid input, unsupported scope, exceeded limits,
 * and backend failures reject; a batch must never be silently split.
 * Batch arrays must not be sparse: a missing element makes the batch invalid.
 * Empty arrays are valid.
 *
 * Logical expiry counts as absence.  `undefined` is not stored; use deletion
 * instead.  CAS deletion rejects a non-null TTL.  Replacing a value without a
 * TTL clears its previous expiry.  Each operation uses one expiry cutoff.
 *
 * This contract does not imply durability, a transaction across calls, or
 * exactly-once external effects.  A lost response can leave commit status
 * unknown.  To detect ABA changes, include a non-reused version in the value.
 * After a mismatch, re-read and re-evaluate the application rule before retry.
 *
 * @since 2.5.0
 */
export interface AtomicKvStore extends KvStore {
  /**
   * Stores a value.  `undefined` rejects; use {@link KvStore.delete} instead.
   * @param key The key to write.
   * @param value The value to store, including `null`, but not `undefined`.
   * @param options The TTL; omitting it clears the previous expiry.
   */
  set(key: KvKey, value: unknown, options?: KvStoreSetOptions): Promise<void>;

  /**
   * Compares and replaces one value using the same rules as
   * {@link AtomicKvStore.casMany}.  `undefined` means absence/deletion;
   * a non-null TTL on deletion rejects, including on mismatch.
   */
  cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean>;

  /** {@inheritDoc KvStore.getMany} */
  getMany<T = unknown>(keys: readonly KvKey[]): Promise<(T | undefined)[]>;
  /** {@inheritDoc KvStore.setMany} */
  setMany(entries: readonly KvStoreSetEntry[]): Promise<void>;
  /** {@inheritDoc KvStore.deleteMany} */
  deleteMany(keys: readonly KvKey[]): Promise<void>;
  /** {@inheritDoc KvStore.casMany} */
  casMany(entries: readonly KvStoreCasEntry[]): Promise<boolean>;
}

/**
 * Checks that all five atomic methods are functions.  This checks capabilities
 * only, not their correctness, supported scope, or persistence.
 * @param store The store to check.
 * @returns Whether the store exposes the required atomic methods.
 * @since 2.5.0
 */
export function isAtomicKvStore(store: KvStore): store is AtomicKvStore {
  return (
    typeof store.cas === "function" &&
    typeof store.getMany === "function" &&
    typeof store.setMany === "function" &&
    typeof store.deleteMany === "function" &&
    typeof store.casMany === "function"
  );
}

/**
 * A key–value store that stores values in memory.
 * Do not use this in production as it does not persist values.
 *
 * All keys within one instance share an atomic scope, with no fixed batch
 * size limit other than available memory/runtime resources.  Values use
 * {@link https://es-toolkit.dev/reference/predicate/isEqual.html | structural
 * equality} for CAS, including object member order independence.  TTLs are
 * normalized to hours without losing subhour precision; calendar durations
 * requiring a reference date reject.  Non-positive TTLs expire immediately.
 *
 * Values are retained and returned by reference for compatibility.  Treat
 * inputs and returned objects as immutable, passive data: accessors, proxies,
 * or other behavior that reenters the store during an operation are unsupported.
 * Mutating an object, including one shared across several keys, changes the
 * stored state outside the atomic API and invalidates snapshot guarantees.
 * Persistent adapters usually serialize values, so this differs from them.
 *
 * @since 0.5.0
 */
// Validation errors must reject promises; atomic operations must not yield.
// oxlint-disable eslint/require-await
export class MemoryKvStore implements AtomicKvStore {
  #values: Record<string, [unknown, null | Temporal.Instant]> = {};

  #encodeKey(key: KvKey): string {
    if (
      !Array.isArray(key) ||
      key.length < 1 ||
      !Array.from(key).every((part) => typeof part === "string")
    ) {
      throw new TypeError("A KV key must be a non-empty array of strings.");
    }
    return JSON.stringify(key);
  }

  #encodeKeyList(keys: readonly KvKey[]): string[] {
    if (!Array.isArray(keys)) {
      throw new TypeError("A KV batch must be an array.");
    }
    return Array.from(keys, (key) => this.#encodeKey(key));
  }

  #encodeKeys(keys: readonly KvKey[]): string[] {
    const encoded = this.#encodeKeyList(keys);
    if (new Set(encoded).size !== encoded.length) {
      throw new TypeError("Duplicate keys in an atomic mutation.");
    }
    return encoded;
  }

  #read(key: string, now: Temporal.Instant): unknown {
    const entry = this.#values[key];
    if (
      entry == null ||
      (entry[1] != null && Temporal.Instant.compare(entry[1], now) <= 0)
    )
      return undefined;
    return entry[0];
  }

  #prepare(
    entries: readonly KvStoreSetEntry[],
    now: Temporal.Instant,
  ): [string, [unknown, null | Temporal.Instant]][] {
    const keys = this.#encodeKeys(entries.map((entry) => entry.key));
    return entries.map((entry, index) => {
      const value = entry.value;
      const ttl = entry.options?.ttl;
      if (value === undefined) {
        throw new TypeError("undefined is not a storable KV value.");
      }
      const expiration =
        ttl == null ? null : now.add(ttl.round({ largestUnit: "hour" }));
      return [keys[index], [value, expiration]];
    });
  }

  #apply(
    entries: readonly [string, [unknown, null | Temporal.Instant]][],
  ): void {
    for (const [key, entry] of entries) this.#values[key] = entry;
  }

  #compareAndSwap(entries: readonly KvStoreCasEntry[]): boolean {
    // Capture all user-supplied fields before checking or changing state.
    const captured = entries.map((entry) => ({
      key: entry.key,
      expectedValue: entry.expectedValue,
      newValue: entry.newValue,
      ttl: entry.options?.ttl,
    }));
    const keys = this.#encodeKeys(captured.map((entry) => entry.key));
    const now = Temporal.Now.instant();
    const prepared = captured.map((entry, index) => {
      if (entry.newValue === undefined && entry.ttl != null) {
        throw new TypeError("A CAS deletion must not specify a TTL.");
      }
      const expiration =
        entry.ttl == null
          ? null
          : now.add(entry.ttl.round({ largestUnit: "hour" }));
      return {
        key: keys[index],
        expectedValue: entry.expectedValue,
        value: entry.newValue,
        expiration,
      };
    });
    for (const entry of prepared) {
      if (!isEqual(this.#read(entry.key, now), entry.expectedValue)) {
        return false;
      }
    }
    for (const entry of prepared) {
      if (entry.value === undefined) delete this.#values[entry.key];
      else this.#values[entry.key] = [entry.value, entry.expiration];
    }
    return true;
  }

  /** {@inheritDoc KvStore.get} */
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    const encoded = this.#encodeKey(key);
    const now = Temporal.Now.instant();
    const value = this.#read(encoded, now);
    if (value === undefined) delete this.#values[encoded];
    return value as T | undefined;
  }

  /** {@inheritDoc AtomicKvStore.set} */
  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    this.#apply(
      this.#prepare([{ key, value, options }], Temporal.Now.instant()),
    );
  }

  /** {@inheritDoc KvStore.delete} */
  async delete(key: KvKey): Promise<void> {
    delete this.#values[this.#encodeKey(key)];
  }

  /** {@inheritDoc AtomicKvStore.cas} */
  async cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    return this.#compareAndSwap([{ key, expectedValue, newValue, options }]);
  }

  /** {@inheritDoc AtomicKvStore.getMany} */
  async getMany<T = unknown>(
    keys: readonly KvKey[],
  ): Promise<(T | undefined)[]> {
    const encoded = this.#encodeKeyList(keys);
    const now = Temporal.Now.instant();
    return encoded.map((key) => this.#read(key, now) as T | undefined);
  }

  /** {@inheritDoc AtomicKvStore.setMany} */
  async setMany(entries: readonly KvStoreSetEntry[]): Promise<void> {
    this.#apply(this.#prepare(entries, Temporal.Now.instant()));
  }

  /** {@inheritDoc AtomicKvStore.deleteMany} */
  async deleteMany(keys: readonly KvKey[]): Promise<void> {
    const encoded = this.#encodeKeys(keys);
    for (const key of encoded) delete this.#values[key];
  }

  /** {@inheritDoc AtomicKvStore.casMany} */
  async casMany(entries: readonly KvStoreCasEntry[]): Promise<boolean> {
    return this.#compareAndSwap(entries);
  }

  /** {@inheritDoc KvStore.list} */
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    const now = Temporal.Now.instant();
    for (const [encodedKey, entry] of Object.entries(this.#values)) {
      const key = JSON.parse(encodedKey) as KvKey;
      if (prefix != null) {
        if (key.length < prefix.length) continue;
        if (!prefix.every((p, i) => key[i] === p)) continue;
      }
      const [value, expiration] = entry;
      if (
        expiration != null &&
        Temporal.Instant.compare(expiration, now) <= 0
      ) {
        // A yield may have allowed a newer write to replace this stale tuple.
        if (this.#values[encodedKey] === entry) delete this.#values[encodedKey];
        continue;
      }
      yield { key, value };
    }
  }
}
// oxlint-enable eslint/require-await
