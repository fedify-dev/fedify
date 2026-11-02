import { getLogger } from "@logtape/logtape";
import type { Context } from "./context.ts";
import type {
  OutboundBroadcastEvent,
  OutboundDeliveryEvent,
  OutboundObservers,
  OutboundPreparationResult,
} from "./outbound-report.ts";

type PreparationFailure = Extract<
  OutboundPreparationResult,
  { type: "failed" }
>;

interface PlannedDestination {
  readonly actorIds: Iterable<string>;
  readonly sharedInbox: boolean;
  readonly portableInbox?: string;
  readonly mode?: "portable-replication";
}

async function notifyObserver<TContextData, TEvent>(
  context: Context<TContextData>,
  callback:
    | ((context: Context<TContextData>, event: TEvent) => void | Promise<void>)
    | undefined,
  event: TEvent,
  unit: "broadcast" | "delivery",
): Promise<void> {
  if (callback == null) return;
  try {
    await callback(context, event);
  } catch (error) {
    try {
      getLogger(["fedify", "federation", "outbox"]).error(
        "An unexpected error occurred in outbound {unit} observer:\n{error}",
        { unit, error },
      );
    } catch {
      // A logging sink must not replace the send's result either.
    }
  }
}

/** One producer's destination, without callbacks or live inputs in queues. */
class OutboundDeliveryObservation<TContextData> {
  #finished = false;
  readonly #reference;
  readonly #plan;

  constructor(
    readonly context: Context<TContextData>,
    readonly observer: NonNullable<
      OutboundObservers<TContextData>["onDelivery"]
    >,
    broadcastId: string,
    destinationInbox: string,
    destination: PlannedDestination,
  ) {
    this.#reference = Object.freeze({
      broadcast: Object.freeze({ type: "known" as const, id: broadcastId }),
      deliveryId: crypto.randomUUID(),
      destinationInbox,
      ...(destination.portableInbox == null
        ? {}
        : { portableInbox: destination.portableInbox }),
    });
    this.#plan = Object.freeze({
      actorIds: Object.freeze(Array.from(destination.actorIds)),
      sharedInbox: destination.sharedInbox,
      mode: destination.mode ??
        (destination.portableInbox == null ? "ordinary" : "portable-fallback"),
    });
  }

  planned(): Promise<void> {
    return notifyObserver(
      this.context,
      this.observer,
      Object.freeze({
        ...this.#reference,
        ...this.#plan,
        stage: "planned" as const,
      }),
      "delivery",
    );
  }

  handoff(
    result: Extract<OutboundDeliveryEvent, { stage: "handoff" }>["result"],
  ): Promise<void> {
    if (this.#finished) return Promise.resolve();
    this.#finished = true;
    return notifyObserver(
      this.context,
      this.observer,
      Object.freeze({
        ...this.#reference,
        stage: "handoff" as const,
        result: Object.freeze(result),
      }),
      "delivery",
    );
  }

  failed(error: unknown): Promise<void> {
    if (this.#finished) return Promise.resolve();
    this.#finished = true;
    return notifyObserver(
      this.context,
      this.observer,
      Object.freeze({
        ...this.#reference,
        stage: "preparation-failed" as const,
        failure: Object.freeze({
          kind: "local" as const,
          phase: "request-preparation" as const,
          error,
        }),
      }),
      "delivery",
    );
  }
}

/** State owned by one outgoing invocation, never serialized into queues. */
export class OutboundBroadcastObservation<TContextData> {
  readonly #broadcastId = crypto.randomUUID();
  #finished = false;
  #phase: PreparationFailure["failure"]["phase"] = "unknown";
  #planning: PreparationFailure["planning"] = "not-started";
  #destinationCount = 0;

  readonly #onBroadcast: OutboundObservers<TContextData>["onBroadcast"];
  readonly #onDelivery: OutboundObservers<TContextData>["onDelivery"];
  readonly #deliveries = new Map<
    string,
    OutboundDeliveryObservation<TContextData>
  >();

  constructor(
    readonly context: Context<TContextData>,
    observers: OutboundObservers<TContextData>,
    readonly operation: OutboundBroadcastEvent["operation"],
  ) {
    this.#onBroadcast = observers.onBroadcast;
    this.#onDelivery = observers.onDelivery;
  }

  async planDestinations(
    inboxes: Readonly<Record<string, PlannedDestination>>,
  ): Promise<void> {
    this.planned(Object.keys(inboxes).length);
    if (this.#onDelivery == null) return;
    for (const [inbox, destination] of Object.entries(inboxes)) {
      this.#deliveries.set(
        inbox,
        new OutboundDeliveryObservation(
          this.context,
          this.#onDelivery,
          this.#broadcastId,
          inbox,
          destination,
        ),
      );
    }
    for (const delivery of this.#deliveries.values()) await delivery.planned();
  }

  delivery(
    inbox: string,
  ): OutboundDeliveryObservation<TContextData> | undefined {
    return this.#deliveries.get(inbox);
  }

  async enqueue<TResult>(
    entries: readonly {
      readonly inbox: string;
      readonly queueMessageId: string;
    }[],
    queue: "fanout" | "outbox",
    enqueue: () => Promise<TResult>,
  ): Promise<TResult> {
    let result: TResult;
    try {
      result = await enqueue();
    } catch (error) {
      await Promise.all(
        entries.map(({ inbox }) =>
          this.delivery(inbox)?.handoff({
            type: "enqueue-failed",
            acceptance: "unknown",
            error,
          })
        ),
      );
      throw error;
    }
    // Acceptance is established before unrelated metrics or logging can fail.
    await Promise.all(
      entries.map(({ inbox, queueMessageId }) =>
        this.delivery(inbox)?.handoff({
          type: "enqueued",
          queue,
          queueMessageId,
        })
      ),
    );
    return result;
  }

  setPhase(phase: PreparationFailure["failure"]["phase"]): void {
    this.#phase = phase;
    if (phase === "destination-planning") this.#planning = "incomplete";
  }

  planned(destinationCount: number): void {
    this.#planning = "complete";
    this.#destinationCount = destinationCount;
  }

  async planDestination(
    inbox: string,
    destination: PlannedDestination,
  ): Promise<void> {
    this.#destinationCount++;
    if (this.#onDelivery == null) return;
    const delivery = new OutboundDeliveryObservation(
      this.context,
      this.#onDelivery,
      this.#broadcastId,
      inbox,
      destination,
    );
    this.#deliveries.set(inbox, delivery);
    await delivery.planned();
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
      await this.failed(error);
      throw error;
    }
  }

  failed(error: unknown): Promise<void> {
    const failure: PreparationFailure["failure"] = {
      kind: this.#phase === "unknown" ? "unknown" : "local",
      phase: this.#phase,
      error,
    };
    return this.#finish(Object.freeze({
      type: "failed",
      failure: Object.freeze(failure),
      planning: this.#planning,
      plannedDestinationCount: this.#destinationCount,
    }));
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

  #notify(event: OutboundBroadcastEvent): Promise<void> {
    return notifyObserver(this.context, this.#onBroadcast, event, "broadcast");
  }
}

/** Observe preparation without changing the unobserved send's execution path. */
export function observeOutboundBroadcast<TContextData, TResult>(
  context: Context<TContextData>,
  observers: OutboundObservers<TContextData>,
  send: (
    observation?: OutboundBroadcastObservation<TContextData>,
  ) => Promise<TResult>,
  operation: OutboundBroadcastEvent["operation"] = "send",
): Promise<TResult> {
  if (observers.onBroadcast == null && observers.onDelivery == null) {
    return send();
  }
  return new OutboundBroadcastObservation(context, observers, operation).run(
    send,
  );
}
