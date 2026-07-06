import { isAbortError } from "../metrics.ts";
import type { QueueTaskDispatchResult } from "./types.ts";

export class TaskRetryEnqueueError extends Error {
  constructor(cause: unknown) {
    super("Failed to re-enqueue a custom task for a retry.", { cause });
    this.name = "TaskRetryEnqueueError";
  }
}

export const classifyAbortableError = (
  error: unknown,
): QueueTaskDispatchResult =>
  isAbortError(error) ? { outcome: "aborted" } : { outcome: "failed", error };

export const classifyTaskError = (
  error: unknown,
): QueueTaskDispatchResult =>
  isAbortError(error)
    ? { outcome: "aborted" }
    : error instanceof TaskRetryEnqueueError
    ? {
      outcome: "failed",
      failureReason: "retry_enqueue",
      error: error.cause ?? error,
    }
    : { outcome: "failed", failureReason: "handler", error };
