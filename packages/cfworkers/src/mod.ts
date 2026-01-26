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
 * Internal message wrapper that includes ordering key metadata.
 */
interface WrappedMessage {
  readonly __fedify_ordering_key__?: string;
  // deno-lint-ignore no-explicit-any
  readonly __fedify_payload__: any;
}

/**
 * Result from {@link WorkersMessageQueue.processMessage}.
 * @since 2.0.0
 */
export interface ProcessMessageResult {
  /**
   * Whether the message should be processed.  If `false`, the message has been
   * re-enqueued to wait for the ordering key lock to be released.
   */
  readonly shouldProcess: boolean;
  /**
   * The unwrapped message payload to process.
   * Only present when `shouldProcess` is `true`.
   */
  // deno-lint-ignore no-explicit-any
  readonly message?: any;
  /**
   * A cleanup function that must be called after processing the message.
   * This releases the ordering key lock.  Only present when `shouldProcess`
   * is `true` and the message had an ordering key.
   */
  readonly release?: () => Promise<void>;
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
    let pattern: string;
    let exactKey: string | null = null;

    if (prefix == null || prefix.length === 0) {
      // Empty prefix: list all entries
      // JSON encoded keys start with '[', so prefix with '[' to match all arrays
      pattern = "[";
    } else {
      // Keys are JSON encoded: '["prefix","a"]'
      // Pattern to match keys starting with prefix: '["prefix",' matches children
      exactKey = this.#encodeKey(prefix);
      pattern = JSON.stringify(prefix).slice(0, -1) + ",";
    }

    // First, check if the exact prefix key exists
    if (exactKey != null) {
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
          key: prefix!,
          value,
        };
      }
    }

    // List all keys matching the pattern
    let cursor: string | undefined;
    do {
      const result = await this.#namespace.list<KvMetadata>({
        prefix: pattern,
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

/**
 * Options for {@link WorkersMessageQueue}.
 * @since 2.0.0
 */
export interface WorkersMessageQueueOptions {
  /**
   * The KV namespace to use for ordering key locks.  If not provided, ordering
   * keys will not be supported.
   *
   * Note: Cloudflare Workers KV has eventual consistency, so ordering key
   * guarantees are best-effort.  For strict ordering requirements, consider
   * using Durable Objects.
   */
  readonly orderingKv?: KVNamespace<string>;

  /**
   * The prefix for ordering key lock keys.  Defaults to `"__fedify_ordering_"`.
   * @default `"__fedify_ordering_"`
   */
  readonly orderingKeyPrefix?: string;

  /**
   * The TTL (time-to-live) for ordering key locks in seconds.
   * Defaults to 60 seconds.  Must be at least 60 seconds due to
   * Cloudflare KV minimum TTL requirement.
   * @default 60
   */
  readonly orderingLockTtl?: number;
}

/**
 * Implementation of the {@link MessageQueue} interface for Cloudflare
 * Workers Queues binding.  This class provides a wrapper around Cloudflare's
 * Queues to send messages to a queue.
 *
 * Note that this implementation does not support the `listen()` method,
 * as Cloudflare Workers Queues do not support message consumption in the same
 * way as other message queue systems.  Instead, you should use
 * the {@link WorkersMessageQueue.processMessage} method to handle ordering key
 * locks before calling {@link Federation.processQueuedTask}.
 * @since 1.9.0
 */
export class WorkersMessageQueue implements MessageQueue {
  #queue: Queue;
  #orderingKv?: KVNamespace<string>;
  #orderingKeyPrefix: string;
  #orderingLockTtl: number;

  /**
   * Cloudflare Queues provide automatic retry with exponential backoff
   * and Dead Letter Queues.
   * @since 1.7.0
   */
  readonly nativeRetrial = true;

  /**
   * Constructs a new {@link WorkersMessageQueue} with the given queue and
   * optional ordering key configuration.
   * @param queue The Cloudflare Queue binding.
   * @param options Options for ordering key support.
   */
  constructor(queue: Queue, options: WorkersMessageQueueOptions = {}) {
    this.#queue = queue;
    this.#orderingKv = options.orderingKv;
    this.#orderingKeyPrefix = options.orderingKeyPrefix ?? "__fedify_ordering_";
    this.#orderingLockTtl = Math.max(options.orderingLockTtl ?? 60, 60);
  }

  #getOrderingLockKey(orderingKey: string): string {
    return `${this.#orderingKeyPrefix}${orderingKey}`;
  }

  async enqueue(
    // deno-lint-ignore no-explicit-any
    message: any,
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    // Wrap message with ordering key if present and KV is configured
    const wrapped: WrappedMessage = {
      __fedify_ordering_key__: options?.orderingKey,
      __fedify_payload__: message,
    };
    await this.#queue.send(wrapped, {
      contentType: "json",
      delaySeconds: options?.delay?.total("seconds") ?? 0,
    });
  }

  async enqueueMany(
    // deno-lint-ignore no-explicit-any
    messages: readonly any[],
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    const requests: MessageSendRequest[] = messages.map((msg) => ({
      body: {
        __fedify_ordering_key__: options?.orderingKey,
        __fedify_payload__: msg,
      } satisfies WrappedMessage,
      contentType: "json",
    }));
    await this.#queue.sendBatch(requests, {
      delaySeconds: options?.delay?.total("seconds") ?? 0,
    });
  }

  /**
   * Processes a message from the queue, handling ordering key locks.
   * Call this method before {@link Federation.processQueuedTask} to ensure
   * ordering key semantics are respected.
   *
   * Example usage in a Cloudflare Worker queue handler:
   *
   * ```typescript ignore
   * export default {
   *   async queue(batch, env, ctx) {
   *     const queue = new WorkersMessageQueue(env.QUEUE, {
   *       orderingKv: env.ORDERING_KV,
   *     });
   *     for (const msg of batch.messages) {
   *       const result = await queue.processMessage(msg.body);
   *       if (!result.shouldProcess) {
   *         msg.retry();  // Re-enqueue to wait for lock
   *         continue;
   *       }
   *       try {
   *         await federation.processQueuedTask(ctx, result.message);
   *         msg.ack();
   *       } catch (e) {
   *         msg.retry();
   *       } finally {
   *         await result.release?.();
   *       }
   *     }
   *   }
   * };
   * ```
   *
   * @param rawMessage The raw message body from the queue.
   * @returns A result object indicating whether to process the message.
   * @since 2.0.0
   */
  // deno-lint-ignore no-explicit-any
  async processMessage(rawMessage: any): Promise<ProcessMessageResult> {
    // Handle both wrapped and unwrapped messages for backwards compatibility
    const wrapped = rawMessage as WrappedMessage;
    const orderingKey = wrapped.__fedify_ordering_key__;
    const message = "__fedify_payload__" in wrapped
      ? wrapped.__fedify_payload__
      : rawMessage;

    // If no ordering key or no KV configured, process immediately
    if (orderingKey == null || this.#orderingKv == null) {
      return { shouldProcess: true, message };
    }

    const lockKey = this.#getOrderingLockKey(orderingKey);

    // Check if lock exists
    const existing = await this.#orderingKv.get(lockKey);
    if (existing != null) {
      // Lock exists, message should be retried later
      return { shouldProcess: false };
    }

    // Try to acquire lock
    // Note: Workers KV doesn't support atomic CAS, so there's a race condition
    // window.  This is best-effort ordering.
    await this.#orderingKv.put(lockKey, Date.now().toString(), {
      expirationTtl: this.#orderingLockTtl,
    });

    const release = async (): Promise<void> => {
      await this.#orderingKv!.delete(lockKey);
    };

    return { shouldProcess: true, message, release };
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
