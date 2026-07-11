import type { Federation, Message } from "@fedify/fedify/federation";
import {
  type AsyncWorkloadEvent,
  asyncWorkloadFn,
  type CustomAsyncWorkloadEvent,
  ErrorDoNotRetry,
} from "@netlify/async-workloads";
import {
  completeOrderingSequence,
  getCompletedOrderingSequence,
  getOrderingOptions,
  type NetlifyMessageQueue,
  type NetlifyQueueEventData,
} from "./mq.ts";

/**
 * The Async Workloads event emitted by {@link NetlifyMessageQueue}.
 *
 * @since 2.4.0
 */
export interface NetlifyQueueEvent extends CustomAsyncWorkloadEvent {
  readonly eventName: string;
  readonly eventData: NetlifyQueueEventData;
}

/**
 * Options for {@link createNetlifyQueueHandler}.
 *
 * @typeParam TContextData The context data passed to Fedify dispatchers.
 * @since 2.4.0
 */
export interface NetlifyQueueHandlerOptions<TContextData> {
  /** The queue that receives events for this handler. */
  readonly queue: NetlifyMessageQueue;

  /**
   * Creates the federation for a workload invocation.  The factory is called
   * once per event so resources do not have to survive between invocations.
   */
  readonly federation: (
    event: AsyncWorkloadEvent<NetlifyQueueEvent>,
  ) => Federation<TContextData> | Promise<Federation<TContextData>>;

  /**
   * Creates the context data passed to `Federation.processQueuedTask()`.
   * When omitted, `undefined` is used.
   */
  readonly contextData?: (
    event: AsyncWorkloadEvent<NetlifyQueueEvent>,
  ) => TContextData | Promise<TContextData>;

  /**
   * The workload's configured retry count.  This must equal
   * `asyncWorkloadConfig.maxRetries` so a permanently failed ordered event can
   * release its sequence.  Four by default, matching Async Workloads.
   * @default 4
   */
  readonly maxRetries?: number;
}

type EventHandler = (
  event: AsyncWorkloadEvent<NetlifyQueueEvent>,
) => Promise<void>;
type WorkloadFunction = ReturnType<typeof asyncWorkloadFn<NetlifyQueueEvent>>;
type WorkloadWrapper = (handler: EventHandler) => WorkloadFunction;

const messageTypes = new Set(["fanout", "inbox", "outbox", "task"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

type OrderingMetadata = Pick<
  NetlifyQueueEventData,
  "orderingKey" | "orderingSequence"
>;

function decodeOrderingMetadata(value: unknown): OrderingMetadata {
  if (!isObject(value)) {
    throw new ErrorDoNotRetry("Invalid Fedify queue event envelope.");
  }
  if (
    value.orderingKey !== undefined &&
    (typeof value.orderingKey !== "string" || value.orderingKey.length < 1)
  ) {
    throw new ErrorDoNotRetry("Invalid Fedify queue ordering key.");
  }
  const orderingSequence = value.orderingSequence;
  if (
    orderingSequence !== undefined &&
    (typeof orderingSequence !== "number" ||
      !Number.isSafeInteger(orderingSequence) || orderingSequence < 1)
  ) {
    throw new ErrorDoNotRetry("Invalid Fedify queue ordering sequence.");
  }
  if (
    (value.orderingKey === undefined) !==
      (orderingSequence === undefined)
  ) {
    throw new ErrorDoNotRetry("Incomplete Fedify queue ordering metadata.");
  }
  return { orderingKey: value.orderingKey, orderingSequence };
}

function decodeEventData(
  value: unknown,
  ordering: OrderingMetadata,
): NetlifyQueueEventData {
  if (!isObject(value) || !isObject(value.message)) {
    throw new ErrorDoNotRetry("Invalid Fedify queue event envelope.");
  }
  if (
    typeof value.message.type !== "string" ||
    !messageTypes.has(value.message.type)
  ) {
    throw new ErrorDoNotRetry("Invalid Fedify queue message type.");
  }
  return {
    message: value.message as unknown as Message,
    ...ordering,
  };
}

/**
 * Creates the event callback that processes one Netlify queue event.
 * @internal
 */
export function createNetlifyQueueEventHandler<TContextData>(
  options: NetlifyQueueHandlerOptions<TContextData>,
): EventHandler {
  const maxRetries = options.maxRetries ?? 4;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError("maxRetries must be a non-negative safe integer.");
  }
  return async (event) => {
    const orderingMetadata = decodeOrderingMetadata(event.eventData);
    let data: NetlifyQueueEventData;
    try {
      data = decodeEventData(event.eventData, orderingMetadata);
    } catch (error) {
      if (
        error instanceof ErrorDoNotRetry &&
        orderingMetadata.orderingKey != null &&
        orderingMetadata.orderingSequence != null
      ) {
        await options.queue.skipOrderingSequence(
          orderingMetadata.orderingKey,
          orderingMetadata.orderingSequence,
        );
      }
      throw error;
    }
    const ordering = getOrderingOptions(options.queue);
    if (data.orderingKey != null && data.orderingSequence != null) {
      let wait = 0;
      while (true) {
        const completed = await getCompletedOrderingSequence(
          options.queue,
          data.orderingKey,
        );
        if (completed >= data.orderingSequence) return;
        if (completed === data.orderingSequence - 1) break;
        await event.step.sleep(
          `fedify-ordering-wait-${wait++}`,
          ordering.retryDelay.total("milliseconds"),
        );
      }
    }

    try {
      const federation = await options.federation(event);
      const contextData = options.contextData == null
        ? undefined as TContextData
        : await options.contextData(event);
      await federation.processQueuedTask(contextData, data.message);
    } catch (error) {
      if (
        data.orderingKey != null && data.orderingSequence != null &&
        // Async Workloads numbers the initial invocation 0, so maxRetries is
        // also the number of the final invocation.
        (error instanceof ErrorDoNotRetry || event.attempt >= maxRetries)
      ) {
        // Do not hide a failed skip.  In particular, replacing
        // ErrorDoNotRetry with a state error lets Netlify retry the cleanup
        // instead of dead-lettering an event that still blocks its successors.
        await options.queue.skipOrderingSequence(
          data.orderingKey,
          data.orderingSequence,
        );
      }
      throw error;
    }
    if (data.orderingKey != null && data.orderingSequence != null) {
      await completeOrderingSequence(
        options.queue,
        data.orderingKey,
        data.orderingSequence,
      );
    }
  };
}

/**
 * Wraps a queue event callback.  This is exposed for cross-runtime tests; use
 * {@link createNetlifyQueueHandler} in applications.
 * @internal
 */
export function createNetlifyQueueHandlerWith<TContextData>(
  wrapper: WorkloadWrapper,
  options: NetlifyQueueHandlerOptions<TContextData>,
): WorkloadFunction {
  return wrapper(createNetlifyQueueEventHandler(options));
}

/**
 * Creates a Netlify Async Workloads function that processes Fedify jobs.
 *
 * Export the returned function as the default export of a file under
 * *netlify/functions/*.  The workload's `asyncWorkloadConfig.events` must
 * contain the associated queue's {@link NetlifyMessageQueue.eventName}.
 *
 * @typeParam TContextData The context data passed to Fedify dispatchers.
 * @param options The workload handler options.
 * @returns A function produced by Netlify's `asyncWorkloadFn()`.
 * @since 2.4.0
 */
export function createNetlifyQueueHandler<TContextData>(
  options: NetlifyQueueHandlerOptions<TContextData>,
): WorkloadFunction {
  return createNetlifyQueueHandlerWith(
    asyncWorkloadFn<NetlifyQueueEvent>,
    options,
  );
}
