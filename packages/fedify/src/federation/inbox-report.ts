import type { Activity } from "@fedify/vocab";
import type { RequestContext } from "./context.ts";
import type {
  InboxVerificationAttempt,
  InboxVerificationKey,
} from "../sig/verification.ts";
export type {
  InboxProofPolicyFailureReason,
  InboxSignatureCheck,
  InboxSignatureFailureReason,
  InboxSignatureIdentity,
  InboxVerificationAttempt,
  InboxVerificationFailureReason,
  InboxVerificationKey,
} from "../sig/verification.ts";

/**
 * A JSON value retained from the incoming request.
 * @since 2.4.0
 */
export type InboxJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly InboxJsonValue[]
  | { readonly [key: string]: InboxJsonValue };

/**
 * The final inbox authentication decision.
 * @since 2.4.0
 */
export type InboxAuthentication =
  | {
    readonly status: "verified";
    /** Direct references to the attempts that authenticated this delivery. */
    readonly attempts: readonly Extract<
      InboxVerificationAttempt,
      { status: "verified" }
    >[];
  }
  | {
    readonly status: "rejected";
    readonly reason:
      | { readonly type: "verificationFailed" }
      | {
        readonly type: "actorKeyMismatch";
        readonly key: InboxVerificationKey;
        readonly actorIds: readonly URL[];
      }
      | {
        readonly type: "proofPolicy";
        readonly policy: "portableActor" | "portableActivity" | "compound";
        readonly detail?:
          import("../sig/verification.ts").InboxProofPolicyFailureReason;
      }
      | { readonly type: "invalidNonce" };
  }
  | { readonly status: "skipped" }
  | { readonly status: "notDetermined" };

/**
 * How an inbox request finished.
 * @since 2.4.0
 */
export type InboxRequestOutcome =
  | {
    readonly type: "response";
    readonly status: number;
    readonly disposition:
      | "processed"
      | "enqueued"
      | "duplicate"
      | "unhandled"
      | "customResponse";
  }
  | {
    readonly type: "response";
    readonly status: number;
    readonly disposition: "rejected";
    readonly reason:
      | "recipientNotFound"
      | "invalidJson"
      | "invalidJsonLd"
      | "invalidActivity"
      | "bodyTooLarge"
      | "missingActor"
      | "authentication";
  }
  | {
    readonly type: "response";
    readonly status: number;
    readonly disposition: "failed";
    readonly reason: "bodyUnavailable" | "enqueueError" | "listenerError";
    readonly error?: unknown;
  }
  | {
    readonly type: "exception";
    readonly stage:
      | "prepare"
      | "parse"
      | "verify"
      | "policy"
      | "dispatch"
      | "respond";
    /** The original thrown value, including null/undefined. */
    readonly error: unknown;
  };

/**
 * Observations of a single inbox delivery request.
 * @since 2.4.0
 */
export interface InboxRequestReport {
  /** The delivery route, including a portable gateway route. */
  readonly inbox: {
    readonly kind: "personal" | "shared" | "portable";
    readonly recipient: string | null;
  };
  /** Unavailable differs from a successfully parsed JSON null. */
  readonly payload: { readonly status: "unavailable" } | {
    readonly status: "parsed";
    readonly value: InboxJsonValue;
  };
  /** The Activity obtained by the normal processing flow, if any. */
  readonly activity: Activity | null;
  /** Logical evaluations, including unsuccessful fallback paths. */
  readonly attempts: readonly InboxVerificationAttempt[];
  /** Cryptographic success alone does not imply this decision is verified. */
  readonly authentication: InboxAuthentication;
  /** Response status snapshot or the original exception. */
  readonly outcome: InboxRequestOutcome;
}

/**
 * Observes an inbox delivery after processing, before fetch resolves/rethrows.
 * The callback is awaited.  Its errors are logged and swallowed, preserving
 * the original response/exception.  The last registered callback replaces the
 * previous one.  It excludes inbox collection GETs, unmatched routes,
 * programmatic routing, and queue workers.  This is not an atomic persistence
 * guarantee.  Keys/owner/controller declarations remain untrusted unless the
 * final authentication decision verifies them.
 * @since 2.4.0
 */
export type InboxRequestFinishedHandler<TContextData> = (
  context: RequestContext<TContextData>,
  report: InboxRequestReport,
) => void | Promise<void>;
