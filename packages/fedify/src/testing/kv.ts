import type {
  KvKey,
  KvStore,
  KvStoreListEntry,
  KvStoreSetOptions,
} from "../federation/kv.ts";
import { MemoryKvStore } from "../federation/kv.ts";

/**
 * A {@link KvStore} decorator whose entry expiry is driven by a virtual clock
 * instead of wall-clock time.
 *
 * {@link MemoryKvStore} decides expiry by comparing timestamps rather than by
 * scheduling timers, so a test that wants to observe a TTL elapsing would
 * otherwise have to sleep for longer than the TTL and hope the runner keeps
 * up.  That makes such tests both slow and load-sensitive.
 *
 * This decorator keeps the TTLs itself and never passes them to the store it
 * wraps, so nothing expires until {@link advance} moves the clock.  Cache
 * hits, expiry, and repopulation therefore all become deterministic, without
 * patching any global and without a test-only entry point in the library
 * itself.  The clock starts at the Unix epoch and only ever moves forward.
 */
export class ManualClockKvStore implements KvStore {
  readonly #inner: KvStore;
  readonly #expirations: Map<string, Temporal.Instant> = new Map();
  #now: Temporal.Instant = Temporal.Instant.fromEpochMilliseconds(0);

  /**
   * Present only when the wrapped store has its own `cas()`.  Callers such as
   * the task deduplication planner test `kv.cas != null` to decide whether a
   * conditional write is available, so the decorator must not advertise a
   * capability the wrapped store lacks.
   */
  readonly cas?: (
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ) => Promise<boolean>;

  constructor(inner: KvStore = new MemoryKvStore()) {
    this.#inner = inner;
    const innerCas = inner.cas;
    if (innerCas != null) {
      this.cas = async (key, expectedValue, newValue, options) => {
        await this.#evictIfExpired(key);
        const swapped = await innerCas.call(
          inner,
          key,
          expectedValue,
          newValue,
        );
        if (swapped) this.#recordTtl(key, options);
        return swapped;
      };
    }
  }

  /**
   * The current reading of the virtual clock.
   */
  get now(): Temporal.Instant {
    return this.#now;
  }

  /**
   * Moves the virtual clock forward.  Any entry whose TTL has elapsed by the
   * new time reads as missing from this point on, exactly as it would once a
   * real `KvStore` had let it expire.
   */
  advance(duration: Temporal.DurationLike): void {
    this.#now = this.#now.add(
      Temporal.Duration.from(duration).round({ largestUnit: "hour" }),
    );
  }

  #encodeKey(key: KvKey): string {
    return JSON.stringify(key);
  }

  /**
   * Drops the entry if its TTL has elapsed.  Mirrors {@link MemoryKvStore},
   * which treats an entry as live up to and including its expiration instant.
   */
  async #evictIfExpired(key: KvKey): Promise<void> {
    const encodedKey = this.#encodeKey(key);
    const expiration = this.#expirations.get(encodedKey);
    if (expiration == null) return;
    if (this.#now.until(expiration).sign >= 0) return;
    this.#expirations.delete(encodedKey);
    await this.#inner.delete(key);
  }

  async #evictAllExpired(): Promise<void> {
    for (const [encodedKey, expiration] of [...this.#expirations]) {
      if (this.#now.until(expiration).sign >= 0) continue;
      this.#expirations.delete(encodedKey);
      await this.#inner.delete(JSON.parse(encodedKey) as KvKey);
    }
  }

  #recordTtl(key: KvKey, options?: KvStoreSetOptions): void {
    const encodedKey = this.#encodeKey(key);
    if (options?.ttl == null) {
      this.#expirations.delete(encodedKey);
      return;
    }
    this.#expirations.set(
      encodedKey,
      this.#now.add(options.ttl.round({ largestUnit: "hour" })),
    );
  }

  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    await this.#evictIfExpired(key);
    return await this.#inner.get<T>(key);
  }

  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    this.#recordTtl(key, options);
    // The TTL is deliberately withheld from the wrapped store so that only
    // the virtual clock can expire the entry.
    await this.#inner.set(key, value);
  }

  async delete(key: KvKey): Promise<void> {
    this.#expirations.delete(this.#encodeKey(key));
    await this.#inner.delete(key);
  }

  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    await this.#evictAllExpired();
    yield* this.#inner.list(prefix);
  }
}
