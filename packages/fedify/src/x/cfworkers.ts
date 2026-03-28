/**
 * `KvStore` & `MessageQueue` adapters for Cloudflare Workers
 * ==========================================================
 *
 * This module provides `KvStore` and `MessageQueue` implementations that use
 * Cloudflare Workers' KV and Queues bindings, respectively.
 *
 * @deprecated This module has been moved to a separate package.
 *             Install and import from `@fedify/cfworkers` instead.
 *             This module will be removed in Fedify v2.0.
 *
 * @module
 * @since 1.6.0
 */
/// <reference types="@cloudflare/workers-types/experimental" />
import { getLogger } from "@logtape/logtape";
import type { KvKey, KvStore, KvStoreSetOptions } from "../federation/kv.ts";
import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "../federation/mq.ts";

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
 *
 * @deprecated This class has been moved to `@fedify/cfworkers` package.
 *             Import `WorkersKvStore` from `@fedify/cfworkers` instead.
 *             This class will be removed in Fedify v2.0.
 * @since 1.6.0
 */
export class WorkersKvStore implements KvStore {
  #namespace: KVNamespace<string>;

  constructor(namespace: KVNamespace<string>) {
    const logger = getLogger(["fedify", "cfworkers"]);
    logger.warn(
      "The `@fedify/fedify/x/cfworkers` module is deprecated; use " +
        "`WorkersKvStore` from `@fedify/cfworkers` package instead.",
    );
    this.#namespace = namespace;
  }

  #encodeKey(key: KvKey): string {
    return JSON.stringify(key);
  }

  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    const encodedKey = this.#encodeKey(key);
    const { value, metadata } = await this.#namespace.getWithMetadata<
      T,
      KvMetadata
    >(
      encodedKey,
      "json",
    );
    if (value == null) return undefined;
    if (metadata?.expires != null && metadata.expires < Date.now()) {
      return undefined;
    }
    return value;
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
 *
 * @deprecated This class has been moved to `@fedify/cfworkers` package.
 *             Import `WorkersMessageQueue` from `@fedify/cfworkers` instead.
 *             This class will be removed in Fedify v2.0.
 * @since 1.6.0
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
    const logger = getLogger(["fedify", "cfworkers"]);
    logger.warn(
      "The `@fedify/fedify/x/cfworkers` module is deprecated; use " +
        "`WorkersMessageQueue` from `@fedify/cfworkers` package instead.",
    );
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
