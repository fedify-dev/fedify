// deno-lint-ignore-file no-explicit-any

/**
 * Additional options for enqueuing a message in a queue.
 *
 * @since 0.5.0
 */
export interface MessageQueueEnqueueOptions {
  /**
   * The delay before the message is enqueued.  No delay by default.
   *
   * It must not be negative.
   */
  readonly delay?: Temporal.Duration;

  /**
   * An optional key that ensures messages with the same ordering key are
   * processed sequentially (one at a time).  Messages with different ordering
   * keys (or no ordering key) may be processed in parallel.
   *
   * This is useful for ensuring that related messages are processed in order,
   * such as ensuring that a `Delete` activity is processed after a `Create`
   * activity for the same object.
   *
   * @since 2.0.0
   */
  readonly orderingKey?: string;
}

/**
 * Additional options for listening to a message queue.
 *
 * @since 1.0.0
 */
export interface MessageQueueListenOptions {
  /**
   * The signal to abort listening to the message queue.
   */
  signal?: AbortSignal;
}

/**
 * An abstract interface for a message queue.
 *
 * @since 0.5.0
 */
export interface MessageQueue {
  /**
   * Whether the message queue backend provides native retry mechanisms.
   * When `true`, Fedify will skip its own retry logic and rely on the backend
   * to handle retries. When `false` or omitted, Fedify will handle retries
   * using its own retry policies.
   *
   * @default `false`
   * @since 1.7.0
   */
  readonly nativeRetrial?: boolean;

  /**
   * Enqueues a message in the queue.
   * @param message The message to enqueue.
   * @param options Additional options for enqueuing the message.
   */
  enqueue(message: any, options?: MessageQueueEnqueueOptions): Promise<void>;

  /**
   * Enqueues multiple messages in the queue.  This operation is optional,
   * and may not be supported by all implementations.  If not supported,
   * Fedify will invoke {@link enqueue} for each message.
   *
   * @param messages The messages to enqueue.
   * @param options Additional options for enqueuing the messages.
   */
  enqueueMany?: (
    messages: readonly any[],
    options?: MessageQueueEnqueueOptions,
  ) => Promise<void>;

  /**
   * Listens for messages in the queue.
   * @param handler The handler for messages in the queue.
   * @param options Additional options for listening to the message queue.
   * @returns A promise that resolves when the listening is done.  It never
   *          rejects, and is resolved when the signal is aborted.  If no
   *          signal is provided, it never resolves.
   */
  listen(
    handler: (message: any) => Promise<void> | void,
    options?: MessageQueueListenOptions,
  ): Promise<void>;
}

/**
 * Additional options for {@link InProcessMessageQueue}.
 * @since 1.0.0
 */
export interface InProcessMessageQueueOptions {
  /**
   * The interval to poll for messages in the queue.  5 seconds by default.
   * @default `{ seconds: 5 }`
   */
  pollInterval?: Temporal.Duration | Temporal.DurationLike;
}

/**
 * Internal structure for storing messages with their ordering key.
 */
interface QueuedMessage {
  message: any;
  orderingKey: string | null;
}

/**
 * A message queue that processes messages in the same process.
 * Do not use this in production as it does neither persist messages nor
 * distribute them across multiple processes.
 *
 * @since 0.5.0
 */
export class InProcessMessageQueue implements MessageQueue {
  #messages: QueuedMessage[];
  #monitors: Record<ReturnType<typeof crypto.randomUUID>, () => void>;
  #pollIntervalMs: number;
  /**
   * Tracks which ordering keys are currently being processed to ensure
   * sequential processing for messages with the same key.
   */
  #processingKeys: Set<string>;

  /**
   * In-process message queue does not provide native retry mechanisms.
   * @since 1.7.0
   */
  readonly nativeRetrial = false;

  /**
   * Constructs a new {@link InProcessMessageQueue} with the given options.
   * @param options Additional options for the in-process message queue.
   */
  constructor(options: InProcessMessageQueueOptions = {}) {
    this.#messages = [];
    this.#monitors = {};
    this.#pollIntervalMs = Temporal.Duration.from(
      options.pollInterval ?? { seconds: 5 },
    ).total("millisecond");
    this.#processingKeys = new Set();
  }

  enqueue(message: any, options?: MessageQueueEnqueueOptions): Promise<void> {
    const delay = options?.delay == null
      ? 0
      : Math.max(options.delay.total("millisecond"), 0);
    if (delay > 0) {
      setTimeout(
        () => this.enqueue(message, { ...options, delay: undefined }),
        delay,
      );
      return Promise.resolve();
    }
    const orderingKey = options?.orderingKey ?? null;
    this.#messages.push({ message, orderingKey });
    for (const monitorId in this.#monitors) {
      this.#monitors[monitorId as ReturnType<typeof crypto.randomUUID>]();
    }
    return Promise.resolve();
  }

  enqueueMany(
    messages: readonly any[],
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    if (messages.length === 0) return Promise.resolve();
    const delay = options?.delay == null
      ? 0
      : Math.max(options.delay.total("millisecond"), 0);
    if (delay > 0) {
      setTimeout(
        () => this.enqueueMany(messages, { ...options, delay: undefined }),
        delay,
      );
      return Promise.resolve();
    }
    const orderingKey = options?.orderingKey ?? null;
    for (const message of messages) {
      this.#messages.push({ message, orderingKey });
    }
    for (const monitorId in this.#monitors) {
      this.#monitors[monitorId as ReturnType<typeof crypto.randomUUID>]();
    }
    return Promise.resolve();
  }

  async listen(
    handler: (message: any) => Promise<void> | void,
    options: MessageQueueListenOptions = {},
  ): Promise<void> {
    const signal = options.signal;
    while (signal == null || !signal.aborted) {
      // Find a message that can be processed (either no ordering key, or
      // its ordering key is not currently being processed)
      const idx = this.#messages.findIndex((m) =>
        m.orderingKey == null || !this.#processingKeys.has(m.orderingKey)
      );
      if (idx >= 0) {
        const queued = this.#messages.splice(idx, 1)[0];
        const { message, orderingKey } = queued;
        // Mark the ordering key as being processed
        if (orderingKey != null) {
          this.#processingKeys.add(orderingKey);
        }
        try {
          await handler(message);
        } finally {
          // Release the ordering key
          if (orderingKey != null) {
            this.#processingKeys.delete(orderingKey);
          }
        }
      } else if (this.#messages.length === 0) {
        // No messages at all, wait for new ones
        await this.#wait(this.#pollIntervalMs, signal);
      } else {
        // Messages exist but all their ordering keys are being processed
        // Wait a bit before checking again
        await this.#wait(10, signal);
      }
    }
  }

  #wait(ms: number, signal?: AbortSignal): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return Promise.any([
      new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => {
          if (timer != null) clearTimeout(timer);
          resolve();
        }, { once: true });
        const monitorId = crypto.randomUUID();
        this.#monitors[monitorId] = () => {
          delete this.#monitors[monitorId];
          if (timer != null) clearTimeout(timer);
          resolve();
        };
      }),
      new Promise<void>((resolve) => timer = setTimeout(resolve, ms)),
    ]);
  }
}

type Uuid = ReturnType<typeof crypto.randomUUID>;

/**
 * A message queue that processes messages in parallel.  It takes another
 * {@link MessageQueue}, and processes messages in parallel up to a certain
 * number of workers.
 *
 * Actually, it's rather a decorator than a queue itself.
 *
 * Note that the workers do not run in truly parallel, in the sense that they
 * are not running in separate threads or processes.  They are running in the
 * same process, but are scheduled to run in parallel.  Hence, this is useful
 * for I/O-bound tasks, but not for CPU-bound tasks, which is okay for Fedify's
 * workloads.
 *
 * @since 1.0.0
 */
export class ParallelMessageQueue implements MessageQueue {
  readonly queue: MessageQueue;
  readonly workers: number;

  /**
   * Inherits the native retry capability from the wrapped queue.
   * @since 1.7.0
   */
  readonly nativeRetrial?: boolean;

  /**
   * Constructs a new {@link ParallelMessageQueue} with the given queue and
   * number of workers.
   * @param queue The message queue to use under the hood.  Note that
   *              {@link ParallelMessageQueue} cannot be nested.
   * @param workers The number of workers to process messages in parallel.
   * @throws {TypeError} If the given queue is an instance of
   *                     {@link ParallelMessageQueue}.
   */
  constructor(queue: MessageQueue, workers: number) {
    if (queue instanceof ParallelMessageQueue) {
      throw new TypeError("Cannot nest ParallelMessageQueue.");
    }
    this.queue = queue;
    this.workers = workers;
    this.nativeRetrial = queue.nativeRetrial;
  }

  enqueue(message: any, options?: MessageQueueEnqueueOptions): Promise<void> {
    return this.queue.enqueue(message, options);
  }

  async enqueueMany(
    messages: readonly any[],
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    if (this.queue.enqueueMany == null) {
      const results = await Promise.allSettled(
        messages.map((message) => this.queue.enqueue(message, options)),
      );
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => r.reason);
      if (errors.length > 1) {
        throw new AggregateError(errors, "Failed to enqueue messages.");
      } else if (errors.length === 1) throw errors[0];
      return;
    }
    await this.queue.enqueueMany(messages, options);
  }

  listen(
    handler: (message: any) => Promise<void> | void,
    options: MessageQueueListenOptions = {},
  ): Promise<void> {
    const workers = new Map<Uuid, Promise<Uuid>>();
    return this.queue.listen(async (message) => {
      while (workers.size >= this.workers) {
        const consumedId = await Promise.any(workers.values());
        workers.delete(consumedId);
      }
      const workerId = crypto.randomUUID();
      const promise = this.#work(workerId, handler, message);
      workers.set(workerId, promise);
    }, options);
  }

  async #work(
    workerId: Uuid,
    handler: (message: any) => Promise<void> | void,
    message: any,
  ): Promise<Uuid> {
    await this.#sleep(0);
    await handler(message);
    return workerId;
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
