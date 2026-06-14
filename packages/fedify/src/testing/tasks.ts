import { Note } from "@fedify/vocab";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "../federation/mq.ts";
import type { TaskMessage } from "../federation/queue.ts";

/**
 * Builds a minimal [Standard Schema](https://standardschema.dev/) from a type
 * guard, for use as a task payload schema in tests.
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

export const stringSchema = makeSchema(
  (d): d is string => typeof d === "string",
);
export const numberSchema = makeSchema(
  (d): d is number => typeof d === "number",
);

/** A task payload that carries a vocabulary object, to exercise the codec's
 * vocab-to-JSON-LD bridging. */
export interface Envelope {
  note: Note;
  title: string;
}

export const envelopeSchema = makeSchema(
  (data): data is Envelope =>
    typeof data === "object" && data != null &&
    (data as Envelope).note instanceof Note &&
    typeof (data as Envelope).title === "string",
);

/** Options for {@link MockQueue}. */
export interface MockQueueOptions {
  readonly nativeRetrial?: boolean;
  readonly supportsEnqueueMany?: boolean;
}

/**
 * A {@link MessageQueue} that records what it was asked to enqueue and resolves
 * its `listen()` when the abort signal fires, so tests can inspect dispatch
 * without a real backend.
 */
export class MockQueue implements MessageQueue {
  readonly nativeRetrial: boolean;
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
    if (options.supportsEnqueueMany) {
      this.enqueueMany = (messages, opts) => {
        this.enqueuedMany.push({ messages, options: opts });
        return Promise.resolve();
      };
    }
  }

  // deno-lint-ignore no-explicit-any
  enqueue(message: any, options?: MessageQueueEnqueueOptions): Promise<void> {
    this.enqueued.push({ message, options });
    return Promise.resolve();
  }

  listen(
    // deno-lint-ignore no-explicit-any
    _handler: (message: any) => Promise<void> | void,
    options?: MessageQueueListenOptions,
  ): Promise<void> {
    this.listenCount++;
    return new Promise((resolve) => {
      options?.signal?.addEventListener("abort", () => resolve());
    });
  }
}
