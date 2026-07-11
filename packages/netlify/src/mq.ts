import type {
  KvStore,
  Message,
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "@fedify/fedify/federation";
import type { NetlifyAsyncWorkloadsClient } from "./types.ts";

const defaultEventName = "fedify:queue";
const defaultOrderingRetryDelay = Temporal.Duration.from({ seconds: 5 });

/**
 * A Fedify queue message wrapped for Netlify Async Workloads.
 *
 * @since 2.4.0
 */
export interface NetlifyQueueEventData {
  readonly message: Message;
  readonly orderingKey?: string;
  readonly orderingSequence?: number;
}

/**
 * Options for {@link NetlifyMessageQueue}.
 *
 * @since 2.4.0
 */
export interface NetlifyMessageQueueOptions {
  /** A Netlify Async Workloads client. */
  readonly client: NetlifyAsyncWorkloadsClient;

  /**
   * The Async Workloads event name.  It must match the event configured for
   * the workload function.  `"fedify:queue"` by default.
   * @default `"fedify:queue"`
   */
  readonly eventName?: string;

  /**
   * A CAS-capable key–value store used to serialize messages that have the
   * same ordering key.  Required when an `orderingKey` is enqueued.
   */
  readonly orderingKv?: KvStore;

  /**
   * The durable sleep interval used while an earlier ordered message is still
   * running.  Five seconds by default.
   * @default `{ seconds: 5 }`
   */
  readonly orderingRetryDelay?: Temporal.Duration | Temporal.DurationLike;
}

/**
 * An error raised when an event send is not acknowledged.
 *
 * For an ordered event, {@link orderingSequence} remains reserved because the
 * router may already have accepted the event.  It can be passed to
 * {@link NetlifyMessageQueue.skipOrderingSequence} only after an operator has
 * confirmed that the event cannot still be delivered.
 *
 * @since 2.4.0
 */
export class NetlifyMessageQueueSendError extends Error {
  readonly eventName: string;
  readonly eventId?: string;
  readonly orderingKey?: string;
  readonly orderingSequence?: number;

  /** Creates a queue send error. @internal */
  constructor(options: {
    readonly eventName: string;
    readonly eventId?: string;
    readonly orderingKey?: string;
    readonly orderingSequence?: number;
    readonly cause?: unknown;
  }) {
    const ordering = options.orderingKey == null ||
        options.orderingSequence == null
      ? ""
      : `; ordering key ${options.orderingKey}, sequence ` +
        options.orderingSequence;
    super(
      `Failed to send Netlify Async Workloads event ${
        options.eventId ?? "without an acknowledgement"
      } for ${options.eventName}${ordering}.`,
      { cause: options.cause },
    );
    this.name = "NetlifyMessageQueueSendError";
    this.eventName = options.eventName;
    this.eventId = options.eventId;
    this.orderingKey = options.orderingKey;
    this.orderingSequence = options.orderingSequence;
  }
}

interface OrderingOptions {
  readonly kv?: KvStore;
  readonly retryDelay: Temporal.Duration;
}

interface OrderingState {
  readonly nextSequence: number;
  readonly completedSequence: number;
  readonly cancelledSequences: readonly number[];
}

const orderingOptions = new WeakMap<NetlifyMessageQueue, OrderingOptions>();

function duration(
  value: Temporal.Duration | Temporal.DurationLike | undefined,
  defaultValue: Temporal.Duration,
  name: string,
): Temporal.Duration {
  const result = value == null ? defaultValue : Temporal.Duration.from(value);
  const milliseconds = result.total("milliseconds");
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new RangeError(`${name} must be a positive finite duration.`);
  }
  return result;
}

function requireCas(
  kv: KvStore | undefined,
): KvStore & Required<Pick<KvStore, "cas">> {
  if (kv == null || kv.cas == null) {
    throw new TypeError(
      "Messages with an orderingKey require orderingKv with a cas() method.",
    );
  }
  return kv as KvStore & Required<Pick<KvStore, "cas">>;
}

/**
 * Gets the queue's ordering configuration for the workload handler.
 * @internal
 */
export function getOrderingOptions(
  queue: NetlifyMessageQueue,
): OrderingOptions {
  const options = orderingOptions.get(queue);
  if (options == null) throw new TypeError("Invalid NetlifyMessageQueue.");
  return options;
}

/**
 * Ensures that a queue can accept the supplied ordering key.
 * @internal
 */
export function getOrderingKv(
  queue: NetlifyMessageQueue,
  orderingKey: string,
): KvStore & Required<Pick<KvStore, "cas">> {
  if (orderingKey.length < 1) {
    throw new TypeError("orderingKey must not be empty.");
  }
  return requireCas(getOrderingOptions(queue).kv);
}

function getOrderingStateKey(
  orderingKey: string,
): readonly [string, string, string, string] {
  return ["fedify", "netlify", "ordering", orderingKey];
}

function compactOrderingState(state: OrderingState): OrderingState {
  const cancelled = new Set(state.cancelledSequences);
  let completedSequence = state.completedSequence;
  while (cancelled.delete(completedSequence + 1)) completedSequence++;
  return {
    nextSequence: state.nextSequence,
    completedSequence,
    cancelledSequences: [...cancelled].sort((a, b) => a - b),
  };
}

function validateOrderingState(value: unknown): OrderingState {
  if (value === undefined) {
    return {
      nextSequence: 1,
      completedSequence: 0,
      cancelledSequences: [],
    };
  }
  if (typeof value !== "object" || value == null) {
    throw new TypeError("Invalid Netlify queue ordering state.");
  }
  const nextSequence = "nextSequence" in value ? value.nextSequence : undefined;
  const completedSequence = "completedSequence" in value
    ? value.completedSequence
    : undefined;
  const cancelledSequences = "cancelledSequences" in value
    ? value.cancelledSequences
    : undefined;
  if (
    typeof nextSequence !== "number" ||
    !Number.isSafeInteger(nextSequence) || nextSequence < 1 ||
    typeof completedSequence !== "number" ||
    !Number.isSafeInteger(completedSequence) || completedSequence < 0 ||
    !Array.isArray(cancelledSequences) ||
    !cancelledSequences.every((sequence) =>
      Number.isSafeInteger(sequence) && sequence > 0
    )
  ) {
    throw new TypeError("Invalid Netlify queue ordering state.");
  }
  return { nextSequence, completedSequence, cancelledSequences };
}

async function updateOrderingState<T>(
  queue: NetlifyMessageQueue,
  orderingKey: string,
  update: (state: OrderingState) => readonly [OrderingState, T],
): Promise<T> {
  const kv = getOrderingKv(queue, orderingKey);
  const key = getOrderingStateKey(orderingKey);
  while (true) {
    const stored = await kv.get(key);
    const state = validateOrderingState(stored);
    const [updated, result] = update(state);
    if (await kv.cas(key, stored, updated)) return result;
  }
}

async function reserveOrderingSequence(
  queue: NetlifyMessageQueue,
  orderingKey: string,
): Promise<number> {
  return await updateOrderingState(queue, orderingKey, (state) => [{
    ...state,
    nextSequence: state.nextSequence + 1,
  }, state.nextSequence]);
}

async function cancelOrderingSequence(
  queue: NetlifyMessageQueue,
  orderingKey: string,
  sequence: number,
): Promise<void> {
  await updateOrderingState(queue, orderingKey, (state) => {
    if (sequence >= state.nextSequence) {
      throw new RangeError(
        `Netlify queue ordering sequence ${sequence} has not been reserved.`,
      );
    }
    if (sequence <= state.completedSequence) return [state, undefined];
    return [
      compactOrderingState({
        ...state,
        cancelledSequences: [...state.cancelledSequences, sequence],
      }),
      undefined,
    ];
  });
}

/** Gets the last completed sequence for an ordering key. @internal */
export async function getCompletedOrderingSequence(
  queue: NetlifyMessageQueue,
  orderingKey: string,
): Promise<number> {
  const kv = getOrderingKv(queue, orderingKey);
  const state = validateOrderingState(
    await kv.get(getOrderingStateKey(orderingKey)),
  );
  return state.completedSequence;
}

/** Marks an ordered message as completed. @internal */
export async function completeOrderingSequence(
  queue: NetlifyMessageQueue,
  orderingKey: string,
  sequence: number,
): Promise<void> {
  await updateOrderingState(queue, orderingKey, (state) => {
    if (state.completedSequence >= sequence) return [state, undefined];
    if (state.completedSequence !== sequence - 1) {
      throw new Error(
        `Cannot complete Netlify queue ordering sequence ${sequence} after ` +
          `${state.completedSequence}.`,
      );
    }
    return [
      compactOrderingState({
        ...state,
        completedSequence: sequence,
      }),
      undefined,
    ];
  });
}

/**
 * A message queue that publishes Fedify jobs to Netlify Async Workloads.
 *
 * Async Workloads invokes a separate function for each event, so this queue
 * cannot consume messages through {@link listen}.  Use
 * {@link createNetlifyQueueHandler} in a Netlify Function and set Fedify's
 * `manuallyStartQueue` option to `true`.
 *
 * @since 2.4.0
 */
export class NetlifyMessageQueue implements MessageQueue {
  readonly eventName: string;
  readonly nativeRetrial = true;
  readonly nativeDeduplication = false;
  readonly atomicEnqueueMany = false;

  readonly #client: NetlifyAsyncWorkloadsClient;

  /** Creates a Netlify Async Workloads-backed message queue. */
  constructor(options: NetlifyMessageQueueOptions) {
    const eventName = options.eventName ?? defaultEventName;
    if (eventName.trim().length < 1) {
      throw new TypeError("eventName must not be empty.");
    }
    this.eventName = eventName;
    this.#client = options.client;
    orderingOptions.set(this, {
      kv: options.orderingKv,
      retryDelay: duration(
        options.orderingRetryDelay,
        defaultOrderingRetryDelay,
        "orderingRetryDelay",
      ),
    });
  }

  /** {@inheritDoc MessageQueue.enqueue} */
  async enqueue(
    message: Message,
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    const delay = options?.delay?.total("milliseconds");
    if (delay != null && (!Number.isFinite(delay) || delay < 0)) {
      throw new RangeError("delay must be a non-negative finite duration.");
    }
    const orderingKey = options?.orderingKey;
    const orderingSequence = orderingKey == null
      ? undefined
      : await reserveOrderingSequence(this, orderingKey);
    let result;
    try {
      result = await this.#client.send(this.eventName, {
        data: { message, orderingKey, orderingSequence },
        ...(delay == null ? {} : { delayUntil: Date.now() + delay }),
      });
    } catch (cause) {
      throw new NetlifyMessageQueueSendError({
        eventName: this.eventName,
        orderingKey,
        orderingSequence,
        cause,
      });
    }
    if (result.sendStatus !== "succeeded") {
      throw new NetlifyMessageQueueSendError({
        eventName: this.eventName,
        eventId: result.eventId,
        orderingKey,
        orderingSequence,
      });
    }
  }

  /**
   * Skips a reserved ordering sequence that can no longer be processed.
   *
   * Use this only after confirming that the corresponding Async Workloads
   * event is permanently dead-lettered or was never accepted.  Skipping an
   * event that can still be delivered causes that event to be ignored.
   *
   * @param orderingKey The ordering key of the blocked sequence.
   * @param sequence The sequence to skip.
   */
  async skipOrderingSequence(
    orderingKey: string,
    sequence: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new RangeError("sequence must be a positive safe integer.");
    }
    await cancelOrderingSequence(this, orderingKey, sequence);
  }

  /** {@inheritDoc MessageQueue.enqueueMany} */
  async enqueueMany(
    messages: readonly Message[],
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    if (options?.orderingKey == null) {
      await Promise.all(
        messages.map((message) => this.enqueue(message, options)),
      );
    } else {
      for (const message of messages) await this.enqueue(message, options);
    }
  }

  /**
   * This operation is unsupported because Netlify invokes workload functions
   * for queued events.
   */
  listen(
    _handler: (message: Message) => Promise<void> | void,
    _options?: MessageQueueListenOptions,
  ): Promise<void> {
    throw new TypeError(
      "NetlifyMessageQueue.listen() is unsupported; use " +
        "createNetlifyQueueHandler() and set manuallyStartQueue to true.",
    );
  }
}
