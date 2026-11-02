import type { Context } from "./context.ts";

/**
 * The current producer's preparation result, not delivery completion.
 * @since 2.5.0
 */
export type OutboundPreparationResult =
  | {
    /** The producer finished preparing its continuation. */
    readonly type: "prepared";
    /** Fanout-ready work still needs worker-side delivery preparation. */
    readonly preparedFor: "fanout" | "delivery";
    /** Number of deduplicated destinations, not actors or successful sends. */
    readonly destinationCount: number;
  }
  | {
    /** A deliberate no-send decision. */
    readonly type: "skipped";
    /** An empty completed plan, or an unsigned payload skipped by policy. */
    readonly reason: "no-destinations" | "unsigned";
  }
  | {
    /** Preparation failed before the producer reached readiness. */
    readonly type: "failed";
    /** The operation that failed and its original thrown value. */
    readonly failure: {
      /** Local processing failure, or unavailable operation provenance. */
      readonly kind: "local" | "unknown";
      /** The observed operation, not a diagnosis from the error message. */
      readonly phase:
        | "sender-resolution"
        | "key-resolution"
        | "recipient-resolution"
        | "transformation"
        | "validation"
        | "signing"
        | "destination-planning"
        | "serialization"
        | "request-preparation"
        | "unknown";
      /** Original thrown value, including non-Error values. */
      readonly error: unknown;
    };
    /** Whether a complete destination plan was established before failure. */
    readonly planning: "not-started" | "incomplete" | "complete";
    /** Confirmed planned obligations so far, not an audience estimate. */
    readonly plannedDestinationCount: number;
  };

/**
 * A send or original-payload forwarding invocation's producer lifecycle.
 *
 * Preparation results do not report queue acceptance or delivery completion.
 * @since 2.5.0
 */
export type OutboundBroadcastEvent =
  & {
    /** Fresh opaque identity shared by producer events, independent of tracing. */
    readonly broadcastId: string;
    /** The outgoing operation being observed. */
    readonly operation: "send" | "forward";
  }
  & (
    | {
      /** Entry before sender/recipient resolution or signing. */
      readonly stage: "started";
    }
    | {
      /** The current producer's preparation settled. */
      readonly stage: "preparation-finished";
      /** Readiness, a deliberate skip, or the original preparation failure. */
      readonly result: OutboundPreparationResult;
    }
  );

/**
 * Optional observers of outgoing activity processing.
 *
 * Send and original-payload forwarding producer events are observed, including
 * outbox-context operations. Callbacks are awaited without a default timeout.
 * Their errors, including errors logging observer failures, do not replace the
 * send's result.
 * A callback that never settles delays execution indefinitely. Detached
 * recording must handle its own rejection and shutdown; no persistence is
 * guaranteed.
 * @template TContextData Application context data.
 * @since 2.5.0
 */
export interface OutboundObservers<TContextData> {
  /**
   * Observes invocation entry and the current producer's preparation result.
   * The existing context is passed without loading data for observation.
   * Returning or throwing cannot veto sending. Earlier immediate sends may
   * already be running when preparation finishes; their outcomes are separate.
   */
  readonly onBroadcast?: (
    context: Context<TContextData>,
    event: OutboundBroadcastEvent,
  ) => void | Promise<void>;
}
