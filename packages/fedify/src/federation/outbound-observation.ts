import { getLogger } from "@logtape/logtape";
import type { Context } from "./context.ts";
import type {
  OutboundBroadcastEvent,
  OutboundObservers,
  OutboundPreparationResult,
} from "./outbound-report.ts";

type PreparationFailure = Extract<
  OutboundPreparationResult,
  { type: "failed" }
>;

/** State owned by one outgoing invocation, never serialized into queues. */
export class OutboundBroadcastObservation<TContextData> {
  readonly #broadcastId = crypto.randomUUID();
  #finished = false;
  #phase: PreparationFailure["failure"]["phase"] = "unknown";
  #planning: PreparationFailure["planning"] = "not-started";
  #destinationCount = 0;

  constructor(
    readonly context: Context<TContextData>,
    readonly observer: NonNullable<
      OutboundObservers<TContextData>["onBroadcast"]
    >,
    readonly operation: OutboundBroadcastEvent["operation"],
  ) {}

  setPhase(phase: PreparationFailure["failure"]["phase"]): void {
    this.#phase = phase;
    if (phase === "destination-planning") this.#planning = "incomplete";
  }

  planned(destinationCount: number): void {
    this.#planning = "complete";
    this.#destinationCount = destinationCount;
  }

  prepared(preparedFor: "fanout" | "delivery"): Promise<void> {
    return this.#finish(Object.freeze({
      type: "prepared",
      preparedFor,
      destinationCount: this.#destinationCount,
    }));
  }

  skipped(
    reason: Extract<OutboundPreparationResult, { type: "skipped" }>["reason"] =
      "no-destinations",
  ): Promise<void> {
    return this.#finish(Object.freeze({
      type: "skipped",
      reason,
    }));
  }

  async run<TResult>(
    send: (
      observation?: OutboundBroadcastObservation<TContextData>,
    ) => Promise<TResult>,
  ): Promise<TResult> {
    await this.#notify(Object.freeze({
      broadcastId: this.#broadcastId,
      operation: this.operation,
      stage: "started",
    }));
    try {
      return await send(this);
    } catch (error) {
      const failure: PreparationFailure["failure"] = {
        kind: this.#phase === "unknown" ? "unknown" : "local",
        phase: this.#phase,
        error,
      };
      await this.#finish(Object.freeze({
        type: "failed",
        failure: Object.freeze(failure),
        planning: this.#planning,
        plannedDestinationCount: this.#destinationCount,
      }));
      throw error;
    }
  }

  async #finish(result: OutboundPreparationResult): Promise<void> {
    if (this.#finished) return;
    this.#finished = true;
    await this.#notify(Object.freeze({
      broadcastId: this.#broadcastId,
      operation: this.operation,
      stage: "preparation-finished",
      result,
    }));
  }

  async #notify(event: OutboundBroadcastEvent): Promise<void> {
    try {
      await this.observer(this.context, event);
    } catch (error) {
      try {
        getLogger(["fedify", "federation", "outbox"]).error(
          "An unexpected error occurred in outbound broadcast observer:\n{error}",
          { error },
        );
      } catch {
        // A logging sink must not replace the send's result either.
      }
    }
  }
}

/** Observe preparation without changing the unobserved send's execution path. */
export function observeOutboundBroadcast<TContextData, TResult>(
  context: Context<TContextData>,
  observer: OutboundObservers<TContextData>["onBroadcast"],
  send: (
    observation?: OutboundBroadcastObservation<TContextData>,
  ) => Promise<TResult>,
  operation: OutboundBroadcastEvent["operation"] = "send",
): Promise<TResult> {
  if (observer == null) return send();
  return new OutboundBroadcastObservation(context, observer, operation).run(
    send,
  );
}
