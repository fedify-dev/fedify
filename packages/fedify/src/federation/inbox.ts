import { Activity, getTypeId } from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
import {
  context,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
  type TracerProvider,
} from "@opentelemetry/api";
import metadata from "../../deno.json" with { type: "json" };
import type { InboxErrorHandler, InboxListener } from "./callback.ts";
import type { Context, InboxContext } from "./context.ts";
import type {
  IdempotencyKeyCallback,
  IdempotencyStrategy,
} from "./federation.ts";
import type { KvKey, KvStore } from "./kv.ts";
import type { MessageQueue } from "./mq.ts";
import type { InboxMessage } from "./queue.ts";

export class InboxListenerSet<TContextData> {
  #listeners: Map<
    new (...args: unknown[]) => Activity,
    InboxListener<TContextData, Activity>
  >;

  constructor() {
    this.#listeners = new Map();
  }

  clone(): InboxListenerSet<TContextData> {
    const clone = new InboxListenerSet<TContextData>();
    clone.#listeners = new Map(this.#listeners);
    return clone;
  }

  add<TActivity extends Activity>(
    // deno-lint-ignore no-explicit-any
    type: new (...args: any[]) => TActivity,
    listener: InboxListener<TContextData, TActivity>,
  ): void {
    if (this.#listeners.has(type)) {
      throw new TypeError("Listener already set for this type.");
    }
    this.#listeners.set(
      type,
      listener as InboxListener<TContextData, Activity>,
    );
  }

  dispatchWithClass<TActivity extends Activity>(
    activity: TActivity,
  ): {
    // deno-lint-ignore no-explicit-any
    class: new (...args: any[]) => Activity;
    listener: InboxListener<TContextData, TActivity>;
  } | null {
    // deno-lint-ignore no-explicit-any
    let cls: new (...args: any[]) => Activity = activity
      // deno-lint-ignore no-explicit-any
      .constructor as unknown as new (...args: any[]) => Activity;
    const inboxListeners = this.#listeners;
    if (inboxListeners == null) {
      return null;
    }
    while (true) {
      if (inboxListeners.has(cls)) break;
      if (cls === Activity) return null;
      cls = globalThis.Object.getPrototypeOf(cls);
    }
    const listener = inboxListeners.get(cls)!;
    return { class: cls, listener };
  }

  dispatch<TActivity extends Activity>(
    activity: TActivity,
  ): InboxListener<TContextData, TActivity> | null {
    return this.dispatchWithClass(activity)?.listener ?? null;
  }
}

export interface RouteActivityParameters<TContextData> {
  context: Context<TContextData>;
  json: unknown;
  activity: Activity;
  recipient: string | null;
  inboxListeners?: InboxListenerSet<TContextData>;
  inboxContextFactory(
    recipient: string | null,
    activity: unknown,
    activityId: string | undefined,
    activityType: string,
  ): InboxContext<TContextData>;
  inboxErrorHandler?: InboxErrorHandler<TContextData>;
  kv: KvStore;
  kvPrefixes: { activityIdempotence: KvKey };
  queue?: MessageQueue;
  span: Span;
  tracerProvider?: TracerProvider;
  idempotencyStrategy?:
    | IdempotencyStrategy
    | IdempotencyKeyCallback<TContextData>;
}

export type RouteActivityResult =
  | "alreadyProcessed"
  | "missingActor"
  | "enqueued"
  | "unsupportedActivity"
  | "error"
  | "success";

export async function routeActivity<TContextData>(
  {
    context: ctx,
    json,
    activity,
    recipient,
    inboxListeners,
    inboxContextFactory,
    inboxErrorHandler,
    kv,
    kvPrefixes,
    queue,
    span,
    tracerProvider,
    idempotencyStrategy,
  }: RouteActivityParameters<TContextData>,
): Promise<RouteActivityResult> {
  const logger = getLogger(["fedify", "federation", "inbox"]);

  // Generate idempotency key based on strategy
  let cacheKey: KvKey | null = null;
  if (activity.id != null) {
    const inboxContext = inboxContextFactory(
      recipient,
      json,
      activity.id?.href,
      getTypeId(activity).href,
    );

    // Default to "per-inbox" strategy since Fedify 2.0.0.
    // (It had been "per-origin" in Fedify 1.x for backward compatibility.)
    const strategy = idempotencyStrategy ?? "per-inbox";

    let keyString: string | null;
    if (typeof strategy === "function") {
      // Custom callback strategy
      const result = await strategy(inboxContext, activity);
      keyString = result;
    } else {
      // Preset strategies
      switch (strategy) {
        case "global":
          // Global deduplication across all inboxes and inbox origins
          keyString = activity.id.href;
          break;
        case "per-origin":
          // Current behavior: deduplicate per inbox origin
          keyString = `${ctx.origin}\n${activity.id.href}`;
          break;
        case "per-inbox":
          // Standard ActivityPub behavior: deduplicate per inbox
          keyString = `${ctx.origin}\n${activity.id.href}\n${
            recipient == null ? "sharedInbox" : `inbox\n${recipient}`
          }`;
          break;
        default:
          // Should never happen due to TypeScript, but handle just in case
          keyString = `${ctx.origin}\n${activity.id.href}`;
      }
    }

    if (keyString != null) {
      cacheKey = [
        ...kvPrefixes.activityIdempotence,
        keyString,
      ] satisfies KvKey;
    }
  }
  if (cacheKey != null) {
    const cached = await kv.get(cacheKey);
    if (cached === true) {
      logger.debug("Activity {activityId} has already been processed.", {
        activityId: activity.id?.href,
        activity: json,
        recipient,
      });
      span.setStatus({
        code: SpanStatusCode.UNSET,
        message: `Activity ${activity.id?.href} has already been processed.`,
      });
      return "alreadyProcessed";
    }
  }
  if (activity.actorId == null) {
    logger.error("Missing actor.", { activity: json });
    span.setStatus({ code: SpanStatusCode.ERROR, message: "Missing actor." });
    return "missingActor";
  }
  span.setAttribute("activitypub.actor.id", activity.actorId.href);
  if (queue != null) {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    try {
      await queue.enqueue(
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: ctx.origin,
          activity: json,
          identifier: recipient,
          attempt: 0,
          started: new Date().toISOString(),
          traceContext: carrier,
        } satisfies InboxMessage,
      );
    } catch (error) {
      logger.error(
        "Failed to enqueue the incoming activity {activityId}:\n{error}",
        { error, activityId: activity.id?.href, activity: json, recipient },
      );
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message:
          `Failed to enqueue the incoming activity ${activity.id?.href}.`,
      });
      throw error;
    }
    logger.info(
      "Activity {activityId} is enqueued.",
      { activityId: activity.id?.href, activity: json, recipient },
    );
    return "enqueued";
  }
  tracerProvider = tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  return await tracer.startActiveSpan(
    "activitypub.dispatch_inbox_listener",
    { kind: SpanKind.INTERNAL },
    async (span) => {
      const dispatched = inboxListeners?.dispatchWithClass(activity!);
      if (dispatched == null) {
        logger.error(
          "Unsupported activity type:\n{activity}",
          { activity: json, recipient },
        );
        span.setStatus({
          code: SpanStatusCode.UNSET,
          message: `Unsupported activity type: ${getTypeId(activity!).href}`,
        });
        span.end();
        return "unsupportedActivity";
      }
      const { class: cls, listener } = dispatched;
      span.updateName(`activitypub.dispatch_inbox_listener ${cls.name}`);
      try {
        await listener(
          inboxContextFactory(
            recipient,
            json,
            activity?.id?.href,
            getTypeId(activity!).href,
          ),
          activity!,
        );
      } catch (error) {
        try {
          await inboxErrorHandler?.(ctx, error as Error);
        } catch (error) {
          logger.error(
            "An unexpected error occurred in inbox error handler:\n{error}",
            {
              error,
              activityId: activity!.id?.href,
              activity: json,
              recipient,
            },
          );
        }
        logger.error(
          "Failed to process the incoming activity {activityId}:\n{error}",
          {
            error,
            activityId: activity!.id?.href,
            activity: json,
            recipient,
          },
        );
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
        span.end();
        return "error";
      }
      if (cacheKey != null) {
        await kv.set(cacheKey, true, {
          ttl: Temporal.Duration.from({ days: 1 }),
        });
      }
      logger.info(
        "Activity {activityId} has been processed.",
        { activityId: activity!.id?.href, activity: json, recipient },
      );
      span.end();
      return "success";
    },
  );
}
