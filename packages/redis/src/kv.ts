import type {
  AtomicKvStore,
  KvKey,
  KvStoreCasEntry,
  KvStoreListEntry,
  KvStoreSetEntry,
  KvStoreSetOptions,
} from "@fedify/fedify";
import { Command, type Cluster, type Redis, type RedisKey } from "ioredis";
import { Buffer } from "node:buffer";
import {
  atomicMaxBytes,
  atomicMaxEntries,
  atomicMaxTtlSeconds,
  atomicMutationScript,
  atomicSnapshotScript,
} from "./atomic.ts";
import { type Codec, JsonCodec } from "./codec.ts";

/**
 * Turns a TTL into the whole number of seconds Redis `SETEX` requires.
 *
 * The one-second granularity is `SETEX`'s, not Redis's: Redis can express a
 * millisecond expiry through `SET` with `PX`, and `SETEX` is simply the
 * command this adapter uses.  Within that command a duration which is not a
 * whole number of seconds has to be approximated.
 *
 * It is rounded up rather than to the nearest second, because every other
 * {@link KvStore} implementation keeps a value for at least as long as it was
 * asked to, and expiring early is the direction that can change behaviour
 * rather than just cost a refetch — a TTL used to suppress duplicate work
 * would start letting duplicates through.
 *
 * The result is clamped to 1, the smallest expiry `SETEX` accepts.  A
 * sub-second duration therefore stores the value for one second instead of
 * being rejected, and so do **zero and negative durations**, which `SETEX`
 * rejects outright.  That last part is a policy choice rather than a
 * consequence of the rounding: the other {@link KvStore} implementations read
 * a non-positive TTL as already expired, whereas this one keeps the value for
 * the shortest lifetime the command can express.  Storing it briefly is closer
 * to the caller's request than failing the write, which is what happened
 * before.
 */
function expirySeconds(ttl: Temporal.Duration): number {
  return Math.max(1, Math.ceil(ttl.total("second")));
}

// EVAL integer replies can be strings with ioredis stringNumbers. Accept
// exact binary forms too, and never turn an unexpected reply into a mismatch.
function casResult(reply: unknown): boolean {
  const result = Buffer.isBuffer(reply) ? reply.toString("utf8") : reply;
  if (result === 1 || result === "1") return true;
  if (result === 0 || result === "0") return false;
  throw new TypeError("Invalid Redis CAS reply.");
}

const casScript = `
local current = redis.call('GET', KEYS[1])
if ARGV[1] == '1' then
  if current then return 0 end
elseif not current or current ~= ARGV[2] then
  return 0
end
if ARGV[3] == '1' then
  redis.call('DEL', KEYS[1])
elseif ARGV[5] ~= '0' then
  redis.call('SETEX', KEYS[1], ARGV[5], ARGV[4])
else
  redis.call('SET', KEYS[1], ARGV[4])
end
return 1
`;

/**
 * Options for {@link RedisKvStore} class.
 */
export interface RedisKvStoreOptions {
  /**
   * The prefix to use for all keys in the key–value store in Redis.
   * Defaults to `"fedify::"`.
   */
  readonly keyPrefix?: RedisKey;

  /**
   * The codec to use for encoding and decoding values in the key–value store.
   * Defaults to {@link JsonCodec}.
   * For {@link RedisKvStore.cas} and {@link RedisKvStore.casMany}, equal values
   * must encode to identical bytes. Values must round-trip through the codec;
   * `undefined` is not storable. JSON object property order affects comparison.
   */
  readonly codec?: Codec;
}

/**
 * A key–value store that uses Redis as the underlying storage.
 *
 * The atomic batch methods support official Redis 7.2.17, 7.4.12, and 8.10.3.
 * Other versions reject nonempty batches before reading or writing. Supporting
 * another release requires auditing its scripting/Cluster behavior and updating
 * Fedify. Ordinary single-key methods retain their existing version support.
 * Modified engines, forks, script debugging, and module command hooks are not
 * supported atomic configurations; the version guard does not authenticate
 * the server.
 *
 * A batch request is limited to 128 entries and 1 MiB of data: effective physical key
 * bytes (including the client's prefix), encoded values/expectations, and
 * argument strings, excluding the fixed script and protocol framing. Batch
 * TTLs are rounded up to whole seconds, with a minimum of one second and a
 * maximum of 2,147,483,647 seconds. Omitting a TTL clears the old expiry.
 *
 * On Cluster, every key must share one hash slot in database zero. An explicit
 * prefix such as `"{application}::"` can select that scope; existing keys are
 * never relocated. Redis rejects cross-slot calls without splitting them.
 * Batches may reject during resharding when keys are missing or expired.
 * Scripts need `EVAL`, `GET` or `EXISTS` as appropriate, and `SET`, `SETEX`, or
 * `DEL` permissions on all keys. EVAL also requires both read and write key
 * access, including for snapshots. Snapshot reads route to the primary.
 *
 * Atomicity does not imply persistence or failover durability. A lost reply or
 * client replay can leave commit status unknown, even when a later CAS reply
 * is `false`; re-read and re-evaluate before retrying. This adapter adds no
 * retries or changes to client options. Use ordinary `delete()` to relieve
 * memory pressure when flagged batch scripts are rejected under `maxmemory`.
 * Cluster prefix listing retains its existing node-local SCAN limitation;
 * `getMany()` is a snapshot of the requested keys, not a snapshot of `list()`.
 *
 * @example
 * ```ts ignore
 * import { createFederation } from "@fedify/fedify";
 * import { RedisKvStore } from "@fedify/redis";
 * import { Redis, Cluster } from "ioredis";
 *
 * // Using a standalone Redis instance:
 * const federation = createFederation({
 *   // ...
 *   kv: new RedisKvStore(new Redis()),
 * });
 *
 * // Using a Redis Cluster:
 * const cluster = new Cluster([
 *   { host: "127.0.0.1", port: 7000 },
 *   { host: "127.0.0.1", port: 7001 },
 *   { host: "127.0.0.1", port: 7002 },
 * ]);
 * const federation = createFederation({
 *   // ...
 *   kv: new RedisKvStore(cluster),
 * });
 * ```
 */
export class RedisKvStore implements AtomicKvStore {
  #redis: Redis | Cluster;
  #keyPrefix: RedisKey;
  #keyPrefixStr: string;
  #codec: Codec;
  #textEncoder = new TextEncoder();

  /**
   * Creates a new Redis key–value store.
   * @param redis The Redis client (standalone or cluster) to use.
   * @param options The options for the key–value store.
   */
  constructor(redis: Redis | Cluster, options: RedisKvStoreOptions = {}) {
    this.#redis = redis;
    const keyPrefix = options.keyPrefix ?? "fedify::";
    this.#keyPrefix =
      typeof keyPrefix === "string" ? keyPrefix : Buffer.from(keyPrefix);
    this.#keyPrefixStr =
      typeof this.#keyPrefix === "string"
        ? this.#keyPrefix
        : new TextDecoder().decode(new Uint8Array(this.#keyPrefix));
    this.#codec = options.codec ?? new JsonCodec();
  }

  #serializeKey(key: KvKey): RedisKey {
    if (!Array.isArray(key) || key.length === 0) {
      throw new TypeError("A KV key must be a nonempty array of strings.");
    }
    const parts: string[] = [];
    for (let index = 0; index < key.length; index++) {
      const part = key[index];
      if (!Object.hasOwn(key, index) || typeof part !== "string") {
        throw new TypeError("A KV key must be a dense array of strings.");
      }
      parts.push(part.replaceAll(":", "_:"));
    }
    const suffix = parts.join("::");
    if (typeof this.#keyPrefix === "string") {
      return `${this.#keyPrefix}${suffix}`;
    }
    const suffixBytes = this.#textEncoder.encode(suffix);
    return Buffer.concat([new Uint8Array(this.#keyPrefix), suffixBytes]);
  }

  #encode(value: unknown): Buffer {
    if (value === undefined) {
      throw new TypeError("undefined is not a storable KV value.");
    }
    const encoded = this.#codec.encode(value);
    if (!Buffer.isBuffer(encoded)) {
      throw new TypeError("Codec.encode() must return a Buffer.");
    }
    // A codec can reuse its scratch buffer on the next encode().
    return Buffer.from(encoded);
  }

  #batch<T>(items: readonly T[]): T[] {
    if (!Array.isArray(items)) {
      throw new TypeError("A KV batch must be an array.");
    }
    const length = items.length;
    if (length > atomicMaxEntries) {
      throw new RangeError(
        `A KV batch cannot exceed ${atomicMaxEntries} entries.`,
      );
    }
    const captured: T[] = [];
    for (let index = 0; index < length; index++) {
      if (!Object.hasOwn(items, index)) {
        throw new TypeError("A KV batch must not be sparse.");
      }
      captured.push(items[index]);
    }
    return captured;
  }

  #physicalKey(key: RedisKey): Buffer {
    const prefix = this.#redis.options.keyPrefix;
    // Match ioredis's string concatenation before UTF-8 encoding. In
    // particular, a surrogate pair can span the prefix/key boundary.
    if (typeof prefix === "string" && typeof key === "string") {
      return Buffer.from(prefix + key);
    }
    return Buffer.concat([Buffer.from(prefix ?? ""), Buffer.from(key)]);
  }

  #unique(keys: readonly RedisKey[]): void {
    const encoded = keys.map((key) => this.#physicalKey(key).toString("hex"));
    // This also prevents delete-then-write aliases on a migrating slot.
    if (new Set(encoded).size !== keys.length) {
      throw new TypeError("Duplicate keys in an atomic mutation.");
    }
  }

  #budget(keys: readonly RedisKey[], args: readonly (string | Buffer)[]): void {
    let bytes = 0;
    for (const key of keys) bytes += this.#physicalKey(key).length;
    for (const arg of args) bytes += Buffer.byteLength(arg);
    if (bytes > atomicMaxBytes) {
      throw new RangeError(
        `A KV batch cannot exceed ${atomicMaxBytes} data bytes.`,
      );
    }
  }

  #eval(
    script: string,
    keys: readonly RedisKey[],
    args: readonly (string | Buffer)[],
    replyEncoding: "utf8" | null,
  ): Promise<unknown> {
    // ioredis groups automatic pipelines by EVAL's script argument rather
    // than its first key. Direct dispatch keeps independent Cluster scopes
    // apart and still uses the client's normal prefixing and primary routing.
    return Promise.resolve(
      this.#redis.sendCommand(
        new Command("eval", [script, keys.length, ...keys, ...args], {
          keyPrefix: this.#redis.options.keyPrefix,
          replyEncoding,
        }),
      ),
    );
  }

  async #mutate(
    cas: boolean,
    entries: readonly {
      key: RedisKey;
      expectedValue: unknown;
      newValue: unknown;
      ttl: Temporal.Duration | undefined;
    }[],
  ): Promise<boolean> {
    if (entries.length === 0) return true;
    const keys = entries.map((entry) => entry.key);
    this.#unique(keys);
    // Normalize every TTL before invoking any caller-supplied codec.
    const ttls = entries.map((entry) => {
      if (entry.newValue === undefined && entry.ttl != null) {
        throw new TypeError("A CAS deletion must not specify a TTL.");
      }
      if (entry.ttl == null) return "0";
      const seconds = expirySeconds(entry.ttl);
      if (!Number.isSafeInteger(seconds) || seconds > atomicMaxTtlSeconds) {
        throw new RangeError(
          `A batch TTL cannot exceed ${atomicMaxTtlSeconds} seconds.`,
        );
      }
      return String(seconds);
    });
    const args: (string | Buffer)[] = [cas ? "1" : "0"];
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      args.push(
        entry.expectedValue === undefined ? "1" : "0",
        entry.expectedValue === undefined
          ? Buffer.alloc(0)
          : this.#encode(entry.expectedValue),
        entry.newValue === undefined ? "1" : "0",
        entry.newValue === undefined
          ? Buffer.alloc(0)
          : this.#encode(entry.newValue),
        ttls[index],
      );
    }
    // Recheck the effective prefix after codec callbacks, before dispatch.
    this.#unique(keys);
    this.#budget(keys, args);
    const result = await this.#eval(atomicMutationScript, keys, args, "utf8");
    return casResult(result);
  }

  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    const serializedKey = this.#serializeKey(key);
    const encodedValue = await this.#redis.getBuffer(serializedKey);
    if (encodedValue == null) return undefined;
    return this.#codec.decode(encodedValue) as T;
  }

  /**
   * {@inheritDoc KvStore.set}
   *
   * The `ttl` option is stored through Redis `SETEX`, which takes a whole
   * number of seconds, so a duration with a finer resolution is rounded up to
   * the next second.  A zero or negative duration stores the value for one
   * second, the shortest expiry the command can express, rather than failing
   * the write or deleting the key.
   */
  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions | undefined,
  ): Promise<void> {
    const serializedKey = this.#serializeKey(key);
    const ttl = options?.ttl;
    const encodedValue = this.#encode(value);
    if (ttl != null) {
      await this.#redis.setex(serializedKey, expirySeconds(ttl), encodedValue);
    } else {
      await this.#redis.set(serializedKey, encodedValue);
    }
  }

  async delete(key: KvKey): Promise<void> {
    const serializedKey = this.#serializeKey(key);
    await this.#redis.del(serializedKey);
  }

  /**
   * {@inheritDoc KvStore.cas}
   *
   * Values are compared as encoded bytes.  A custom {@link Codec} must encode
   * equal values identically; with {@link JsonCodec}, object property order
   * affects the comparison.  The `ttl` option follows {@link set}: a
   * fractional second is rounded up and a non-positive duration uses one
   * second.
   * @since 2.4.0
   */
  async cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    const keyBytes = this.#serializeKey(key);
    const ttl = options?.ttl;
    if (newValue === undefined && ttl != null) {
      throw new TypeError("A CAS deletion must not specify a TTL.");
    }
    const absent = Buffer.alloc(0);
    const result = await this.#redis.eval(
      casScript,
      1,
      keyBytes,
      expectedValue === undefined ? "1" : "0",
      expectedValue === undefined ? absent : this.#encode(expectedValue),
      newValue === undefined ? "1" : "0",
      newValue === undefined ? absent : this.#encode(newValue),
      ttl == null ? 0 : expirySeconds(ttl),
    );
    return casResult(result);
  }

  /**
   * {@inheritDoc AtomicKvStore.getMany}
   * @since 2.5.0
   */
  async getMany<T = unknown>(
    keys: readonly KvKey[],
  ): Promise<(T | undefined)[]> {
    const serialized = this.#batch(keys).map((key) => this.#serializeKey(key));
    if (serialized.length === 0) return [];
    this.#budget(serialized, []);
    const result = await this.#eval(atomicSnapshotScript, serialized, [], null);
    if (!Array.isArray(result) || result.length !== serialized.length) {
      throw new TypeError("Invalid Redis atomic snapshot reply.");
    }
    return result.map((encoded: unknown) => {
      if (encoded === null) return undefined;
      if (!Buffer.isBuffer(encoded)) {
        throw new TypeError("Invalid Redis atomic snapshot value.");
      }
      return this.#codec.decode(encoded) as T;
    });
  }

  /**
   * {@inheritDoc AtomicKvStore.setMany}
   * @since 2.5.0
   */
  async setMany(entries: readonly KvStoreSetEntry[]): Promise<void> {
    const captured = this.#batch(entries).map((entry) => {
      const key = this.#serializeKey(entry.key);
      const value = entry.value;
      const ttl = entry.options?.ttl;
      if (value === undefined) {
        throw new TypeError("undefined is not a storable KV value.");
      }
      return { key, expectedValue: undefined, newValue: value, ttl };
    });
    await this.#mutate(false, captured);
  }

  /**
   * {@inheritDoc AtomicKvStore.deleteMany}
   * @since 2.5.0
   */
  async deleteMany(keys: readonly KvKey[]): Promise<void> {
    await this.#mutate(
      false,
      this.#batch(keys).map((key) => ({
        key: this.#serializeKey(key),
        expectedValue: undefined,
        newValue: undefined,
        ttl: undefined,
      })),
    );
  }

  /**
   * {@inheritDoc AtomicKvStore.casMany}
   * @since 2.5.0
   */
  async casMany(entries: readonly KvStoreCasEntry[]): Promise<boolean> {
    const captured = this.#batch(entries).map((entry) => ({
      key: this.#serializeKey(entry.key),
      expectedValue: entry.expectedValue,
      newValue: entry.newValue,
      ttl: entry.options?.ttl,
    }));
    return await this.#mutate(true, captured);
  }

  #deserializeKey(redisKey: string): KvKey {
    const suffix = redisKey.slice(this.#keyPrefixStr.length);
    return suffix
      .split("::")
      .map((p) => p.replaceAll("_:", ":")) as unknown as KvKey;
  }

  /**
   * {@inheritDoc KvStore.list}
   * @since 1.10.0
   */
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    let pattern: string;
    let exactKey: string | Buffer | null = null;

    if (prefix == null || prefix.length === 0) {
      // Empty prefix: scan for all keys with the key prefix
      pattern = `${this.#keyPrefixStr}*`;
    } else {
      const prefixKey = this.#serializeKey(prefix);
      const prefixKeyFullStr =
        typeof prefixKey === "string"
          ? prefixKey
          : new TextDecoder().decode(new Uint8Array(prefixKey));
      exactKey = prefixKey;
      pattern = `${prefixKeyFullStr}::*`;
    }

    // First, check if the exact prefix key exists
    if (exactKey != null) {
      const exactValue = await this.#redis.getBuffer(exactKey);
      if (exactValue != null) {
        yield {
          key: prefix!,
          value: this.#codec.decode(exactValue),
        };
      }
    }

    // Scan for all keys matching the pattern
    let cursor = "0";
    do {
      const [nextCursor, keys] = await this.#redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;

      for (const key of keys) {
        const encodedValue = await this.#redis.getBuffer(key);
        if (encodedValue == null) continue;
        yield {
          key: this.#deserializeKey(key),
          value: this.#codec.decode(encodedValue),
        };
      }
    } while (cursor !== "0");
  }
}
