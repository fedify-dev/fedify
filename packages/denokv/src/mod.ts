/**
 * `KvStore` & `MessageQueue` adapters for Deno's KV store
 * =======================================================
 *
 * This package provides `KvStore` and `MessageQueue` implementations that use
 * Deno's KV store.  The `DenoKvStore` class implements the `KvStore` interface
 * using Deno's KV store, and the `DenoKvMessageQueue` class implements the
 * `MessageQueue` interface using Deno's KV store.
 *
 * @module
 * @since 1.9.0
 */
import type {
  KvKey,
  KvStore,
  KvStoreListEntry,
  KvStoreListOptions,
  KvStoreSetOptions,
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "@fedify/fedify/federation";
import { isEqual } from "es-toolkit";

/**
 * Represents a key–value store implementation using Deno's KV store.
 *
 * @since 1.9.0
 */
export class DenoKvStore implements KvStore {
  #kv: Deno.Kv;

  /**
   * Constructs a new {@link DenoKvStore} adapter with the given Deno KV store.
   * @param kv The Deno KV store to use.
   */
  constructor(kv: Deno.Kv) {
    this.#kv = kv;
  }

  /**
   * {@inheritDoc KvStore.set}
   */
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    const entry = await this.#kv.get<T>(key);
    return entry == null || entry.value == null ? undefined : entry.value;
  }

  /**
   * {@inheritDoc KvStore.set}
   */
  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    await this.#kv.set(
      key,
      value,
      options?.ttl == null ? undefined : {
        expireIn: options.ttl.total("millisecond"),
      },
    );
  }

  /**
   * {@inheritDoc KvStore.delete}
   */
  delete(key: KvKey): Promise<void> {
    return this.#kv.delete(key);
  }

  /**
   * {@inheritDoc KvStore.cas}
   */
  async cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    while (true) {
      const entry = await this.#kv.get(key);
      if (!isEqual(entry.value ?? undefined, expectedValue)) return false;
      const result = await this.#kv.atomic()
        .check(entry)
        .set(
          key,
          newValue,
          options?.ttl == null ? undefined : {
            expireIn: options.ttl.total("millisecond"),
          },
        )
        .commit();
      if (result.ok) return true;
    }
  }

  /**
   * {@inheritDoc KvStore.list}
   * @since 1.10.0
   */
  async *list(
    options: KvStoreListOptions,
  ): AsyncIterable<KvStoreListEntry> {
    // First, check if the exact prefix key exists
    const exactEntry = await this.#kv.get(options.prefix);
    if (exactEntry.value != null) {
      yield {
        key: options.prefix,
        value: exactEntry.value,
      };
    }

    // Then list all keys starting with the prefix
    const entries = this.#kv.list({ prefix: options.prefix });
    for await (const entry of entries) {
      if (entry.value == null) continue;
      yield {
        key: entry.key as KvKey,
        value: entry.value,
      };
    }
  }
}

/**
 * Represents a message queue adapter that uses Deno KV store.
 *
 * @since 1.9.0
 */
export class DenoKvMessageQueue implements MessageQueue, Disposable {
  #kv: Deno.Kv;

  /**
   * Deno KV queues provide automatic retry with exponential backoff.
   * @since 1.7.0
   */
  readonly nativeRetrial = true;

  /**
   * Constructs a new {@link DenoKvMessageQueue} adapter with the given Deno KV
   * store.
   * @param kv The Deno KV store to use.
   */
  constructor(kv: Deno.Kv) {
    this.#kv = kv;
  }

  async enqueue(
    // deno-lint-ignore no-explicit-any
    message: any,
    options?: MessageQueueEnqueueOptions | undefined,
  ): Promise<void> {
    await this.#kv.enqueue(
      message,
      options?.delay == null ? undefined : {
        delay: Math.max(options.delay.total("millisecond"), 0),
      },
    );
  }

  listen(
    // deno-lint-ignore no-explicit-any
    handler: (message: any) => void | Promise<void>,
    options: MessageQueueListenOptions = {},
  ): Promise<void> {
    options.signal?.addEventListener("abort", () => {
      try {
        this.#kv.close();
      } catch (e) {
        if (!(e instanceof Deno.errors.BadResource)) throw e;
      }
    }, { once: true });
    return this.#kv.listenQueue(handler);
  }

  [Symbol.dispose](): void {
    try {
      this.#kv.close();
    } catch (e) {
      if (!(e instanceof Deno.errors.BadResource)) throw e;
    }
  }
}
