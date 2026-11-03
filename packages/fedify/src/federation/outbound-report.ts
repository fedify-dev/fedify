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

/** Immutable JSON data in a privacy projection. @since 2.5.0 */
export type OutboundJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly OutboundJsonValue[]
  | { readonly [key: string]: OutboundJsonValue };

/** Attempt input evidence, never proof of a particular exchange's wire body. @since 2.5.0 */
export type OutboundSenderPayload =
  & {
    /** Concrete sender input, not a producer history or per-exchange wire body. */
    readonly stage: "sender-payload";
  }
  & (
    | {
      /** A safe independent projection was established without extra processing. */
      readonly type: "available";
      /** Always a projection; no signature/proof or exact-wire claim is retained. */
      readonly representation: "privacy-projection";
      /** At least one blind-recipient field was removed from the copied value. */
      readonly redacted: boolean;
      /** Recursively immutable JSON data; transport/signing input is unchanged. */
      readonly value: OutboundJsonValue;
    }
    | {
      /** No document value is exposed, including when export is disabled. */
      readonly type: "unavailable";
      /** Opt-out, pre-snapshot failure, or unsupported privacy/context semantics. */
      readonly reason:
        | "disabled"
        | "not-materialized"
        | "privacy-filter-unavailable";
    }
  );

/** Result of an enabled response-body capture. Absence means disabled. @since 2.5.0 */
export type OutboundBodyCaptureSummary =
  & {
    /** Bytes handed to the application, not bytes durably stored. */
    readonly bytesExposed: number;
  }
  & (
    | {
      /** Selection, verified EOF, byte-cap uncertainty, or local lifetime end. */
      readonly type:
        | "filtered"
        | "no-body"
        | "complete"
        | "limit-reached"
        | "deadline"
        | "callback-returned";
    }
    | {
      /** Application cancellation ended capture. */
      readonly type: "consumer-stopped";
      /** Original consumer reason, including non-Error values. */
      readonly reason: unknown;
    }
    | {
      /** Capture failed without changing received HTTP evidence. */
      readonly type: "failed";
      /** Source reading versus application callback failure. */
      readonly phase: "body" | "observer";
      /** Original capture error; it does not become the attempt's failure. */
      readonly error: unknown;
    }
  );

/** Bounded, revocable access to one selected response. @since 2.5.0 */
export type OutboundResponseBodyEvent =
  & Omit<OutboundHttpExchangeReport, "outcome" | "bodyCapture">
  & {
    /** Immutable response metadata, independently of eventual attempt outcome. */
    readonly response: Extract<
      OutboundHttpExchangeReport["outcome"],
      { type: "response" }
    >["response"];
    /** Pull-driven bytes; access ends when the callback settles or its limits apply. */
    readonly body: ReadableStream<Uint8Array>;
    /** Capture-only lifetime signal; aborting it does not cancel transport. */
    readonly signal: AbortSignal;
  };

/** Explicit opt-in response-body capture limits and consumer. @since 2.5.0 */
export interface OutboundResponseBodyCapture<TContextData> {
  /** Positive safe-integer exposure limit; exact cap without EOF stays uncertain. */
  readonly maxBytes: number;
  /** Positive finite absolute lifetime in milliseconds, rounded up; at most 2^31-1. */
  readonly timeoutMs: number;
  /** Actual response selector, defaulting to `all` only when enabled. */
  readonly responses?: "all" | "non-success-http-responses";
  /**
   * Invoked after headers, before the terminal exchange report, with current data.
   * Awaited within the absolute lifetime, including no-pull/slow-consumer time.
   * Return/throw/cancel/cap/deadline revokes access even for retained locked readers.
   * Errors cannot veto transport; ignoring the signal cannot be forcibly stopped.
   */
  readonly onBody: (
    context: Context<TContextData>,
    event: OutboundResponseBodyEvent,
  ) => void | Promise<void>;
}

/** Opt-in policy for one side of an actual HTTP exchange. @since 2.5.0 */
export interface OutboundHeaderPolicy {
  /** Literal HTTP names, normalized to lowercase and deduplicated at registration. */
  readonly allow: readonly string[];
  /**
   * Additional names whose selected values are always `[redacted]`.
   * Credentials, signatures and cookies remain protected even without this list.
   */
  readonly redact?: readonly string[];
  /**
   * Positive safe-integer UTF-8 budget for `name: value\r\n` after redaction.
   * Whole oversized entries are omitted; later entries remain eligible.
   */
  readonly maxBytes: number;
}

/** Immutable selected header values, using the runtime representation. @since 2.5.0 */
export interface OutboundHeaderSnapshot {
  /** Lowercase names in lexical order; credentials/signatures/cookies are redacted. */
  readonly entries: readonly (readonly [string, string])[];
  /** At least one selected entry was omitted because it exceeded the budget. */
  readonly limitReached: boolean;
}

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
  /** Opt-in independent sender input projection; unavailable states remain explicit. */
  readonly senderPayload: OutboundSenderPayload;
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
 * copied before callback awaiting; no live Request/Response/Headers are exposed.
 * Enabled body capture uses a separate revocable callback; reports hold summaries.
 * Exchange callbacks run after selected capture ends and may precede attempt settlement.
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
    /** Enabled capture result; absent when disabled or no response was received. */
    readonly bodyCapture?: OutboundBodyCaptureSummary;
    /** Immutable facts of the request actually submitted. */
    readonly request: {
      readonly url: string;
      readonly method: string;
      /** Selected header snapshot; absent when request header capture is disabled. */
      readonly headers?: OutboundHeaderSnapshot;
    };
    /** A received response, including non-2xx, or the original fetch rejection. */
    readonly outcome:
      | {
        readonly type: "response";
        readonly response: OutboundHttpResponseMetadata & {
          /** Selected snapshot; absent when response header capture is disabled. */
          readonly headers?: OutboundHeaderSnapshot;
        };
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
  /** Per-route ISO instants retained by the scheduled continuation, if any. */
  readonly notBefore?: Readonly<Record<string, string>>;
  /** Local preparation failures that contributed to this actual action. */
  readonly preparationFailures?: readonly OutboundWorkerPreparationDiagnostic[];
};

/**
 * One local preparation failure associated with a worker route.
 * @since 2.5.0
 */
export type OutboundWorkerPreparationDiagnostic = {
  /** Route whose local setup produced the failure. */
  readonly inboxUrl: string;
  /** Existing worker preparation classification and original thrown value. */
  readonly failure: Extract<OutboundWorkerReport["result"], {
    type: "preparation-failed";
  }>["failure"];
};

type OutboundWorkerChild = {
  readonly action: "enqueue";
  /** Actual child task identity and initial Fedify retry counter. */
  readonly queue: NonNullable<OutboundAttemptReport["queue"]>;
  /** Routes submitted with this child task. */
  readonly inboxUrls: readonly string[];
  /** Stable child obligation, independent of its task identity. */
  readonly delivery?: OutboundWorkerReport["delivery"];
};

type OutboundWorkerAction =
  | ((OutboundWorkerSchedule | OutboundWorkerChild) & {
    readonly type: "scheduled";
  })
  | ((OutboundWorkerSchedule | OutboundWorkerChild) & {
    readonly type: "action-failed";
    readonly acceptance: "unknown";
    readonly error: unknown;
  })
  | {
    readonly type: "handoff";
    readonly action: "direct";
    /** Actual concrete sender target; entry does not establish HTTP success. */
    readonly inboxUrls: readonly string[];
    /** Planned obligation retained across gateway fallback targets. */
    readonly delivery?: OutboundWorkerReport["delivery"];
  }
  | {
    readonly type: "abandoned";
    readonly reason:
      | "held-ttl-expired"
      | "permanent-failure"
      | "retry-policy-declined"
      | "queue-unavailable";
    /** Routes locally abandoned; other routes of the delivery may continue. */
    readonly inboxUrls: readonly string[];
    /** Local preparation failures that contributed to this abandonment. */
    readonly preparationFailures?:
      readonly OutboundWorkerPreparationDiagnostic[];
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
 * Emitted after the local worker path and its instrumentation settle. A normal
 * return can include handled send failures or abandonment; completion does not
 * establish HTTP success or backend acknowledgment. Actions retain local route
 * decisions and actual enqueue settlement, separately from attempt outcomes.
 * A native rethrow does not establish a scheduled continuation or future replay.
 * @since 2.5.0
 */
export type OutboundWorkerReport = OutboundSourceMetadata & {
  /** Current outgoing queue role; inbox/custom-task workers are separate. */
  readonly role: "fanout" | "outbox";
  /** Actual task and available Fedify retry counter for this execution. */
  readonly queue: NonNullable<OutboundAttemptReport["queue"]>;
  /** Concrete sender entries, independent of enabled attempt/exchange callbacks. */
  readonly attemptsStarted: number;
  /**
   * Observed enqueue settlement, concrete direct-entry, and local abandonment.
   * Accepted actions survive later worker failure; rejected batches leave each
   * submitted child uncertain. Empty when no action was observed by settlement.
   */
  readonly actions: readonly OutboundWorkerAction[];
  /**
   * Caught preparation failures retained when later routes succeed or when
   * the worker exits without scheduling a continuation. Omitted when none.
   */
  readonly preparationFailures?: readonly OutboundWorkerPreparationDiagnostic[];
  /**
   * Outbox obligation, with unavailable legacy relationships omitted.
   * Fanout has no single delivery; its child actions carry their own references.
   */
  readonly delivery?: Pick<
    OutboundAttemptReport,
    "broadcast" | "deliveryId" | "destinationInbox" | "portableInbox"
  >;
  /**
   * Actual local settlement, separate from individual attempts and queue actions.
   * Preparation failures identify the operation that produced the escaping error.
   */
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
          | "validation"
          | "key-resolution"
          | "signing"
          | "serialization"
          | "key-export"
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
 * Worker reports describe local fanout/outbox settlement and actual queue
 * actions; they do not establish backend acknowledgment or future execution.
 * Known IDs and provenance survive queue continuations; callback context data
 * belongs to the current execution. Each callback is independently optional.
 * Metadata callbacks are awaited without a default timeout. An enabled body
 * consumer instead uses its explicit bounded capture lifetime.
 * Their errors, including errors logging observer failures, do not replace the
 * send's result.
 * A metadata callback that never settles can delay execution indefinitely. Detached
 * recording must handle its own rejection and shutdown; no persistence is
 * guaranteed. Existing portable forwarding deadlines may return while
 * background preparation, sending, and observer callbacks continue.
 * @template TContextData Application context data.
 * @since 2.5.0
 */
export interface OutboundObservers<TContextData> {
  /**
   * Opt-in immutable privacy projection of concrete sender input on attempt reports.
   * Disabled by default. Unsupported context/data semantics yield no raw fallback;
   * this is not exact wire evidence or proof that redirected requests kept a body.
   */
  readonly senderPayload?: boolean;
  /**
   * Independent opt-in body consumer; explicit byte/time limits are required.
   * Shares one source reader with separately bounded diagnostics, without cloning
   * or whole-body accumulation for the application. Finished reports hold summaries.
   */
  readonly responseBodyCapture?: OutboundResponseBodyCapture<TContextData>;
  /**
   * Opt-in actual request headers for exchange reports; disabled by default.
   * Protected credentials, signatures, and cookies remain redacted even if allowed.
   */
  readonly requestHeaders?: OutboundHeaderPolicy;
  /** Independent opt-in response header policy for exchange reports. */
  readonly responseHeaders?: OutboundHeaderPolicy;

  /**
   * Observes terminal outgoing worker processing with current context/data.
   * Errors are isolated; results do not replace attempt outcomes or establish
   * future backend execution. Actions retain actual accepted/uncertain child
   * handoffs and retry/defer/drop facts, separately from attempt outcomes.
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
