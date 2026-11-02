import {
  getOutboundProvenance,
  invocationProvenance,
  snapshotLocalContext,
  sourceLogContext,
} from "./outbound-provenance.ts";
import {
  isSpanContextValid,
  type Span,
  type SpanContext,
} from "@opentelemetry/api";
import { encodeHex } from "byte-encodings/hex";
import { getLogger, withContext } from "@logtape/logtape";
import type { Context } from "./context.ts";
import type {
  FanoutMessage,
  OutboxMessage,
  SerializedOutboundDelivery,
} from "./queue.ts";
import type {
  OutboundAttemptReport,
  OutboundBroadcastEvent,
  OutboundDeliveryEvent,
  OutboundHttpExchangeReport,
  OutboundObservers,
  OutboundPreparationResult,
  OutboundProvenance,
  OutboundWorkerReport,
} from "./outbound-report.ts";

type WithoutSource<T> = T extends unknown
  ? Omit<T, "provenance" | "local" | "observedAt" | "trace">
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

async function notifyObserver<
  TContextData,
  TEvent extends { readonly provenance: OutboundProvenance },
>(
  context: Context<TContextData>,
  callback:
    | ((context: Context<TContextData>, event: TEvent) => void | Promise<void>)
    | undefined,
  event: TEvent,
  unit: "broadcast" | "delivery" | "attempt" | "http-exchange" | "worker",
): Promise<void> {
  if (callback == null) return;
  try {
    await withContext(
      sourceLogContext(event.provenance),
      () => callback(context, event),
    );
  } catch (error) {
    logObserverFailure(unit, error);
  }
}

function logObserverFailure(unit: string, error: unknown): void {
  try {
    getLogger(["fedify", "federation", "outbox"]).error(
      "An unexpected error occurred in outbound {unit} observer:\n{error}",
      { unit, error },
    );
  } catch {
    // A logging sink must not replace the execution's result either.
  }
}

function snapshotTrace(
  span: Span,
  parentSpanContext?: SpanContext,
): OutboundBroadcastEvent["trace"] {
  const spanContext = span.spanContext();
  // A no-op tracer can return the parent's context instead of creating a span.
  if (
    !isSpanContextValid(spanContext) || spanContext.isRemote ||
    spanContext.traceId === parentSpanContext?.traceId &&
      spanContext.spanId === parentSpanContext.spanId
  ) return undefined;
  return Object.freeze({
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  });
}

type AttemptFailure = Extract<
  OutboundAttemptReport["outcome"],
  { type: "failed" }
>["failure"];
type AttemptFacts = Pick<
  OutboundAttemptReport,
  | "attemptId"
  | "inboxUrl"
  | "httpExchangeCount"
  | "observedAt"
  | "trace"
  | "outcome"
>;

type ExchangeFacts = Pick<
  OutboundHttpExchangeReport,
  | "attemptId"
  | "inboxUrl"
  | "exchangeIndex"
  | "observedAt"
  | "request"
  | "outcome"
>;

type AttemptResponse = OutboundAttemptReport["outcome"]["response"];
type FinalResponse = Extract<AttemptResponse, { type: "final" }>;
type ObservedResponse = Pick<FinalResponse, "exchangeIndex" | "metadata">;

/** State owned by one concrete send, never persisted in queue metadata. */
export class OutboundAttemptObservation {
  readonly #attemptId = crypto.randomUUID();
  readonly #failures: AttemptFailure[] = [];
  #response: AttemptResponse = Object.freeze({ type: "not-observed" });
  #finalResponse: FinalResponse | undefined;
  readonly #responses = new WeakMap<Response, ObservedResponse>();
  #trace: OutboundAttemptReport["trace"];
  #finished = false;
  #exchangeCount = 0;

  constructor(
    readonly inboxUrl: string,
    readonly report: (facts: AttemptFacts) => Promise<void>,
    readonly reportExchange:
      | ((facts: ExchangeFacts) => Promise<void>)
      | undefined = undefined,
  ) {}

  setSpan(span: Span, parentSpanContext?: SpanContext): void {
    this.#trace = snapshotTrace(span, parentSpanContext);
  }

  async fetch(
    request: Request,
    submit: () => Promise<Response>,
  ): Promise<Response> {
    const exchangeIndex = this.#exchangeCount++;
    const snapshot = Object.freeze({
      url: request.url,
      method: request.method,
    });
    let response: Response;
    try {
      response = await submit();
    } catch (error) {
      await this.#exchange(exchangeIndex, snapshot, { type: "failed", error });
      throw error;
    }
    const metadata = Object.freeze({
      status: response.status,
      statusText: response.statusText,
      ...(response.url === "" ? {} : { url: response.url }),
    });
    const observed = Object.freeze({ exchangeIndex, metadata });
    this.#responses.set(response, observed);
    this.#response = Object.freeze({
      type: "undetermined",
      lastObserved: observed,
    });
    await this.#exchange(exchangeIndex, snapshot, {
      type: "response",
      response: metadata,
    });
    return response;
  }

  #exchange(
    exchangeIndex: number,
    request: OutboundHttpExchangeReport["request"],
    outcome: OutboundHttpExchangeReport["outcome"],
  ): Promise<void> {
    return this.reportExchange?.({
      attemptId: this.#attemptId,
      inboxUrl: this.inboxUrl,
      exchangeIndex,
      observedAt: Temporal.Now.instant().epochMilliseconds,
      request,
      outcome: Object.freeze(outcome),
    }) ?? Promise.resolve();
  }

  response(response: Response, disposition: "final" | "intermediate"): void {
    const observed = this.#responses.get(response);
    if (observed == null) return;
    if (disposition === "final") {
      this.#finalResponse = Object.freeze({ type: "final", ...observed });
      this.#response = this.#finalResponse;
    } else {
      this.#response = Object.freeze({
        type: "intermediate-only",
        lastObserved: observed,
      });
    }
  }

  failure(failure: AttemptFailure): void {
    this.#failures.push(Object.freeze(failure));
  }

  unknown(error: unknown): void {
    if (
      !this.#failures.some((failure) =>
        failure.error === error || failure.phase !== "cleanup"
      )
    ) {
      this.failure({ kind: "unknown", phase: "unknown", error });
    }
  }

  succeeded(): Promise<void> {
    return this.#finish({ type: "succeeded", response: this.#finalResponse! });
  }

  failed(error: unknown): Promise<void> {
    let failure: AttemptFailure;
    let diagnostics: AttemptFailure[];
    if (
      this.#response.type === "final" &&
      (this.#response.metadata.status < 200 ||
        this.#response.metadata.status >= 300)
    ) {
      failure = this.#failures.find((failure) => failure.kind === "http") ??
        Object.freeze({ kind: "http", phase: "response" });
      diagnostics = this.#failures.filter((failure) => failure.kind !== "http");
    } else {
      failure = this.#failures.find((failure) => failure.phase !== "cleanup") ??
        this.#failures[0] ??
        Object.freeze({ kind: "unknown", phase: "unknown", error });
      diagnostics = this.#failures.filter((item) => item !== failure);
    }
    return this.#finish({
      type: "failed",
      failure,
      error,
      response: this.#response,
      ...(diagnostics.length === 0
        ? {}
        : { diagnostics: Object.freeze(diagnostics) }),
    });
  }

  #finish(outcome: OutboundAttemptReport["outcome"]): Promise<void> {
    if (this.#finished) return Promise.resolve();
    this.#finished = true;
    return this.report({
      attemptId: this.#attemptId,
      inboxUrl: this.inboxUrl,
      httpExchangeCount: this.#exchangeCount,
      observedAt: Temporal.Now.instant().epochMilliseconds,
      ...(this.#trace == null ? {} : { trace: this.#trace }),
      outcome: Object.freeze(outcome),
    });
  }
}

type AttemptIdentity = Pick<
  OutboundAttemptReport,
  "broadcast" | "deliveryId" | "destinationInbox" | "portableInbox"
>;

function snapshotOutboxIdentity(message: OutboxMessage): AttemptIdentity {
  return message.outbound == null
    ? Object.freeze({
      broadcast: Object.freeze({ type: "unknown" as const }),
      deliveryId: message.id,
      ...(message.portableInbox == null
        ? {}
        : { portableInbox: message.portableInbox }),
    })
    : snapshotDeliveryIdentity(message.outbound);
}

type WorkerPreparationFailure = Extract<
  OutboundWorkerReport["result"],
  { type: "preparation-failed" }
>["failure"];

type WorkerAction = NonNullable<OutboundWorkerReport["actions"]>[number];
type WorkerAbandonment = Extract<WorkerAction, { type: "abandoned" }>;

/** Per-execution state, independent of concrete attempt/exchange callbacks. */
export class OutboundWorkerObservation<TContextData> {
  #attemptsStarted = 0;
  #actions: WorkerAction[] | undefined;
  #trace: OutboundWorkerReport["trace"];
  #preparationFailure: WorkerPreparationFailure | undefined;
  readonly #queue: OutboundWorkerReport["queue"];
  readonly #delivery: AttemptIdentity | undefined;
  readonly #role: OutboundWorkerReport["role"];
  #currentContext: Context<TContextData> | undefined;

  constructor(
    readonly context: () => Context<TContextData>,
    readonly callback: OutboundObservers<TContextData>["onWorker"],
    message: FanoutMessage | OutboxMessage,
    readonly provenance: OutboundProvenance,
  ) {
    this.#role = message.type;
    this.#queue = Object.freeze({
      queueMessageId: message.id,
      ...(message.type === "outbox" ? { queueAttempt: message.attempt } : {}),
    });
    if (message.type === "outbox") {
      try {
        this.#delivery = snapshotOutboxIdentity(message);
      } catch {
        // Invalid optional grouping cannot change the worker's own execution.
        this.#delivery = undefined;
      }
    }
  }

  readonly attemptStarted: () => void = () => {
    this.#attemptsStarted++;
  };

  enableActions(): void {
    this.#actions ??= [];
  }

  async enqueue(
    action: "retry" | "defer",
    message: OutboxMessage,
    delay: Temporal.Duration,
    enqueue: () => Promise<void>,
  ): Promise<void> {
    if (this.#actions == null) return await enqueue();
    const facts = {
      action,
      queue: Object.freeze({
        queueMessageId: message.id,
        queueAttempt: message.attempt,
      }),
      inboxUrls: Object.freeze([message.inbox]),
      delay: delay.toString(),
    };
    try {
      await enqueue();
    } catch (error) {
      this.#actions.push(
        Object.freeze({
          type: "action-failed",
          ...facts,
          acceptance: "unknown" as const,
          error,
        }),
      );
      throw error;
    }
    this.#actions.push(Object.freeze({ type: "scheduled", ...facts }));
  }

  abandon(
    reason: WorkerAbandonment["reason"],
    inboxUrls: readonly string[],
  ): void {
    this.#actions?.push(
      Object.freeze({
        type: "abandoned",
        reason,
        inboxUrls: Object.freeze([...inboxUrls]),
      }),
    );
  }

  dropFailure(inboxUrls: readonly string[], error: unknown): void {
    this.#actions?.push(
      Object.freeze({
        type: "action-failed",
        action: "drop",
        inboxUrls: Object.freeze([...inboxUrls]),
        error,
      }),
    );
  }

  async drop(
    inboxUrls: readonly string[],
    operation: () => Promise<void>,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.dropFailure(inboxUrls, error);
      throw error;
    }
  }

  getContext(): Context<TContextData> {
    return this.#currentContext ??= this.context();
  }

  useContext(context: Context<TContextData>): void {
    this.#currentContext = context;
  }

  setSpan(span: Span, parentSpanContext?: SpanContext): void {
    this.#trace = snapshotTrace(span, parentSpanContext);
  }

  async prepare<TResult>(
    phase: WorkerPreparationFailure["phase"],
    operation: () => TResult | Promise<TResult>,
  ): Promise<TResult> {
    try {
      const result = await operation();
      this.#preparationFailure = undefined;
      return result;
    } catch (error) {
      this.#preparationFailure = Object.freeze({ kind: "local", phase, error });
      throw error;
    }
  }

  async run(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      await this.#notify(
        this.#preparationFailure == null ||
          !Object.is(this.#preparationFailure.error, error)
          ? { type: "failed", error }
          : {
            type: "preparation-failed",
            failure: this.#preparationFailure,
            error,
          },
      );
      throw error;
    }
    await this.#notify({ type: "completed" });
  }

  async #notify(result: OutboundWorkerReport["result"]): Promise<void> {
    const observedAt = Temporal.Now.instant().epochMilliseconds;
    try {
      const context = this.getContext();
      await notifyObserver(
        context,
        this.callback,
        Object.freeze({
          role: this.#role,
          queue: this.#queue,
          ...(this.#delivery == null ? {} : { delivery: this.#delivery }),
          attemptsStarted: this.#attemptsStarted,
          ...(this.#actions == null
            ? {}
            : { actions: Object.freeze([...this.#actions]) }),
          observedAt,
          ...(this.#trace == null ? {} : { trace: this.#trace }),
          provenance: this.provenance,
          local: snapshotLocalContext(context),
          result: Object.freeze(result),
        }),
        "worker",
      );
    } catch (error) {
      logObserverFailure("worker", error);
    }
  }
}

/** Selected callback and restored grouping, shared by concrete gateway attempts. */
export class OutboundAttemptObserver<TContextData> {
  readonly #queue: OutboundAttemptReport["queue"];

  constructor(
    readonly context: () => Context<TContextData>,
    readonly callback: OutboundObservers<TContextData>["onAttempt"],
    readonly identity: AttemptIdentity,
    readonly provenance: OutboundProvenance,
    queue?: OutboundAttemptReport["queue"],
    readonly onHttpExchange: OutboundObservers<TContextData>["onHttpExchange"] =
      undefined,
  ) {
    this.#queue = queue == null ? undefined : Object.freeze({ ...queue });
  }

  static resumeOutbox<TContextData>(
    context: () => Context<TContextData>,
    callback: OutboundObservers<TContextData>["onAttempt"],
    message: OutboxMessage,
    provenance: OutboundProvenance,
    onHttpExchange?: OutboundObservers<TContextData>["onHttpExchange"],
  ): OutboundAttemptObserver<TContextData> | undefined {
    if (callback == null && onHttpExchange == null) return undefined;
    const identity = snapshotOutboxIdentity(message);
    return new OutboundAttemptObserver(
      context,
      callback,
      identity,
      provenance,
      {
        queueMessageId: message.id,
        queueAttempt: message.attempt,
      },
      onHttpExchange,
    );
  }

  startAttempt(inboxUrl: string): OutboundAttemptObservation | undefined {
    if (this.callback == null && this.onHttpExchange == null) return undefined;
    const context = this.context();
    return new OutboundAttemptObservation(
      inboxUrl,
      (facts) =>
        notifyObserver(
          context,
          this.callback,
          Object.freeze({
            ...this.identity,
            ...facts,
            ...(this.#queue == null ? {} : { queue: this.#queue }),
            provenance: this.provenance,
            local: snapshotLocalContext(context),
          }),
          "attempt",
        ),
      (facts) =>
        notifyObserver(
          context,
          this.onHttpExchange,
          Object.freeze({
            ...this.identity,
            ...facts,
            ...(this.#queue == null ? {} : { queue: this.#queue }),
            provenance: this.provenance,
            local: snapshotLocalContext(context),
          }),
          "http-exchange",
        ),
    );
  }
}

/** One producer's destination, without callbacks or live inputs in queues. */
class OutboundDeliveryObservation<TContextData> {
  #finished = false;
  readonly #reference: SerializedOutboundDelivery;
  readonly #plan;
  readonly #attempts: OutboundAttemptObserver<TContextData>;

  constructor(
    readonly context: Context<TContextData>,
    readonly observer: OutboundObservers<TContextData>["onDelivery"],
    identity: SerializedOutboundDelivery,
    destination: PlannedDestination,
    readonly provenance: OutboundProvenance,
    readonly trace: OutboundBroadcastEvent["trace"],
    onAttempt: OutboundObservers<TContextData>["onAttempt"],
    onHttpExchange: OutboundObservers<TContextData>["onHttpExchange"],
    queue?: OutboundAttemptReport["queue"],
  ) {
    this.#reference = snapshotDeliveryIdentity(identity);
    this.#attempts = new OutboundAttemptObserver(
      () => this.context,
      onAttempt,
      this.#reference,
      this.provenance,
      queue,
      onHttpExchange,
    );
    this.#plan = Object.freeze({
      actorIds: Object.freeze(Array.from(destination.actorIds)),
      sharedInbox: destination.sharedInbox,
      mode: destination.mode ??
        (destination.portableInbox == null ? "ordinary" : "portable-fallback"),
    });
  }

  startAttempt(inboxUrl: string): OutboundAttemptObservation | undefined {
    return this.#attempts.startAttempt(inboxUrl);
  }

  get identity(): SerializedOutboundDelivery {
    return this.#reference;
  }

  planned(): Promise<void> {
    return notifyObserver(
      this.context,
      this.observer,
      Object.freeze({
        ...(this.trace == null ? {} : { trace: this.trace }),
        observedAt: Temporal.Now.instant().epochMilliseconds,
        provenance: this.provenance,
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
        ...(this.trace == null ? {} : { trace: this.trace }),
        observedAt: Temporal.Now.instant().epochMilliseconds,
        provenance: this.provenance,
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
        ...(this.trace == null ? {} : { trace: this.trace }),
        observedAt: Temporal.Now.instant().epochMilliseconds,
        provenance: this.provenance,
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
  #trace: OutboundBroadcastEvent["trace"];

  readonly #onBroadcast: OutboundObservers<TContextData>["onBroadcast"];
  readonly #onDelivery: OutboundObservers<TContextData>["onDelivery"];
  readonly #onAttempt: OutboundObservers<TContextData>["onAttempt"];
  readonly #onHttpExchange: OutboundObservers<TContextData>["onHttpExchange"];
  readonly #deliveries = new Map<
    string,
    OutboundDeliveryObservation<TContextData>
  >();

  constructor(
    readonly context: Context<TContextData>,
    observers: OutboundObservers<TContextData>,
    readonly operation: OutboundBroadcastEvent["operation"],
    readonly provenance: OutboundProvenance = getOutboundProvenance(context),
    broadcast: SerializedOutboundDelivery["broadcast"] = {
      type: "known",
      id: crypto.randomUUID(),
    },
    readonly queue: OutboundAttemptReport["queue"] = undefined,
  ) {
    this.#broadcast = broadcast;
    this.#onBroadcast = observers.onBroadcast;
    this.#onDelivery = observers.onDelivery;
    this.#onAttempt = observers.onAttempt;
    this.#onHttpExchange = observers.onHttpExchange;
  }

  /** Continue an existing fanout; do not emit a new broadcast invocation. */
  static async resumeFanout<TContextData>(
    context: Context<TContextData>,
    observers: OutboundObservers<TContextData>,
    message: FanoutMessage,
    span?: Span,
    parentSpanContext?: SpanContext,
  ): Promise<OutboundBroadcastObservation<TContextData> | undefined> {
    if (
      observers.onDelivery == null && observers.onAttempt == null &&
      observers.onHttpExchange == null &&
      !Object.values(message.inboxes).some((entry) => entry.outbound != null)
    ) {
      return undefined;
    }
    const observation = new OutboundBroadcastObservation(
      context,
      {
        onDelivery: observers.onDelivery,
        onAttempt: observers.onAttempt,
        onHttpExchange: observers.onHttpExchange,
      },
      "send",
      getOutboundProvenance(context),
      { type: "unknown" },
      { queueMessageId: message.id },
    );
    if (span != null) observation.setSpan(span, parentSpanContext);
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
      this.provenance,
      this.#trace,
      this.#onAttempt,
      this.#onHttpExchange,
      this.queue,
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

  /** Attach only the span supplied by this execution, never an ambient fallback. */
  setSpan(span: Span, parentSpanContext?: SpanContext): void {
    this.#trace = snapshotTrace(span, parentSpanContext);
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
      observation: OutboundBroadcastObservation<TContextData> | undefined,
      provenance: OutboundProvenance,
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
      return await send(this, this.provenance);
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
        ...(this.#trace == null ? {} : { trace: this.#trace }),
        observedAt: Temporal.Now.instant().epochMilliseconds,
        provenance: this.provenance,
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
    observation: OutboundBroadcastObservation<TContextData> | undefined,
    provenance: OutboundProvenance,
  ) => Promise<TResult>,
  operation: OutboundBroadcastEvent["operation"] = "send",
  dispatchId?: string,
): Promise<TResult> {
  let provenance: OutboundProvenance;
  let invalid: { error: unknown } | undefined;
  try {
    provenance = invocationProvenance(context, dispatchId);
  } catch (error) {
    provenance = invocationProvenance(context, undefined);
    invalid = { error };
  }
  const execute = async (
    observation?: OutboundBroadcastObservation<TContextData>,
  ) => {
    if (invalid != null) {
      observation?.setPhase("validation");
      throw invalid.error;
    }
    return await send(observation, provenance);
  };
  return withContext(sourceLogContext(provenance), () => {
    if (
      observers.onBroadcast == null && observers.onDelivery == null &&
      observers.onAttempt == null && observers.onHttpExchange == null
    ) {
      return execute();
    }
    return new OutboundBroadcastObservation(
      context,
      observers,
      operation,
      provenance,
    ).run(execute);
  });
}
