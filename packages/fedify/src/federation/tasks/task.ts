import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Context } from "../context.ts";
import type { MessageQueue } from "../mq.ts";
import type { RetryPolicy } from "../retry.ts";

/**
 * A callback that processes a custom background task.
 * @template TContextData The context data to pass to the {@link Context}.
 * @template TData The type of the task payload, inferred from the task's
 *                 schema.
 * @param ctx The context for the worker processing the task.
 * @param data The decoded and validated task payload.
 * @since 2.x.x
 */
export type TaskHandler<TContextData, TData> = (
  ctx: Context<TContextData>,
  data: TData,
) => Promise<void> | void;

/**
 * Options for {@link TaskRegistry.defineTask}.
 * @template TContextData The context data to pass to the {@link Context}.
 * @template TSchema The [Standard Schema](https://standardschema.dev/) that
 *                   validates the task payload.
 * @since 2.x.x
 */
export interface TaskDefinitionOptions<
  TContextData,
  TSchema extends StandardSchemaV1,
> {
  /**
   * The [Standard Schema](https://standardschema.dev/) that validates the
   * task payload.  The payload type is inferred from this schema.
   *
   * The payload is validated twice: once at enqueue time (fail fast) and
   * once at dequeue time (drift protection against payloads enqueued by an
   * older deployment).  Because the same schema runs on both sides, its
   * validation must be idempotent: the validated output must itself be
   * a valid input.  Transforming schemas (e.g., Zod's `.transform()`) whose
   * output differs in shape from their input are not supported.
   */
  readonly schema: TSchema;

  /**
   * The callback that processes the task on a background worker.
   */
  readonly handler: TaskHandler<
    TContextData,
    StandardSchemaV1.InferOutput<TSchema>
  >;

  /**
   * The retry policy for this task.  If omitted, the federation-wide
   * task retry policy is used, which defaults to an exponential backoff
   * policy.
   */
  readonly retryPolicy?: RetryPolicy;

  /**
   * A callback invoked when the {@link handler} throws an error, before
   * a retry is scheduled.
   * @param ctx The context for the worker processing the task.
   * @param error The error thrown by the handler.
   * @param data The decoded and validated task payload.
   */
  readonly onError?: (
    ctx: Context<TContextData>,
    error: unknown,
    data: StandardSchemaV1.InferOutput<TSchema>,
  ) => Promise<void> | void;

  /**
   * The message queue dedicated to this task.  If omitted, the task is
   * routed to the federation-wide task queue, falling back to the outbox
   * queue (unless `taskQueueResolution: "strict"` is configured).
   */
  readonly queue?: MessageQueue;
}

/**
 * Phantom key binding a {@link TaskDefinition} to its federation's context
 * data type.  Declared only—no value exists at runtime, and the symbol is
 * not exported, so the marker stays out of user-facing completions.
 */
declare const contextDataBrand: unique symbol;

/**
 * The handle returned by {@link TaskRegistry.defineTask}.  It carries the
 * task name and schema so that {@link Context.enqueueTask} can validate the
 * payload and infer its type at every call site.
 * @template TContextData The context data to pass to the {@link Context}.
 * @template TData The type of the task payload, inferred from the task's
 *                 schema.
 * @since 2.x.x
 */
export interface TaskDefinition<TContextData, TData> {
  /**
   * The unique name of the task.
   */
  readonly name: string;

  /**
   * The [Standard Schema](https://standardschema.dev/) that validates the
   * task payload.
   */
  readonly schema: StandardSchemaV1<unknown, TData>;

  /**
   * @internal Phantom marker binding the handle to its federation.
   */
  readonly [contextDataBrand]?: TContextData;
}

/**
 * Registration of custom background tasks.  Both {@link Federation} and
 * {@link FederationBuilder} implement this interface.
 * @template TContextData The context data to pass to the {@link Context}.
 * @since 2.x.x
 */
export interface TaskRegistry<TContextData> {
  /**
   * Defines a custom background task.  The returned handle is passed to
   * {@link Context.enqueueTask} to enqueue the task.
   *
   * @example
   * ``` typescript
   * const sendDigest = federation.defineTask("sendDigest", {
   *   schema: digestSchema,
   *   handler: async (ctx, data) => {
   *     // …process the payload on a background worker…
   *   },
   * });
   * ```
   *
   * @param name The unique name of the task.
   * @param options The task definition options.  The payload type is
   *                inferred from `options.schema`.
   * @returns The handle to pass to {@link Context.enqueueTask}.
   * @throws {TypeError} If a task with the same name is already defined.
   */
  defineTask<TSchema extends StandardSchemaV1>(
    name: string,
    options: TaskDefinitionOptions<TContextData, TSchema>,
  ): TaskDefinition<TContextData, StandardSchemaV1.InferOutput<TSchema>>;
}

/**
 * Options for {@link Context.enqueueTask} and {@link Context.enqueueTaskMany}.
 * @since 2.x.x
 */
export interface TaskEnqueueOptions {
  /**
   * The delay before the task is processed.  No delay by default.
   */
  readonly delay?: Temporal.DurationLike;

  /**
   * An optional key that ensures tasks with the same ordering key are
   * processed sequentially (one at a time).
   */
  readonly orderingKey?: string;

  /**
   * An optional key requesting at-most-once enqueue for tasks that share it.
   *
   * A queue with {@link MessageQueue.nativeDeduplication} `true` enforces it
   * strictly; otherwise deduplication is best-effort via {@link KvStore.cas},
   * and {@link FederationOptions.taskDeduplicationFallback} decides whether a
   * missing `cas` proceeds without deduplication or throws.
   *
   * For {@link Context.enqueueTaskMany}, one key governs the whole batch.  When
   * deduplication is actually applied—a native queue, or the key–value
   * fallback through {@link KvStore.cas}—a multi-item batch with a
   * `deduplicationKey` requires the queue to implement
   * {@link MessageQueue.enqueueMany} so it enqueues atomically, or the call
   * throws a `TypeError`.  Under the `"open"` fallback with no `cas`, no marker
   * is taken, so such a batch instead fans out without deduplication.
   *
   * @since 2.x.x
   */
  readonly deduplicationKey?: string;
}

/**
 * The stored shape of a task definition, read at dispatch time.
 * @internal
 */
export interface TaskDefinitionInternal<TContextData> {
  readonly name: string;
  readonly schema: StandardSchemaV1;
  /**
   * The exact handle object {@link TaskRegistry.defineTask} returned for
   * this definition.  {@link Context.enqueueTask} compares it by identity:
   * another federation instance may define the same task name with a
   * different schema, so name lookup alone cannot tell its handle apart.
   */
  readonly handle: TaskDefinition<TContextData, unknown>;
  readonly handler: TaskHandler<TContextData, unknown>;
  readonly retryPolicy?: RetryPolicy;
  readonly onError?: (
    ctx: Context<TContextData>,
    error: unknown,
    data: unknown,
  ) => Promise<void> | void;
  readonly queue?: MessageQueue;
}
