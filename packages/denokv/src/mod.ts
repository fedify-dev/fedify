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
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    const prefixToUse = prefix ?? [];

    // First, check if the exact prefix key exists (only if prefix is specified)
    if (prefix != null && prefix.length > 0) {
      const exactEntry = await this.#kv.get(prefix);
      if (exactEntry.value != null) {
        yield {
          key: prefix,
          value: exactEntry.value,
        };
      }
    }

    // Then list all keys starting with the prefix
    const entries = this.#kv.list({ prefix: prefixToUse });
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
 * Internal message wrapper that includes ordering key metadata.
 */
interface WrappedMessage {
  readonly __fedify_ordering_key__?: string;
  // deno-lint-ignore no-explicit-any
  readonly __fedify_payload__: any;
}

/**
 * Options for {@link DenoKvMessageQueue}.
 * @since 2.0.0
 */
export interface DenoKvMessageQueueOptions {
  /**
   * The key prefix to use for ordering key locks.
   * Defaults to `["__fedify_ordering_lock__"]`.
   * @default `["__fedify_ordering_lock__"]`
   */
  readonly orderingLockPrefix?: Deno.KvKey;
}

/**
 * Represents a message queue adapter that uses Deno KV store.
 *
 * @since 1.9.0
 */
export class DenoKvMessageQueue implements MessageQueue, Disposable {
  #kv: Deno.Kv;
  #orderingLockPrefix: Deno.KvKey;

  /**
   * Deno KV queues provide automatic retry with exponential backoff.
   * @since 1.7.0
   */
  readonly nativeRetrial = true;

  /**
   * Constructs a new {@link DenoKvMessageQueue} adapter with the given Deno KV
   * store.
   * @param kv The Deno KV store to use.
   * @param options Options for the message queue.
   */
  constructor(kv: Deno.Kv, options: DenoKvMessageQueueOptions = {}) {
    this.#kv = kv;
    this.#orderingLockPrefix = options.orderingLockPrefix ??
      ["__fedify_ordering_lock__"];
  }

  #getOrderingLockKey(orderingKey: string): Deno.KvKey {
    return [...this.#orderingLockPrefix, orderingKey];
  }

  async enqueue(
    // deno-lint-ignore no-explicit-any
    message: any,
    options?: MessageQueueEnqueueOptions | undefined,
  ): Promise<void> {
    const wrapped: WrappedMessage = {
      __fedify_ordering_key__: options?.orderingKey,
      __fedify_payload__: message,
    };
    await this.#kv.enqueue(
      wrapped,
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
    // deno-lint-ignore no-explicit-any
    const wrappedHandler = async (rawMessage: any): Promise<void> => {
      // Handle both wrapped and unwrapped messages for backwards compatibility
      const wrapped = rawMessage as WrappedMessage;
      const orderingKey = wrapped.__fedify_ordering_key__;
      const message = "__fedify_payload__" in wrapped
        ? wrapped.__fedify_payload__
        : rawMessage;
      // If this ordering key is currently being processed, re-enqueue with delay
      if (orderingKey != null) {
        const lockKey = this.#getOrderingLockKey(orderingKey);
        const existing = await this.#kv.get(lockKey);
        if (existing.value != null) {
          // Another listener is processing this ordering key, re-enqueue
          await this.#kv.enqueue(rawMessage, { delay: 100 });
          return;
        }
        // Try to acquire the lock using atomic check
        const lockResult = await this.#kv.atomic()
          .check(existing)
          .set(lockKey, true, { expireIn: 60000 }) // 60 second TTL
          .commit();
        if (!lockResult.ok) {
          // Race condition: another listener got the lock, re-enqueue
          await this.#kv.enqueue(rawMessage, { delay: 100 });
          return;
        }
      }
      try {
        await handler(message);
      } finally {
        // Release the ordering key lock
        if (orderingKey != null) {
          await this.#kv.delete(this.#getOrderingLockKey(orderingKey));
        }
      }
    };
    return this.#kv.listenQueue(wrappedHandler);
  }

  [Symbol.dispose](): void {
    try {
      this.#kv.close();
    } catch (e) {
      if (!(e instanceof Deno.errors.BadResource)) throw e;
    }
  }
}
