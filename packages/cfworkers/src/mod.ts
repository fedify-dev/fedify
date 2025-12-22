/**
 * `KvStore` & `MessageQueue` adapters for Cloudflare Workers
 * ==========================================================
 *
 * This package provides `KvStore` and `MessageQueue` implementations that use
 * Cloudflare Workers' KV and Queues bindings, respectively.
 *
 * @module
 * @since 1.9.0
 */
import type {
  KVNamespace,
  MessageSendRequest,
  Queue,
} from "@cloudflare/workers-types/experimental";
import type {
  KvKey,
  KvStore,
  KvStoreListEntry,
  KvStoreSetOptions,
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "@fedify/fedify/federation";

interface KvMetadata {
  expires?: number;
}

/**
 * Implementation of the {@link KvStore} interface for Cloudflare Workers KV
 * binding.  This class provides a wrapper around Cloudflare's KV namespace to
 * store and retrieve JSON-serializable values using structured keys.
 *
 * Note that this implementation does not support the {@link KvStore.cas}
 * operation, as Cloudflare Workers KV does not support atomic compare-and-swap
 * operations.  If you need this functionality, consider using a different
 * key–value store that supports atomic operations.
 * @since 1.9.0
 */
export class WorkersKvStore implements KvStore {
  #namespace: KVNamespace<string>;

  constructor(namespace: KVNamespace<string>) {
    this.#namespace = namespace;
  }

  #encodeKey(key: KvKey): string {
    return JSON.stringify(key);
  }

  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    const encodedKey = this.#encodeKey(key);
    const { value, metadata } = await this.#namespace.getWithMetadata(
      encodedKey,
      "json",
    );
    return metadata == null || metadata.expires < Date.now()
      ? undefined
      : value as T;
  }

  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    const encodedKey = this.#encodeKey(key);
    const metadata: KvMetadata = options?.ttl == null ? {} : {
      expires: Date.now() + options.ttl.total("milliseconds"),
    };
    await this.#namespace.put(
      encodedKey,
      JSON.stringify(value),
      options?.ttl == null ? { metadata } : {
        // According to Cloudflare Workers KV documentation,
        // the minimum TTL is 60 seconds:
        expirationTtl: Math.max(options.ttl.total("seconds"), 60),
        metadata,
      },
    );
  }

  delete(key: KvKey): Promise<void> {
    return this.#namespace.delete(this.#encodeKey(key));
  }

  /**
   * {@inheritDoc KvStore.list}
   * @since 1.10.0
   */
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    if (prefix == null || prefix.length === 0) {
      // Empty prefix: list all entries
      // JSON encoded keys start with '[', so prefix with '[' to match all arrays
      let cursor: string | undefined;
      do {
        const result = await this.#namespace.list<KvMetadata>({
          prefix: "[",
          cursor,
        });
        cursor = result.list_complete ? undefined : result.cursor;

        for (const keyInfo of result.keys) {
          const metadata = keyInfo.metadata as KvMetadata | undefined;
          if (metadata?.expires != null && metadata.expires < Date.now()) {
            continue;
          }

          const value = await this.#namespace.get(keyInfo.name, "json");
          if (value == null) continue;

          yield {
            key: JSON.parse(keyInfo.name) as KvKey,
            value,
          };
        }
      } while (cursor != null);
    } else {
      // Keys are JSON encoded: '["prefix","a"]'
      // Pattern to match keys starting with prefix: '["prefix",' matches children
      // Also check for exact match: '["prefix"]'
      const exactKey = this.#encodeKey(prefix);
      const childrenPattern = JSON.stringify(prefix).slice(0, -1) + ",";

      // First, check if the exact prefix key exists
      const { value, metadata } = await this.#namespace.getWithMetadata(
        exactKey,
        "json",
      );
      if (
        value != null &&
        (metadata == null || (metadata as KvMetadata).expires == null ||
          (metadata as KvMetadata).expires! >= Date.now())
      ) {
        yield {
          key: prefix,
          value,
        };
      }

      // Then list all keys starting with prefix
      let cursor: string | undefined;
      do {
        const result = await this.#namespace.list<KvMetadata>({
          prefix: childrenPattern,
          cursor,
        });
        cursor = result.list_complete ? undefined : result.cursor;

        for (const keyInfo of result.keys) {
          const metadata = keyInfo.metadata as KvMetadata | undefined;
          if (metadata?.expires != null && metadata.expires < Date.now()) {
            continue;
          }

          const value = await this.#namespace.get(keyInfo.name, "json");
          if (value == null) continue;

          yield {
            key: JSON.parse(keyInfo.name) as KvKey,
            value,
          };
        }
      } while (cursor != null);
    }
  }
}

/**
 * Implementation of the {@link MessageQueue} interface for Cloudflare
 * Workers Queues binding.  This class provides a wrapper around Cloudflare's
 * Queues to send messages to a queue.
 *
 * Note that this implementation does not support the `listen()` method,
 * as Cloudflare Workers Queues do not support message consumption in the same
 * way as other message queue systems.  Instead, you should use
 * the {@link Federation.processQueuedTask} method to process messages
 * passed to the queue.
 * @since 1.9.0
 */
export class WorkersMessageQueue implements MessageQueue {
  #queue: Queue;

  /**
   * Cloudflare Queues provide automatic retry with exponential backoff
   * and Dead Letter Queues.
   * @since 1.7.0
   */
  readonly nativeRetrial = true;

  constructor(queue: Queue) {
    this.#queue = queue;
  }

  // deno-lint-ignore no-explicit-any
  enqueue(message: any, options?: MessageQueueEnqueueOptions): Promise<void> {
    return this.#queue.send(message, {
      contentType: "json",
      delaySeconds: options?.delay?.total("seconds") ?? 0,
    });
  }

  enqueueMany(
    // deno-lint-ignore no-explicit-any
    messages: any[],
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    const requests: MessageSendRequest[] = messages.map((msg) => ({
      body: msg,
      contentType: "json",
    }));
    return this.#queue.sendBatch(requests, {
      delaySeconds: options?.delay?.total("seconds") ?? 0,
    });
  }

  listen(
    // deno-lint-ignore no-explicit-any
    _handler: (message: any) => Promise<void> | void,
    _options?: MessageQueueListenOptions,
  ): Promise<void> {
    throw new TypeError(
      "WorkersMessageQueue does not support listen().  " +
        "Use Federation.processQueuedTask() method instead.",
    );
  }
}
