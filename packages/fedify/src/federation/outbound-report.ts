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
 * Concrete sends use separate {@link OutboundAttemptReport} values; these
 * events do not establish delivery completion or worker scheduling outcomes.
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

type OutboundAttemptFailure =
  | {
    readonly kind: "http";
    readonly phase: "response";
    readonly error?: unknown;
  }
  | {
    readonly kind: "transport";
    readonly phase: "validation" | "request";
    readonly error: unknown;
  }
  | {
    readonly kind: "policy";
    readonly phase: "validation";
    readonly error: unknown;
  }
  | {
    readonly kind: "local";
    readonly phase:
      | "serialization"
      | "request-preparation"
      | "cleanup"
      | "signing"
      | "spec-lookup"
      | "post-response";
    readonly error: unknown;
  }
  | {
    readonly kind: "unknown";
    readonly phase: "unknown";
    readonly error: unknown;
  };

interface OutboundHttpResponseMetadata {
  /** Actual HTTP status returned by fetch. */
  readonly status: number;
  /** Copied HTTP status text. */
  readonly statusText: string;
  /** Response URL when supplied by fetch. */
  readonly url?: string;
}

type OutboundAttemptResponse =
  | {
    /** The HTTP flow selected this response before follow-up work. */
    readonly type: "final";
    /** Actual submission index of the selected response. */
    readonly exchangeIndex: number;
    /** Frozen response facts, retained across later local failures. */
    readonly metadata: OutboundHttpResponseMetadata;
  }
  | {
    /** No response headers were received, including zero-fetch attempts. */
    readonly type: "not-observed";
  }
  | {
    /** Continued past the response, or failed before deciding finality. */
    readonly type: "intermediate-only" | "undetermined";
    /** Latest received response, without a finality claim. */
    readonly lastObserved: {
      readonly exchangeIndex: number;
      readonly metadata: OutboundHttpResponseMetadata;
    };
  };

/**
 * The terminal result of one concrete send.
 *
 * A send that fails before submitting HTTP still constitutes an attempt, with
 * zero exchanges. Each gateway send and retry gets a fresh attempt identity.
 * Final response evidence follows the HTTP flow's selection, not the last
 * observed status; later cache/cleanup failures can still fail the execution.
 * @since 2.5.0
 */
export type OutboundAttemptReport = OutboundSourceMetadata & {
  /** Fresh opaque identity allocated at concrete sender entry. */
  readonly attemptId: string;
  /** The originating invocation, independent of tracing. */
  readonly broadcast: OutboundDeliveryEvent["broadcast"];
  /** Destination obligation shared with producer delivery events. */
  readonly deliveryId: string;
  /** Original planned inbox; unavailable on legacy outbox tasks. */
  readonly destinationInbox?: string;
  /** Canonical portable inbox when the planned destination represents one. */
  readonly portableInbox?: string;
  /** Inbox selected for this invocation of the concrete sender. */
  readonly inboxUrl: string;
  /** Actual fetch submissions, including challenges and redirects; may be zero. */
  readonly httpExchangeCount: number;
  /** Current queue execution; absent on immediate sends. */
  readonly queue?: {
    readonly queueMessageId: string;
    /** Present when the queue message carries a Fedify retry counter. */
    readonly queueAttempt?: number;
  };
  /** Settled execution result, separate from producer preparation. */
  readonly outcome:
    | {
      readonly type: "succeeded";
      /** Final response selected by the sender. */
      readonly response: Extract<OutboundAttemptResponse, { type: "final" }>;
    }
    | {
      readonly type: "failed";
      /**
       * Bounded failure kind and operation phase, captured before broad wrapping.
       * Unknown provenance stays unknown; exception names do not establish it.
       * Final non-OK HTTP evidence remains primary alongside local diagnostics.
       */
      readonly failure: OutboundAttemptFailure;
      /** Exact value escaping the sender, possibly different from failure.error. */
      readonly error: unknown;
      /** Explicit final or last-observed response evidence, including absence. */
      readonly response: OutboundAttemptResponse;
      /** Additional failures, without replacing the primary evidence. */
      readonly diagnostics?: readonly OutboundAttemptFailure[];
    };
};

/**
 * One actual fetch submission within a concrete send attempt.
 *
 * A redirect response remains an observed response even if a later hop fails.
 * This report does not establish the attempt's final response. Metadata is
 * copied before callback awaiting; no live Request/Response/Headers or body
 * capture is exposed. Exchange callbacks may run before the attempt settles.
 * @since 2.5.0
 */
export type OutboundHttpExchangeReport =
  & OutboundSourceMetadata
  & Pick<
    OutboundAttemptReport,
    | "attemptId"
    | "broadcast"
    | "deliveryId"
    | "destinationInbox"
    | "portableInbox"
    | "inboxUrl"
    | "queue"
  >
  & {
    /** Zero-based submission order within this attempt. */
    readonly exchangeIndex: number;
    /** Immutable facts of the request actually submitted. */
    readonly request: { readonly url: string; readonly method: string };
    /** A received response, including non-2xx, or the original fetch rejection. */
    readonly outcome:
      | {
        readonly type: "response";
        readonly response: OutboundHttpResponseMetadata;
      }
      | { readonly type: "failed"; readonly error: unknown };
  };

type OutboundWorkerSchedule = {
  readonly action: "retry" | "defer";
  /** Actual continuation task and Fedify retry counter. */
  readonly queue: NonNullable<OutboundAttemptReport["queue"]>;
  /** Actual affected routes, copied independently of the planned delivery. */
  readonly inboxUrls: readonly string[];
  /** ISO 8601 duration passed to enqueue after delay normalization. */
  readonly delay: string;
};

type OutboundWorkerAction =
  | (OutboundWorkerSchedule & { readonly type: "scheduled" })
  | (OutboundWorkerSchedule & {
    readonly type: "action-failed";
    readonly acceptance: "unknown";
    readonly error: unknown;
  })
  | {
    readonly type: "abandoned";
    readonly reason:
      | "held-ttl-expired"
      | "permanent-failure"
      | "retry-policy-declined";
    readonly inboxUrls: readonly string[];
  }
  | {
    readonly type: "action-failed";
    readonly action: "drop";
    readonly inboxUrls: readonly string[];
    readonly error: unknown;
  };

/**
 * One fanout or outbox worker execution after its local processing settles.
 *
 * Completion does not establish HTTP success. Scheduling/drop action evidence
 * is separate from the execution result and backend acknowledgment.
 * @since 2.5.0
 */
export type OutboundWorkerReport = OutboundSourceMetadata & {
  /** Current outgoing queue role; inbox/custom-task workers are separate. */
  readonly role: "fanout" | "outbox";
  /** Actual task and available Fedify retry counter for this execution. */
  readonly queue: NonNullable<OutboundAttemptReport["queue"]>;
  /** Concrete sender entries, independent of enabled attempt/exchange callbacks. */
  readonly attemptsStarted: number;
  /** Ordinary outbox action facts; omitted for other worker paths. */
  readonly actions?: readonly OutboundWorkerAction[];
  /** Known outbox obligation; absent for fanout or unavailable metadata. */
  readonly delivery?: Pick<
    OutboundAttemptReport,
    "broadcast" | "deliveryId" | "destinationInbox" | "portableInbox"
  >;
  /** Actual local settlement, separate from individual attempts. */
  readonly result:
    | { readonly type: "completed" }
    | { readonly type: "failed"; readonly error: unknown }
    | {
      readonly type: "preparation-failed";
      readonly failure: {
        readonly kind: "local";
        readonly phase:
          | "key-import"
          | "activity-parsing"
          | "context-preparation"
          | "request-preparation";
        readonly error: unknown;
      };
      /** Exact error escaping the worker preparation operation. */
      readonly error: unknown;
    };
};

/**
 * Optional observers of outgoing activity processing.
 *
 * Send, original-payload forwarding, and automatic portable replication producer
 * events are observed, including outbox-context operations and fanout
 * continuation handoffs. Concrete attempts and actual fetch exchanges include
 * queue workers, signature challenges, redirects, and alternate gateways.
 * Known IDs and provenance survive queue continuations; callback context data
 * belongs to the current execution. Each callback is independently optional.
 * Callbacks are awaited without a default timeout.
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
   * Observes terminal outgoing worker processing with current context/data.
   * Errors are isolated; results do not replace attempt outcomes or establish
   * future backend execution. Ordinary outbox action facts are included;
   * gateway and fanout actions are not observed yet.
   */
  readonly onWorker?: (
    context: Context<TContextData>,
    report: OutboundWorkerReport,
  ) => void | Promise<void>;

  /**
   * Observes each actual fetch after response headers or rejection, before
   * subsequent challenge/redirect handling. Non-2xx responses are still response
   * outcomes. Pre-fetch failures emit no exchange. Errors cannot veto transport.
   */
  readonly onHttpExchange?: (
    context: Context<TContextData>,
    report: OutboundHttpExchangeReport,
  ) => void | Promise<void>;

  /**
   * Observes settlement of concrete sends and forwarding, including workers
   * and pre-fetch failures. Holds, drops, and failures before sender entry emit
   * no attempt. Final HTTP evidence, local diagnostics, and the outward error
   * remain distinct. Callback errors cannot replace the sender's result.
   */
  readonly onAttempt?: (
    context: Context<TContextData>,
    report: OutboundAttemptReport,
  ) => void | Promise<void>;

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
   * not become planned deliveries. Concrete attempts and exchanges have their
   * own callbacks. These events do not report remote success or worker
   * scheduling outcomes.
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
  /**
   * Exact application-owned correlation, up to 1,024 UTF-8 bytes; an empty
   * string is valid. Never a Fedify deduplication key. Each new public call
   * supplies its own value; queued continuations retain it.
   */
  readonly dispatchId?: string;
  /** Absent for independent contexts, programmatic routing, and unknown work. */
  readonly inboxRequest?: OutboundInboxRequest;
  /** Original logging label for request-derived work without an inbox cause. */
  readonly originatingRequestId?: string;
}

interface OutboundSourceMetadata {
  /** Unix milliseconds at observation; wall clocks do not ensure global ordering. */
  readonly observedAt: number;
  /** Valid IDs of this operation's own span, when one is available. */
  readonly trace?: {
    readonly traceId: string;
    readonly spanId: string;
  };
  /** Immutable historical cause, distinct from this callback's context. */
  readonly provenance: OutboundProvenance;
  /** URL facts of the current callback context. */
  readonly local: OutboundLocalContext;
}
