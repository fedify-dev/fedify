// deno-lint-ignore-file no-explicit-any
import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import type { Cluster, Redis, RedisKey } from "ioredis";
import { type Codec, JsonCodec } from "./codec.ts";

const logger = getLogger(["fedify", "redis", "mq"]);

/**
 * Options for {@link RedisMessageQueue} class.
 */
export interface RedisMessageQueueOptions {
  /**
   * The unique identifier for the worker that is processing messages from the
   * queue.  If this is not specified, a random identifier will be generated.
   * This is used to prevent multiple workers from processing the same message,
   * so it should be unique for each worker.
   */
  readonly workerId?: string;

  /**
   * The Pub/Sub channel key to use for the message queue.  `"fedify_channel"`
   * by default.
   * @default `"fedify_channel"`
   */
  readonly channelKey?: RedisKey;

  /**
   * The Sorted Set key to use for the delayed message queue.  `"fedify_queue"`
   * by default.
   * @default `"fedify_queue"`
   */
  readonly queueKey?: RedisKey;

  /**
   * The key to use for locking the message queue.  `"fedify_lock"` by default.
   * @default `"fedify_lock"`
   */
  readonly lockKey?: RedisKey;

  /**
   * The codec to use for encoding and decoding messages in the key–value store.
   * Defaults to {@link JsonCodec}.
   * @default {@link JsonCodec}
   */
  readonly codec?: Codec;

  /**
   * The poll interval for the message queue.  5 seconds by default.
   * @default `{ seconds: 5 }`
   */
  readonly pollInterval?: Temporal.Duration | Temporal.DurationLike;
}

/**
 * A message queue that uses Redis as the underlying storage.
 *
 * @example
 * ```ts ignore
 * import { createFederation } from "@fedify/fedify";
 * import { RedisMessageQueue } from "@fedify/redis";
 * import { Redis, Cluster } from "ioredis";
 *
 * // Using a standalone Redis instance:
 * const federation = createFederation({
 *   // ...
 *   queue: new RedisMessageQueue(() => new Redis()),
 * });
 *
 * // Using a Redis Cluster:
 * const federation = createFederation({
 *   // ...
 *   queue: new RedisMessageQueue(() => new Cluster([
 *     { host: "127.0.0.1", port: 7000 },
 *     { host: "127.0.0.1", port: 7001 },
 *     { host: "127.0.0.1", port: 7002 },
 *   ])),
 * });
 * ```
 */
export class RedisMessageQueue implements MessageQueue, Disposable {
  #redis: Redis | Cluster;
  #subRedis: Redis | Cluster;
  #workerId: string;
  #channelKey: RedisKey;
  #queueKey: RedisKey;
  #lockKey: RedisKey;
  #codec: Codec;
  #pollIntervalMs: number;
  #loopHandle?: ReturnType<typeof setInterval>;

  /**
   * Creates a new Redis message queue.
   * @param redis The Redis client factory.
   * @param options The options for the message queue.
   */
  constructor(
    redis: () => Redis | Cluster,
    options: RedisMessageQueueOptions = {},
  ) {
    this.#redis = redis();
    this.#subRedis = redis();
    this.#workerId = options.workerId ?? crypto.randomUUID();
    this.#channelKey = options.channelKey ?? "fedify_channel";
    this.#queueKey = options.queueKey ?? "fedify_queue";
    this.#lockKey = options.lockKey ?? "fedify_lock";
    this.#codec = options.codec ?? new JsonCodec();
    this.#pollIntervalMs = Temporal.Duration.from(
      options.pollInterval ?? { seconds: 5 },
    ).total("millisecond");
  }

  async enqueue(
    message: any,
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    const ts = options?.delay == null
      ? 0
      : Temporal.Now.instant().add(options.delay).epochMilliseconds;
    const encodedMessage = this.#codec.encode([
      crypto.randomUUID(),
      message,
    ]);
    await this.#redis.zadd(this.#queueKey, ts, encodedMessage);
    if (ts < 1) this.#redis.publish(this.#channelKey, "");
  }

  async enqueueMany(
    messages: readonly any[],
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    if (messages.length === 0) return;
    const ts = options?.delay == null
      ? 0
      : Temporal.Now.instant().add(options.delay).epochMilliseconds;
    // Use multi to batch multiple ZADD commands:
    const multi = this.#redis.multi();
    for (const message of messages) {
      const encodedMessage = this.#codec.encode([
        crypto.randomUUID(),
        message,
      ]);
      multi.zadd(this.#queueKey, ts, encodedMessage);
    }
    // Execute all commands in a single transaction:
    await multi.exec();
    // Notify only if there's no delay:
    if (ts < 1) this.#redis.publish(this.#channelKey, "");
  }

  async #poll(): Promise<any | undefined> {
    logger.debug("Polling for messages...");
    const result = await this.#redis.set(
      this.#lockKey,
      this.#workerId,
      "EX",
      Math.floor(this.#pollIntervalMs / 1000 * 2),
      "NX",
    );
    if (result == null) {
      logger.debug(
        "Another worker is already processing messages; skipping...",
      );
      return;
    }
    logger.debug("Acquired lock; processing messages...");
    const messages = await this.#redis.zrangebyscoreBuffer(
      this.#queueKey,
      0,
      Temporal.Now.instant().epochMilliseconds,
    );
    logger.debug(
      "Found {messages} messages to process.",
      { messages: messages.length },
    );
    try {
      if (messages.length < 1) return;
      const encodedMessage = messages[0];
      await this.#redis.zrem(this.#queueKey, encodedMessage);
      const [_, message] = this.#codec.decode(encodedMessage) as [string, any];
      return message;
    } finally {
      await this.#redis.del(this.#lockKey);
    }
  }

  async listen(
    handler: (message: any) => void | Promise<void>,
    options: MessageQueueListenOptions = {},
  ): Promise<void> {
    if (this.#loopHandle != null) {
      throw new Error("Already listening");
    }
    const signal = options.signal;
    const poll = async () => {
      while (!signal?.aborted) {
        let message: any;
        try {
          message = await this.#poll();
        } catch (error) {
          logger.error("Error polling for messages: {error}", { error });
          return;
        }
        if (message === undefined) return;
        await handler(message);
      }
    };
    // Await subscription to ensure it's established before continuing.
    // This prevents the race condition where enqueue() publishes a notification
    // before the message handler is attached.
    await this.#subRedis.subscribe(this.#channelKey);
    /**
     * Cast to Redis for event methods. Both Redis and Cluster extend EventEmitter
     * and get the same methods via applyMixin at runtime, but their TypeScript
     * interfaces are incompatible:
     * - Redis declares specific overloads: on(event: "message", cb: (channel, message) => void)
     * - Cluster only has generic: on(event: string | symbol, listener: Function)
     *
     * This makes the union type Redis | Cluster incompatible for these method calls.
     * The cast is safe because both classes use applyMixin(Class, EventEmitter) which
     * copies all EventEmitter prototype methods, giving them identical pub/sub functionality.
     *
     * @see https://github.com/redis/ioredis/blob/main/lib/Redis.ts#L863 (has specific overloads)
     * @see https://github.com/redis/ioredis/blob/main/lib/cluster/index.ts#L1110 (empty interface)
     */
    const subRedis = this.#subRedis as Redis;
    // Attach the message handler synchronously after subscription is confirmed.
    // This ensures no pub/sub notifications are missed.
    subRedis.on("message", poll);
    const timeouts = new Set<ReturnType<typeof setTimeout>>();
    signal?.addEventListener("abort", () => {
      subRedis.off("message", poll);
      for (const timeout of timeouts) clearTimeout(timeout);
    });
    // Perform an initial poll immediately to catch any messages that were
    // enqueued before the listener started.
    await poll();
    while (!signal?.aborted) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await new Promise<unknown>((resolve) => {
        signal?.addEventListener("abort", resolve);
        timeout = setTimeout(() => {
          signal?.removeEventListener("abort", resolve);
          resolve(0);
        }, this.#pollIntervalMs);
        timeouts.add(timeout);
      });
      if (timeout != null) timeouts.delete(timeout);
      await poll();
    }
  }

  [Symbol.dispose](): void {
    clearInterval(this.#loopHandle);
    this.#redis.disconnect();
    this.#subRedis.disconnect();
  }
}
