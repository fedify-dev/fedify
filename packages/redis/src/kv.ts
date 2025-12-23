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
 * Options for {@link RedisKvStore} class.
 */
export interface RedisKvStoreOptions {
  /**
   * The prefix to use for all keys in the key–value store in Redis.
   * Defaults to `"fedify::"`.
   */
  keyPrefix?: RedisKey;

  /**
   * The codec to use for encoding and decoding values in the key–value store.
   * Defaults to {@link JsonCodec}.
   */
  codec?: Codec;
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
        options.ttl.total("second"),
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
    if (prefix == null || prefix.length === 0) {
      // Empty prefix: scan for all keys with the key prefix
      const pattern = `${this.#keyPrefixStr}*`;

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
    } else {
      const prefixKey = this.#serializeKey(prefix);
      const prefixKeyFullStr = typeof prefixKey === "string"
        ? prefixKey
        : new TextDecoder().decode(new Uint8Array(prefixKey));

      // First, check if the exact prefix key exists
      const exactValue = await this.#redis.getBuffer(prefixKey);
      if (exactValue != null) {
        yield {
          key: prefix,
          value: this.#codec.decode(exactValue),
        };
      }

      // Then scan for all keys starting with prefix::
      const pattern = `${prefixKeyFullStr}::*`;

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
}
