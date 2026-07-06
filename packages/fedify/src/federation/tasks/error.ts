export class TaskRetryEnqueueError extends Error {
  constructor(cause: unknown) {
    super("Failed to re-enqueue a custom task for a retry.", { cause });
    this.name = "TaskRetryEnqueueError";
  }
}
