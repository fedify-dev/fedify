/**
 * The enqueue pipeline for custom background tasks.  `ContextImpl.enqueueTask`
 * and `ContextImpl.enqueueTaskMany` delegate to {@link enqueueTasks} so the
 * handle validation, deduplication planning, payload encoding, and queue
 * dispatch live in one cohesive place instead of one oversized method.
 *
 * @module
 */
import { getLogger } from "@logtape/logtape";
import { context, propagation } from "@opentelemetry/api";
import type { KvKey } from "../kv.ts";
import type { FederationImpl } from "../middleware.ts";
import type { MessageQueue } from "../mq.ts";
import type { TaskMessage } from "../queue.ts";
import type TaskCodec from "./codec.ts";
import type { TaskDefinition, TaskEnqueueOptions } from "./task.ts";

/**
 * The slice of an enqueueing {@link Context} that {@link enqueueTasks} needs:
 * its federation plus the few values that are the context's own.  `ContextImpl`
 * assembles it from itself, so the enqueue pipeline stays out of that class.
 * @template TContextData The context data to pass to the {@link Context}.
 * @internal
 */
interface EnqueueTasksContext<TContextData> {
  /**
   * The federation that owns the task registry, queue resolution and start,
   * the key-value store, and the deduplication configuration.  The public
   * {@link Federation} interface exposes none of these, so the concrete
   * {@link FederationImpl} is required.
   */
  readonly federation: FederationImpl<TContextData>;

  /** The codec, bound to this context's loaders, that encodes payloads. */
  readonly codec: TaskCodec;

  /** The context's origin, stamped onto each message as its `baseUrl`. */
  readonly origin: string;

  /** The context data handed to the queue worker when it auto-starts. */
  readonly data: TContextData;
}

/**
 * Validates the task handle, plans deduplication, encodes every payload, then
 * dispatches the resulting messages to the queue.  A single item flows through
 * the same pipeline as a batch, so {@link Context.enqueueTask} and
 * {@link Context.enqueueTaskMany} share one implementation.
 * @template TContextData The context data to pass to the {@link Context}.
 * @template TData The type of the task payload, inferred from the task's schema.
 * @param ctx The enqueueing dependencies assembled by `ContextImpl`.
 * @param task The handle returned by `defineTask()`.
 * @param items The payloads to enqueue, in order.
 * @param options The enqueue options governing delay, ordering, and dedup.
 * @internal
 */
const enqueueTasks = <TContextData>(
  ctx: EnqueueTasksContext<TContextData>,
) =>
  async function <TData>(
    task: TaskDefinition<TContextData, TData>,
    items: readonly TData[],
    options: TaskEnqueueOptions,
  ): Promise<void> {
    const def = ctx.federation.taskDefinitions.get(task.name);
    if (def == null || def.handle !== task) {
      throw new TypeError(
        `Task ${
          JSON.stringify(task.name)
        } is not defined on this federation; ` +
          "pass a handle returned by its defineTask().",
      );
    }
    const queue = ctx.federation.resolveTaskQueue(task.name);
    if (queue == null) {
      throw new TypeError(
        "No message queue is configured for tasks; pass `queue` to " +
          "createFederation() or to defineTask().",
      );
    }
    if (items.length < 1) return;
    const plan = planDeduplication(
      ctx,
      queue,
      task.name,
      options,
      items.length,
    );
    const messages: TaskMessage[] = await Promise.all(
      items.map(encodeTaskMessage(ctx.codec, ctx.origin, task, options)),
    );
    const claim = await claimDeduplication(ctx, plan, task.name);
    if (!claim.proceed) return;
    if (!ctx.federation.manuallyStartQueue) {
      ctx.federation._startQueueInternal(ctx.data);
    }
    await dispatch(queue, messages, {
      delay: getDurationIfDefined(options.delay),
      orderingKey: options.orderingKey,
      deduplicationKey: claim.forwardedDeduplicationKey,
    });
  };

export default enqueueTasks;

const getDurationIfDefined = (item: Temporal.DurationLike | undefined) =>
  item == null ? undefined : Temporal.Duration.from(item);

/**
 * The deduplication strategy chosen for an enqueue, settled before any payload
 * is encoded so the fail-fast errors surface first.
 */
type DedupPlan =
  | { readonly kind: "none" }
  | { readonly kind: "native"; readonly key: string }
  | { readonly kind: "cas"; readonly key: string }
  | { readonly kind: "open"; readonly key: string };

/**
 * Decides how a `deduplicationKey` (if any) is honored: forwarded to a native
 * queue, claimed via `cas`, or—when neither is available—dropped or rejected
 * per the federation's `taskDeduplicationFallback`.  Throws the fail-fast
 * `TypeError`s so they precede the encode.
 */
function planDeduplication<TContextData>(
  ctx: EnqueueTasksContext<TContextData>,
  queue: MessageQueue,
  taskName: string,
  options: TaskEnqueueOptions,
  itemCount: number,
): DedupPlan {
  if (options.deduplicationKey == null) return { kind: "none" };
  const key = options.deduplicationKey;
  if (queue.nativeDeduplication === true) {
    if (itemCount > 1 && queue.enqueueMany == null) {
      throw new TypeError(
        `Task ${
          JSON.stringify(taskName)
        } was enqueued as a batch with a deduplicationKey, but its ` +
          "message queue declares nativeDeduplication without " +
          "implementing enqueueMany; a per-message key cannot deduplicate " +
          "a whole batch.  Implement enqueueMany on the queue, or enqueue " +
          "the tasks individually with enqueueTask().",
      );
    }
    return { kind: "native", key };
  }
  if (ctx.federation.kv.cas != null) return { kind: "cas", key };
  if (ctx.federation.taskDeduplicationFallback === "closed") {
    // No conditional write, closed: fail fast before any side effect.
    throw new TypeError(
      "deduplicationKey was set but the message queue does not declare " +
        "nativeDeduplication and the key-value store exposes no " +
        'conditional write (cas); set taskDeduplicationFallback to "open" ' +
        "to proceed without deduplication, or use a backend that " +
        "supports it.",
    );
  }
  return { kind: "open", key };
}

/**
 * Executes the planned deduplication once the payloads are encoded.  A native
 * plan forwards its key to the queue; a `cas` plan claims the marker and stops
 * the enqueue when it loses the race; an `open` plan logs and proceeds.
 * @returns Whether to proceed, and the key (if any) to forward to the queue.
 */
async function claimDeduplication<TContextData>(
  ctx: EnqueueTasksContext<TContextData>,
  plan: DedupPlan,
  taskName: string,
): Promise<{ proceed: boolean; forwardedDeduplicationKey?: string }> {
  switch (plan.kind) {
    case "native":
      return { proceed: true, forwardedDeduplicationKey: plan.key };
    case "cas": {
      const cacheKey = [
        ...ctx.federation.kvPrefixes.taskDeduplication,
        plan.key,
      ] satisfies KvKey;
      // planDeduplication only picks "cas" when `ctx.federation.kv.cas` exists.
      const won = await ctx.federation.kv.cas!(cacheKey, undefined, true, {
        ttl: ctx.federation.taskDeduplicationTtl,
      });
      return { proceed: won };
    }
    case "open": {
      getLogger(["fedify", "federation", "task"]).debug(
        "deduplicationKey {deduplicationKey} for task {taskName} ignored: " +
          "the message queue declares no nativeDeduplication and the " +
          "key-value store has no cas; proceeding (taskDeduplicationFallback " +
          'is "open").',
        { deduplicationKey: plan.key, taskName },
      );
    }
  }
  return { proceed: true };
}

/**
 * Sends the encoded messages to the queue, picking the bulk path when the
 * queue implements `enqueueMany` and otherwise fanning out parallel single
 * enqueues.  The fan-out drops `deduplicationKey`, which is only ever set for a
 * native plan that the bulk paths already cover.
 */
async function dispatch(
  queue: MessageQueue,
  messages: readonly TaskMessage[],
  options: {
    delay?: Temporal.Duration;
    orderingKey?: string;
    deduplicationKey?: string;
  },
): Promise<void> {
  if (messages.length === 1) {
    await queue.enqueue(messages[0], options);
  } else if (queue.enqueueMany != null) {
    await queue.enqueueMany(messages, options);
  } else {
    const fanoutOptions = {
      delay: options.delay,
      orderingKey: options.orderingKey,
    };
    await Promise.all(messages.map((m) => queue.enqueue(m, fanoutOptions)));
  }
}

/**
 * Builds the per-payload encoder: validates and serializes the payload, then
 * stamps the message envelope with a fresh id, the context's origin, and the
 * active trace context.  Curried so the batch encode reuses one bound encoder.
 */
const encodeTaskMessage = <TContextData, TData>(
  codec: TaskCodec,
  origin: string,
  task: TaskDefinition<TContextData, TData>,
  options: TaskEnqueueOptions,
) =>
async (data: TData): Promise<TaskMessage> => {
  const encoded = await codec.encode(task.schema, data);
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return {
    type: "task",
    id: crypto.randomUUID(),
    baseUrl: origin,
    taskName: task.name,
    data: encoded,
    started: Temporal.Now.instant().toString(),
    attempt: 0,
    orderingKey: options.orderingKey,
    traceContext: carrier,
  };
};
