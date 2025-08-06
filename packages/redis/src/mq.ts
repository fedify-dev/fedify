// deno-lint-ignore-file no-explicit-any
import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import type { Redis, RedisKey } from "ioredis";
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
  workerId?: string;

  /**
   * The Pub/Sub channel key to use for the message queue.  `"fedify_channel"`
   * by default.
   * @default `"fedify_channel"`
   */
  channelKey?: RedisKey;

  /**
   * The Sorted Set key to use for the delayed message queue.  `"fedify_queue"`
   * by default.
   * @default `"fedify_queue"`
   */
  queueKey?: RedisKey;

  /**
   * The key to use for locking the message queue.  `"fedify_lock"` by default.
   * @default `"fedify_lock"`
   */
  lockKey?: RedisKey;

  /**
   * The codec to use for encoding and decoding messages in the key–value store.
   * Defaults to {@link JsonCodec}.
   * @default {@link JsonCodec}
   */
  codec?: Codec;

  /**
   * The poll interval for the message queue.  5 seconds by default.
   * @default `{ seconds: 5 }`
   */
  pollInterval?: Temporal.Duration | Temporal.DurationLike;
}

/**
 * A message queue that uses Redis as the underlying storage.
 *
 * @example
 * ```ts ignore
 * import { createFederation } from "@fedify/fedify";
 * import { RedisMessageQueue } from "@fedify/redis";
 * import { Redis } from "ioredis";
 *
 * const federation = createFederation({
 *   // ...
 *   queue: new RedisMessageQueue(() => new Redis()),
 * });
 * ```
 */
export class RedisMessageQueue implements MessageQueue, Disposable {
  #redis: Redis;
  #subRedis: Redis;
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
  constructor(redis: () => Redis, options: RedisMessageQueueOptions = {}) {
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
    messages: any[],
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
    const promise = this.#subRedis.subscribe(this.#channelKey, () => {
      this.#subRedis.on("message", poll);
      signal?.addEventListener("abort", () => {
        this.#subRedis.off("message", poll);
      });
    });
    signal?.addEventListener(
      "abort",
      () => {
        for (const timeout of timeouts) clearTimeout(timeout);
      },
    );
    const timeouts = new Set<ReturnType<typeof setTimeout>>();
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
    return await new Promise((resolve) => {
      signal?.addEventListener("abort", () => {
        promise.catch(() => resolve()).then(() => resolve());
      });
      promise.catch(() => resolve()).then(() => resolve());
    });
  }

  [Symbol.dispose](): void {
    clearInterval(this.#loopHandle);
    this.#redis.disconnect();
    this.#subRedis.disconnect();
  }
}
