import type {
  KvKey,
  KvStore,
  KvStoreListEntry,
  KvStoreSetOptions,
} from "@fedify/fedify";
import type { Cluster, Redis, RedisKey } from "ioredis";
import { Buffer } from "node:buffer";
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
   */
  readonly codec?: Codec;
}

/**
 * A key–value store that uses Redis as the underlying storage.
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
export class RedisKvStore implements KvStore {
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
    this.#keyPrefix = options.keyPrefix ?? "fedify::";
    this.#keyPrefixStr = typeof this.#keyPrefix === "string"
      ? this.#keyPrefix
      : new TextDecoder().decode(new Uint8Array(this.#keyPrefix));
    this.#codec = options.codec ?? new JsonCodec();
  }

  #serializeKey(key: KvKey): RedisKey {
    const suffix = key
      .map((part: string) => part.replaceAll(":", "_:"))
      .join("::");
    if (typeof this.#keyPrefix === "string") {
      return `${this.#keyPrefix}${suffix}`;
    }
    const suffixBytes = this.#textEncoder.encode(suffix);
    return Buffer.concat([new Uint8Array(this.#keyPrefix), suffixBytes]);
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
    const encodedValue = this.#codec.encode(value);
    if (options?.ttl != null) {
      await this.#redis.setex(
        serializedKey,
        expirySeconds(options.ttl),
        encodedValue,
      );
    } else {
      await this.#redis.set(serializedKey, encodedValue);
    }
  }

  async delete(key: KvKey): Promise<void> {
    const serializedKey = this.#serializeKey(key);
    await this.#redis.del(serializedKey);
  }

  #deserializeKey(redisKey: string): KvKey {
    const suffix = redisKey.slice(this.#keyPrefixStr.length);
    return suffix.split("::").map((p) =>
      p.replaceAll("_:", ":")
    ) as unknown as KvKey;
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
      const prefixKeyFullStr = typeof prefixKey === "string"
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
