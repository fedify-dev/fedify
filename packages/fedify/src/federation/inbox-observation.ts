import { Activity } from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
import type { Span } from "@opentelemetry/api";
import type { RequestContext } from "./context.ts";
import type {
  InboxAuthentication,
  InboxRequestFinishedHandler,
  InboxRequestOutcome,
  InboxRequestReport,
} from "./inbox-report.ts";
import type { VerificationObservation } from "../sig/verification.ts";

/** Internal state owned by the ingress boundary, never serialized into queues. */
export class InboxObservation {
  payload: InboxRequestReport["payload"] = { status: "unavailable" };
  activity: Activity | null = null;
  authentication: InboxAuthentication = { status: "notDetermined" };
  hasException = false;
  stage: Extract<InboxRequestOutcome, { type: "exception" }>["stage"] =
    "prepare";
  result:
    | Omit<
      Extract<InboxRequestOutcome, { disposition: "rejected" }>,
      "type" | "status"
    >
    | Omit<
      Extract<InboxRequestOutcome, { disposition: "failed" }>,
      "type" | "status"
    >
    | {
      disposition:
        | "processed"
        | "enqueued"
        | "duplicate"
        | "unhandled"
        | "customResponse";
    } = { disposition: "rejected", reason: "recipientNotFound" };
  readonly verification: VerificationObservation = {
    attempts: [],
    subject: { id: null, pointer: "" },
    parsedObject: (object) => {
      if (object instanceof Activity) {
        this.activity = object;
        this.verification.subject!.id = object.id == null
          ? null
          : new URL(object.id.href);
      }
    },
  };
  constructor(readonly inbox: InboxRequestReport["inbox"]) {}

  async run<T>(
    getContext: () => RequestContext<T>,
    handler: InboxRequestFinishedHandler<T> | undefined,
    operation: () => Promise<Response>,
    span?: Span,
  ): Promise<Response> {
    let response: Response | undefined;
    let outcome: InboxRequestOutcome;
    let threw = false;
    let originalError: unknown;
    try {
      response = await operation();
      outcome = { type: "response", status: response.status, ...this.result };
    } catch (error) {
      threw = true;
      this.hasException = true;
      originalError = error;
      outcome = { type: "exception", stage: this.stage, error };
    }
    if (span != null) this.project(span, outcome);
    await this.finish(getContext(), handler, outcome);
    if (threw) throw originalError;
    return response!;
  }

  project(span: Span, outcome?: InboxRequestOutcome): void {
    span.setAttribute(
      "activitypub.authentication.status",
      this.authentication.status,
    );
    if (this.authentication.status === "rejected") {
      span.setAttribute(
        "activitypub.verification.failure_reason",
        this.authentication.reason.type,
      );
    }
    span.setAttribute(
      "activitypub.inbox.disposition",
      outcome?.type === "exception" || this.hasException
        ? "exception"
        : this.result.disposition,
    );
  }

  async finish<T>(
    context: RequestContext<T>,
    handler: InboxRequestFinishedHandler<T> | undefined,
    outcome: InboxRequestOutcome,
  ): Promise<void> {
    if (handler == null) return;
    const report: InboxRequestReport = {
      inbox: this.inbox,
      payload: this.payload,
      activity: this.activity,
      attempts: this.verification.attempts,
      authentication: this.authentication,
      outcome,
    };
    try {
      await handler(context, report);
    } catch (error) {
      try {
        getLogger(["fedify", "federation", "inbox"]).error(
          "An unexpected error occurred in inbox request finished handler:\n{error}",
          { error },
        );
      } catch {
        /* A logging sink must not replace the delivery result either. */
      }
    }
  }
}
