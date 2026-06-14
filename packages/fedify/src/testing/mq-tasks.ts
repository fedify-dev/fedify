/**
 * Test-only utilities shared by the task suites in this directory
 * (*tasks.test.ts* and *enqueue.test.ts*): the schema factory and stock
 * schemas, the base federation options, and the recording {@link MockQueue}.
 *
 * These helpers live beside the suites that use them rather than in a shared
 * package because {@link MockQueue} needs the package-internal
 * {@link TaskMessage} type, and *deno.json*'s `publish.exclude` keeps this
 * module out of the published sources.
 *
 * @module
 */
import { mockDocumentLoader } from "@fedify/fixture";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FederationOptions } from "../federation/federation.ts";
import { MemoryKvStore } from "../federation/kv.ts";
import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "../federation/mq.ts";
import type { TaskMessage } from "../federation/queue.ts";

/**
 * Builds a minimal [Standard Schema](https://standardschema.dev/) from a type
 * guard: values the guard accepts validate, and the rest fail.
 */
export const makeSchema = <T>(
  check: (data: unknown) => data is T,
): StandardSchemaV1<unknown, T> => ({
  "~standard": {
    version: 1,
    vendor: "fedify-test",
    validate: (value: unknown) =>
      check(value)
        ? { value }
        : { issues: [{ message: "Invalid task data." }] },
  },
});

/** A schema that accepts only strings. */
export const stringSchema: StandardSchemaV1<unknown, string> = makeSchema(
  (d): d is string => typeof d === "string",
);

/** A schema that accepts only numbers. */
export const numberSchema: StandardSchemaV1<unknown, number> = makeSchema(
  (d): d is number => typeof d === "number",
);

/** Federation options (sans `queue`) shared by the task suites. */
export const baseOptions: Omit<FederationOptions<void>, "queue"> = {
  kv: new MemoryKvStore(),
  documentLoaderFactory: () => mockDocumentLoader,
  contextLoaderFactory: () => mockDocumentLoader,
  manuallyStartQueue: true,
};

/**
 * Options for the {@link MockQueue} constructor.
 */
export interface MockQueueOptions {
  /** Sets {@link MessageQueue.nativeRetrial}.  Defaults to `false`. */
  nativeRetrial?: boolean;
  /** Sets {@link MessageQueue.nativeDeduplication}.  Defaults to `false`. */
  nativeDeduplication?: boolean;
  /**
   * When `true`, the queue exposes {@link MockQueue.enqueueMany} and records
   * bulk enqueues; when omitted, the method is absent so callers exercise the
   * per-message fan-out path.
   */
  supportsEnqueueMany?: boolean;
}

/**
 * An in-memory {@link MessageQueue} that records task enqueues for assertions
 * instead of delivering anything.  Its {@link listen} resolves only when the
 * abort signal fires.
 */
export class MockQueue implements MessageQueue {
  readonly nativeRetrial: boolean;
  readonly nativeDeduplication: boolean;
  readonly enqueued: {
    message: TaskMessage;
    options?: MessageQueueEnqueueOptions;
  }[] = [];
  readonly enqueuedMany: {
    messages: readonly TaskMessage[];
    options?: MessageQueueEnqueueOptions;
  }[] = [];
  listenCount = 0;
  enqueueMany?: (
    messages: readonly TaskMessage[],
    options?: MessageQueueEnqueueOptions,
  ) => Promise<void>;

  constructor(options: MockQueueOptions = {}) {
    this.nativeRetrial = options.nativeRetrial ?? false;
    this.nativeDeduplication = options.nativeDeduplication ?? false;
    if (options.supportsEnqueueMany) {
      this.enqueueMany = (messages, opts) => {
        this.enqueuedMany.push({ messages, options: opts });
        return Promise.resolve();
      };
    }
  }

  enqueue(
    message: TaskMessage,
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    this.enqueued.push({ message, options });
    return Promise.resolve();
  }

  listen(
    _handler: (message: TaskMessage) => Promise<void> | void,
    options?: MessageQueueListenOptions,
  ): Promise<void> {
    this.listenCount++;
    return new Promise((resolve) => {
      options?.signal?.addEventListener("abort", () => resolve());
    });
  }
}
