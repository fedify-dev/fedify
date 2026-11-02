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
    /** The existing no-send decision made by this producer. */
    readonly reason:
      | "no-destinations"
      | "unsigned"
      | "forwarding-disabled"
      | "forwarding-unavailable"
      | "no-forwarding-targets";
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
 * A send, original-payload forwarding, or portable replication producer lifecycle.
 *
 * Preparation results do not report queue acceptance or delivery completion.
 * @since 2.5.0
 */
export type OutboundBroadcastEvent =
  & {
    /** Fresh opaque identity shared by producer events, independent of tracing. */
    readonly broadcastId: string;
    /** The outgoing operation being observed. */
    readonly operation: "send" | "forward" | "portable-replication";
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
 * A producer-side destination obligation, not delivery completion.
 *
 * IDs group this producer's events. Queue execution and identity propagation
 * through workers are not observed yet. An unvisited destination stays planned
 * when another destination's preparation interrupts the producer.
 * @since 2.5.0
 */
export type OutboundDeliveryEvent =
  & {
    /** The invocation that established this destination. */
    readonly broadcast: { readonly type: "known"; readonly id: string };
    /** Opaque identity allocated after deduplication or a confirmed claim. */
    readonly deliveryId: string;
    /** Planned destination, unchanged by concrete gateway selection. */
    readonly destinationInbox: string;
    /** Canonical portable inbox when the selected route represents one. */
    readonly portableInbox?: string;
  }
  & (
    | {
      /** This destination was established by the existing plan. */
      readonly stage: "planned";
      /** Known actors sharing the destination, not an exhaustive audience. */
      readonly actorIds: readonly string[];
      /** Whether the selected destination uses a shared inbox. */
      readonly sharedInbox: boolean;
      /** Fallback routes share one obligation; replication targets do not. */
      readonly mode: "ordinary" | "portable-fallback" | "portable-replication";
    }
    | {
      /** Local execution entry or enqueue settlement, not remote success. */
      readonly stage: "handoff";
      /** Evidence from the actual producer handoff. */
      readonly result:
        | { readonly type: "direct" }
        | {
          readonly type: "enqueued";
          readonly queue: "fanout" | "outbox";
          readonly queueMessageId: string;
        }
        | {
          readonly type: "enqueue-failed";
          readonly acceptance: "unknown";
          readonly error: unknown;
        };
    }
    | {
      /** Destination-local setup failed before entry into concrete sending. */
      readonly stage: "preparation-failed";
      /** The original local setup failure, without inventing an attempt. */
      readonly failure: {
        readonly kind: "local";
        readonly phase: "request-preparation";
        readonly error: unknown;
      };
    }
  );

/**
 * Optional observers of outgoing activity processing.
 *
 * Send, original-payload forwarding, and automatic portable replication producer
 * events are observed, including outbox-context operations. Callbacks are
 * awaited without a default timeout.
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
  /**
   * Observes producer-side planning, handoffs, and destination preparation
   * failures. Filtered recipients do not become planned deliveries. This does
   * not report concrete attempts, remote success, or worker execution yet.
   */
  readonly onDelivery?: (
    context: Context<TContextData>,
    event: OutboundDeliveryEvent,
  ) => void | Promise<void>;
}
