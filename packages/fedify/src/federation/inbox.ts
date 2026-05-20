import { getTypeId } from "@fedify/vocab";
import type { Activity } from "@fedify/vocab";
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
import type { InboxErrorHandler } from "./callback.ts";
import type { Context, InboxContext } from "./context.ts";
import type {
  IdempotencyKeyCallback,
  IdempotencyStrategy,
} from "./federation.ts";
import type { KvKey, KvStore } from "./kv.ts";
import type { MessageQueue } from "./mq.ts";
import type { InboxMessage } from "./queue.ts";
import type { ActivityListenerSet } from "./activity-listener.ts";

export interface RouteActivityParameters<TContextData> {
  context: Context<TContextData>;
  json: unknown;
  /**
   * The original activity payload to keep for queueing or for internal inbox
   * contexts that must preserve the sender's exact document.
   * @internal
   */
  originalJson?: unknown;
  /**
   * The normalized JSON-LD form of a signed inbox payload that Fedify already
   * compacted successfully while accepting it.  Queue workers can reuse this
   * producer-side parse cache later under stricter loader or network rules
   * without re-dereferencing remote custom contexts.
   *
   * When inbox work is queued, Fedify keeps this on the queued message itself
   * so workers can reuse the normalized representation without relying on
   * external sidecar lifecycles.  This cache is intentionally orthogonal to
   * {@link ldSignatureVerified}: fallback-authenticated signed traffic and
   * backlog messages from older producers may still need the normalized form
   * even though Linked Data Signatures were not the authentication path.
   */
  normalizedActivity?: unknown;
  /**
   * Whether the Linked Data Signature was actually verified before queueing.
   * This records authentication provenance separately from the optional
   * normalizedActivity parse cache so workers can distinguish verified LDS
   * replay from fallback-authenticated or legacy queued traffic.
   * @internal
   */
  ldSignatureVerified?: boolean;
  activity: Activity;
  recipient: string | null;
  inboxListeners?: ActivityListenerSet<InboxContext<TContextData>>;
  inboxContextFactory(
    recipient: string | null,
    activity: unknown,
    activityId: string | undefined,
    activityType: string,
  ): InboxContext<TContextData>;
  /**
   * An internal context factory for dispatching inbox listeners when Fedify
   * needs a different payload than the public low-level hook should see.
   * @internal
   */
  listenerInboxContextFactory?: (
    recipient: string | null,
    activity: unknown,
    activityId: string | undefined,
    activityType: string,
  ) => InboxContext<TContextData>;
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
    originalJson,
    normalizedActivity,
    ldSignatureVerified,
    activity,
    recipient,
    inboxListeners,
    inboxContextFactory,
    listenerInboxContextFactory,
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
          activity: originalJson ?? json,
          // Keep queued LDS inbox work self-contained.  This avoids depending
          // on external sidecar lifecycles across retries and redeliveries
          // while preserving the original payload for forwarding.
          ...(normalizedActivity == null ? {} : { normalizedActivity }),
          ...(ldSignatureVerified == null ? {} : { ldSignatureVerified }),
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
        const contextFactory = listenerInboxContextFactory ??
          inboxContextFactory;
        await listener(
          contextFactory(
            recipient,
            contextFactory === inboxContextFactory
              ? json
              : originalJson ?? json,
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
