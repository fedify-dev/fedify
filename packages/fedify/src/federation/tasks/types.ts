import type { QueueTaskFailureReason } from "../metrics.ts";

export type QueueTaskDispatchResult =
  | { readonly outcome: "completed" | "aborted" }
  | {
    readonly outcome: "failed";
    readonly failureReason?: QueueTaskFailureReason;
    readonly error?: unknown;
  };
