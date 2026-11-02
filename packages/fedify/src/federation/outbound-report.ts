import type { Context } from "./context.ts";

/**
 * The start of an ordinary {@link Context.sendActivity} invocation.
 *
 * This reports entry before preparation, not queue acceptance or delivery.
 * @since 2.5.0
 */
export interface OutboundBroadcastEvent {
  /** Fresh opaque identity for this invocation, independent of tracing. */
  readonly broadcastId: string;
  /** This increment observes ordinary sends of a new activity. */
  readonly operation: "send";
  /** Preparation has not started yet. */
  readonly stage: "started";
}

/**
 * Optional observers of outgoing activity processing.
 *
 * Currently only ordinary {@link Context.sendActivity} starts are observed.
 * Callbacks are awaited without a default timeout.  Their errors, including
 * errors logging observer failures, do not replace the send's result.  A
 * callback that never settles delays the send indefinitely.  Detached recording
 * must handle its own rejection and shutdown; no persistence is guaranteed.
 * @template TContextData Application context data.
 * @since 2.5.0
 */
export interface OutboundObservers<TContextData> {
  /**
   * Observes an invocation before sender/recipient resolution or signing.
   * The existing context is passed without loading data for observation.
   * Returning or throwing cannot veto sending.
   */
  readonly onBroadcast?: (
    context: Context<TContextData>,
    event: OutboundBroadcastEvent,
  ) => void | Promise<void>;
}
