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
  & OutboundSourceMetadata
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
 * IDs group producer handoffs and their fanout expansion across queue tasks.
 * Full worker execution reports and concrete attempts are not observed yet.
 * An unvisited destination stays planned when another destination's preparation
 * interrupts the producer.
 * @since 2.5.0
 */
export type OutboundDeliveryEvent =
  & OutboundSourceMetadata
  & {
    /** The originating invocation, or unknown for legacy fanout work. */
    readonly broadcast:
      | { readonly type: "known"; readonly id: string }
      | { readonly type: "unknown" };
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
 * A callback that never settles can delay execution indefinitely. Detached
 * recording must handle its own rejection and shutdown; no persistence is
 * guaranteed. Existing portable forwarding deadlines may return while
 * background preparation, sending, and observer callbacks continue.
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
   * failures, including fanout continuation handoffs. Filtered recipients do
   * not become planned deliveries. Concrete attempts, remote success, and full
   * worker execution reports are not observed yet.
   */
  readonly onDelivery?: (
    context: Context<TContextData>,
    event: OutboundDeliveryEvent,
  ) => void | Promise<void>;
}
/** URL facts captured independently of a mutable context URL. @since 2.5.0 */
export interface OutboundLocalContext {
  /** Scheme and authority of the context URL. */
  readonly origin: string;
  /** URL hostname with its optional port. */
  readonly host: string;
  /** URL hostname without a port. */
  readonly hostname: string;
  /** Configured canonical web origin, falling back to this context's origin. */
  readonly canonicalOrigin: string;
}

/** The original routed HTTP inbox request that caused outgoing work. @since 2.5.0 */
export interface OutboundInboxRequest {
  /** Fresh server-generated identity, independent of Activity and trace IDs. */
  readonly inboxRequestId: string;
  /** Informational logging label; externally controlled and nonunique. */
  readonly requestId: string;
  /** Original request URL facts, preserved separately from current context. */
  readonly context: OutboundLocalContext;
}

/** Explicit historical cause of outgoing work. @since 2.5.0 */
export interface OutboundProvenance {
  /** Application-owned correlation; never a Fedify deduplication key. */
  readonly dispatchId?: string;
  /** Absent for independent contexts, programmatic routing, and unknown work. */
  readonly inboxRequest?: OutboundInboxRequest;
  /** Original logging label for request-derived work without an inbox cause. */
  readonly originatingRequestId?: string;
}

interface OutboundSourceMetadata {
  /** Immutable historical cause, distinct from this callback's context. */
  readonly provenance: OutboundProvenance;
  /** URL facts of the current callback context. */
  readonly local: OutboundLocalContext;
}
