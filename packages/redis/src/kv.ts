import type { KvKey, KvStore, KvStoreSetOptions } from "@fedify/fedify";
import type { Redis, RedisKey } from "ioredis";
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
 * import { Redis } from "ioredis";
 *
 * const federation = createFederation({
 *   // ...
 *   kv: new RedisKvStore(new Redis()),
 * });
 * ```
 */
export class RedisKvStore implements KvStore {
  #redis: Redis;
  #keyPrefix: RedisKey;
  #codec: Codec;
  #textEncoder = new TextEncoder();

  /**
   * Creates a new Redis key–value store.
   * @param redis The Redis client to use.
   * @param options The options for the key–value store.
   */
  constructor(redis: Redis, options: RedisKvStoreOptions = {}) {
    this.#redis = redis;
    this.#keyPrefix = options.keyPrefix ?? "fedify::";
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
}
