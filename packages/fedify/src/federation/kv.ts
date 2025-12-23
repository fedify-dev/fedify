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
  key: KvKey;

  /**
   * The value of the entry.
   */
  value: unknown;
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
   * @returns The value for the key, or `undefined` if the key does not exist.
   * @template T The type of the value to get.
   */
  get<T = unknown>(key: KvKey): Promise<T | undefined>;

  /**
   * Sets the value for the given key.
   * @param key The key to set the value for.
   * @param value The value to set.
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
   * Lists all entries in the store that match the given prefix.
   * If no prefix is given, all entries are returned.
   * @param prefix The prefix to filter keys by.  If not specified, all entries
   *               are returned.
   * @returns An async iterable of entries matching the prefix.
   * @since 1.10.0
   */
  list?: (prefix?: KvKey) => AsyncIterable<KvStoreListEntry>;
}

/**
 * A key–value store that stores values in memory.
 * Do not use this in production as it does not persist values.
 *
 * @since 0.5.0
 */
export class MemoryKvStore implements KvStore {
  #values: Record<string, [unknown, null | Temporal.Instant]> = {};

  #encodeKey(key: KvKey): string {
    return JSON.stringify(key);
  }

  /**
   * {@inheritDoc KvStore.get}
   */
  get<T = unknown>(key: KvKey): Promise<T | undefined> {
    const encodedKey = this.#encodeKey(key);
    const entry = this.#values[encodedKey];
    if (entry == null) return Promise.resolve(undefined);
    const [value, expiration] = entry;
    if (
      expiration != null && Temporal.Now.instant().until(expiration).sign < 0
    ) {
      delete this.#values[encodedKey];
      return Promise.resolve(undefined);
    }
    return Promise.resolve(value as T | undefined);
  }

  /**
   * {@inheritDoc KvStore.set}
   */
  set(key: KvKey, value: unknown, options?: KvStoreSetOptions): Promise<void> {
    const encodedKey = this.#encodeKey(key);
    const expiration = options?.ttl == null
      ? null
      : Temporal.Now.instant().add(options.ttl.round({ largestUnit: "hour" }));
    this.#values[encodedKey] = [value, expiration];
    return Promise.resolve();
  }

  /**
   * {@inheritDoc KvStore.delete}
   */
  delete(key: KvKey): Promise<void> {
    const encodedKey = this.#encodeKey(key);
    delete this.#values[encodedKey];
    return Promise.resolve();
  }

  /**
   * {@inheritDoc KvStore.cas}
   */
  cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    const encodedKey = this.#encodeKey(key);
    const entry = this.#values[encodedKey];
    let currentValue: unknown;
    if (entry == null) {
      currentValue = undefined;
    } else {
      const [value, expiration] = entry;
      if (
        expiration != null &&
        Temporal.Now.instant().until(expiration).sign < 0
      ) {
        delete this.#values[encodedKey];
        currentValue = undefined;
      } else {
        currentValue = value;
      }
    }
    if (!isEqual(currentValue, expectedValue)) return Promise.resolve(false);
    const expiration = options?.ttl == null
      ? null
      : Temporal.Now.instant().add(options.ttl.round({ largestUnit: "hour" }));
    this.#values[encodedKey] = [newValue, expiration];
    return Promise.resolve(true);
  }

  /**
   * {@inheritDoc KvStore.list}
   */
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    const now = Temporal.Now.instant();
    for (const [encodedKey, entry] of Object.entries(this.#values)) {
      const key = JSON.parse(encodedKey) as KvKey;
      // Check prefix match
      if (prefix != null) {
        if (key.length < prefix.length) continue;
        if (!prefix.every((p, i) => key[i] === p)) continue;
      }

      const [value, expiration] = entry;
      if (expiration != null && now.until(expiration).sign < 0) {
        delete this.#values[encodedKey];
        continue;
      }
      yield { key, value };
    }
  }
}
