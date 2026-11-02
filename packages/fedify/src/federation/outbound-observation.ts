import {
  getOutboundProvenance,
  snapshotLocalContext,
  withOutboundSource,
} from "./outbound-provenance.ts";
import { encodeHex } from "byte-encodings/hex";
import { getLogger } from "@logtape/logtape";
import type { Context } from "./context.ts";
import type { FanoutMessage, SerializedOutboundDelivery } from "./queue.ts";
import type {
  OutboundBroadcastEvent,
  OutboundDeliveryEvent,
  OutboundObservers,
  OutboundPreparationResult,
} from "./outbound-report.ts";

type WithoutSource<T> = T extends unknown ? Omit<T, "provenance" | "local">
  : never;

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

function snapshotDeliveryIdentity(
  identity: SerializedOutboundDelivery,
): SerializedOutboundDelivery {
  if (
    identity == null || typeof identity.deliveryId !== "string" ||
    identity.deliveryId.length < 1 ||
    typeof identity.destinationInbox !== "string" ||
    identity.destinationInbox.length < 1 ||
    identity.broadcast == null ||
    !(identity.broadcast.type === "unknown" ||
      identity.broadcast.type === "known" &&
        typeof identity.broadcast.id === "string" &&
        identity.broadcast.id.length > 0) ||
    !(identity.portableInbox == null ||
      typeof identity.portableInbox === "string")
  ) {
    throw new TypeError(
      "Invalid outbound delivery identity in queue metadata.",
    );
  }
  return Object.freeze({
    broadcast: Object.freeze(
      identity.broadcast.type === "known"
        ? { type: "known" as const, id: identity.broadcast.id }
        : { type: "unknown" as const },
    ),
    deliveryId: identity.deliveryId,
    destinationInbox: identity.destinationInbox,
    ...(identity.portableInbox == null
      ? {}
      : { portableInbox: identity.portableInbox }),
  });
}

async function legacyFanoutIdentity(
  taskId: string,
  inbox: string,
  portableInbox?: string,
): Promise<SerializedOutboundDelivery> {
  // A legacy task establishes destination obligations, not its originating
  // invocation. JSON tuple encoding keeps different task/destination pairs
  // unambiguous; hashing keeps the derived identity opaque and bounded.
  const bytes = new TextEncoder().encode(JSON.stringify([
    "fedify-legacy-fanout-delivery",
    taskId,
    inbox,
  ]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    broadcast: { type: "unknown" },
    deliveryId: `legacy-fanout:${encodeHex(new Uint8Array(digest))}`,
    destinationInbox: inbox,
    ...(portableInbox == null ? {} : { portableInbox }),
  };
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
    await withOutboundSource(context, () => callback(context, event));
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
  readonly #reference: SerializedOutboundDelivery;
  readonly #plan;

  constructor(
    readonly context: Context<TContextData>,
    readonly observer: OutboundObservers<TContextData>["onDelivery"],
    identity: SerializedOutboundDelivery,
    destination: PlannedDestination,
  ) {
    this.#reference = snapshotDeliveryIdentity(identity);
    this.#plan = Object.freeze({
      actorIds: Object.freeze(Array.from(destination.actorIds)),
      sharedInbox: destination.sharedInbox,
      mode: destination.mode ??
        (destination.portableInbox == null ? "ordinary" : "portable-fallback"),
    });
  }

  get identity(): SerializedOutboundDelivery {
    return this.#reference;
  }

  planned(): Promise<void> {
    return notifyObserver(
      this.context,
      this.observer,
      Object.freeze({
        provenance: getOutboundProvenance(this.context),
        local: snapshotLocalContext(this.context),
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
        provenance: getOutboundProvenance(this.context),
        local: snapshotLocalContext(this.context),
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
        provenance: getOutboundProvenance(this.context),
        local: snapshotLocalContext(this.context),
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
  readonly #broadcast: SerializedOutboundDelivery["broadcast"];
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
    broadcast: SerializedOutboundDelivery["broadcast"] = {
      type: "known",
      id: crypto.randomUUID(),
    },
  ) {
    this.#broadcast = broadcast;
    this.#onBroadcast = observers.onBroadcast;
    this.#onDelivery = observers.onDelivery;
  }

  /** Continue an existing fanout; do not emit a new broadcast invocation. */
  static async resumeFanout<TContextData>(
    context: Context<TContextData>,
    observers: OutboundObservers<TContextData>,
    message: FanoutMessage,
  ): Promise<OutboundBroadcastObservation<TContextData> | undefined> {
    if (
      observers.onDelivery == null &&
      !Object.values(message.inboxes).some((entry) => entry.outbound != null)
    ) {
      return undefined;
    }
    const observation = new OutboundBroadcastObservation(
      context,
      { onDelivery: observers.onDelivery },
      "send",
      { type: "unknown" },
    );
    observation.#finished = true;
    observation.planned(Object.keys(message.inboxes).length);
    for (const [inbox, destination] of Object.entries(message.inboxes)) {
      const identity = destination.outbound ??
        await legacyFanoutIdentity(
          message.id,
          inbox,
          destination.portableInbox,
        );
      observation.#deliveries.set(
        inbox,
        observation.#createDelivery(inbox, destination, identity),
      );
    }
    return observation;
  }

  #createDelivery(
    inbox: string,
    destination: PlannedDestination,
    identity?: SerializedOutboundDelivery,
  ): OutboundDeliveryObservation<TContextData> {
    return new OutboundDeliveryObservation(
      this.context,
      this.#onDelivery,
      identity ?? {
        broadcast: this.#broadcast,
        deliveryId: crypto.randomUUID(),
        destinationInbox: inbox,
        ...(destination.portableInbox == null
          ? {}
          : { portableInbox: destination.portableInbox }),
      },
      destination,
    );
  }

  continuation(
    inbox: string,
  ): { readonly outbound: SerializedOutboundDelivery } | undefined {
    const delivery = this.delivery(inbox);
    return delivery == null ? undefined : { outbound: delivery.identity };
  }

  async planDestinations(
    inboxes: Readonly<Record<string, PlannedDestination>>,
  ): Promise<void> {
    this.planned(Object.keys(inboxes).length);
    for (const [inbox, destination] of Object.entries(inboxes)) {
      if (!this.#deliveries.has(inbox)) {
        this.#deliveries.set(inbox, this.#createDelivery(inbox, destination));
      }
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
    const delivery = this.#createDelivery(inbox, destination);
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
    if (this.#broadcast.type === "known") {
      await this.#notify(Object.freeze({
        broadcastId: this.#broadcast.id,
        operation: this.operation,
        stage: "started",
      }));
    }
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
    if (this.#broadcast.type === "known") {
      await this.#notify(Object.freeze({
        broadcastId: this.#broadcast.id,
        operation: this.operation,
        stage: "preparation-finished",
        result,
      }));
    }
  }

  #notify(
    event: WithoutSource<OutboundBroadcastEvent>,
  ): Promise<void> {
    return notifyObserver(
      this.context,
      this.#onBroadcast,
      Object.freeze({
        ...event,
        provenance: getOutboundProvenance(this.context),
        local: snapshotLocalContext(this.context),
      }),
      "broadcast",
    );
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
    return withOutboundSource(context, () => send());
  }
  return withOutboundSource(
    context,
    () =>
      new OutboundBroadcastObservation(context, observers, operation).run(send),
  );
}
