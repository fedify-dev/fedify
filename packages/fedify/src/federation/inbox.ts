import { getTypeId } from "@fedify/vocab";
import type { Activity } from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
import {
  context,
  type MeterProvider,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
  type TracerProvider,
} from "@opentelemetry/api";
import metadata from "../../deno.json" with { type: "json" };
import { getAuthenticationOrigin } from "../sig/portable-key-id.ts";
import type { InboxErrorHandler } from "./callback.ts";
import type { Context, InboxContext } from "./context.ts";
import type {
  IdempotencyKeyCallback,
  IdempotencyStrategy,
} from "./federation.ts";
import type { KvKey, KvStore } from "./kv.ts";
import type { MessageQueue } from "./mq.ts";
import type { InboxMessage } from "./queue.ts";
import {
  getEffectivePrincipals,
  type InboxAuthenticationEvidence,
  type InboxPrincipal,
  serializeAuthentication,
} from "./inbox-authentication.ts";
import type { SerializedVerifiedActivityView } from "./inbox-view.ts";
import type { ActivityListenerSet } from "./activity-listener.ts";
import {
  getDurationMs,
  getFederationMetrics,
  recordInboxActivity,
} from "./metrics.ts";

/**
 * Checks whether an activity's ID and all of its actor IDs have the same
 * [FEP-fe34] origin.  Activities without an ID have no origin to authenticate.
 *
 * Origins are compared by `getAuthenticationOrigin()`, so a portable activity
 * and its portable actors, including compatible identifiers on any gateway,
 * are compared by their DIDs.  An ID that has no supported origin, such as an
 * opaque URN, never matches.
 *
 * The caller is responsible for rejecting a missing primary actor ID before
 * relying on this check.
 *
 * [FEP-fe34]: https://w3id.org/fep/fe34
 * @internal
 */
export function actorsHaveSameOrigin(activity: Activity): boolean {
  if (activity.id == null) return true;
  const origin = getAuthenticationOrigin(activity.id);
  return origin != null &&
    activity.actorIds.every((actor) =>
      getAuthenticationOrigin(actor) === origin
    );
}

/**
 * Metadata that Fedify passes to an inbox context factory along with the
 * activity.
 * @internal
 */
export interface InboxContextMetadata {
  readonly authentication?: InboxAuthenticationEvidence;
}

/**
 * A factory of inbox contexts.
 * @internal
 */
export type InboxContextFactory<TContextData> = (
  recipient: string | null,
  activity: unknown,
  activityId: string | undefined,
  activityType: string,
  metadata?: InboxContextMetadata,
) => InboxContext<TContextData>;

/**
 * The headroom that the size check of a queued inbox message leaves for the
 * fields that grow when Fedify retries the message, e.g., its attempt count.
 */
const QUEUED_MESSAGE_HEADROOM = 64;

/**
 * Computes the idempotency key of an incoming activity.
 * @returns The key, or `null` if the activity is not deduplicated.
 * @internal
 */
export async function getInboxIdempotencyKey<TContextData>(
  strategy:
    | IdempotencyStrategy
    | IdempotencyKeyCallback<TContextData>
    | undefined,
  inboxContext: () => InboxContext<TContextData>,
  activity: Activity,
  origin: string,
  recipient: string | null,
  prefix: KvKey,
): Promise<KvKey | null> {
  if (activity.id == null) return null;
  // Default to "per-inbox" strategy since Fedify 2.0.0.
  // (It had been "per-origin" in Fedify 1.x for backward compatibility.)
  strategy ??= "per-inbox";
  let keyString: string | null;
  if (typeof strategy === "function") {
    // Custom callback strategy
    keyString = await strategy(inboxContext(), activity);
  } else {
    // Preset strategies
    switch (strategy) {
      case "global":
        // Global deduplication across all inboxes and inbox origins
        keyString = activity.id.href;
        break;
      case "per-origin":
        // Current behavior: deduplicate per inbox origin
        keyString = `${origin}\n${activity.id.href}`;
        break;
      case "per-inbox":
        // Standard ActivityPub behavior: deduplicate per inbox
        keyString = `${origin}\n${activity.id.href}\n${
          recipient == null ? "sharedInbox" : `inbox\n${recipient}`
        }`;
        break;
      default:
        // Should never happen due to TypeScript, but handle just in case
        keyString = `${origin}\n${activity.id.href}`;
    }
  }
  return keyString == null ? null : [...prefix, keyString] satisfies KvKey;
}

/**
 * Checks whether an incoming activity has already been processed, by its
 * idempotency key, or by the key that queue workers of older versions of
 * Fedify recorded.
 * @internal
 */
export async function isInboxActivityProcessed(
  kv: KvStore,
  cacheKey: KvKey | null,
  activity: Activity,
  origin: string,
  prefix: KvKey,
): Promise<boolean> {
  if (cacheKey == null) return false;
  if (await kv.get(cacheKey) === true) return true;
  if (activity.id == null) return false;
  return await kv.get([...prefix, origin, activity.id.href]) === true;
}

/**
 * The bytes added to the UTF-8 JSON length of a message for each of its JSON
 * values, to bound the size of serialization formats other than JSON, such
 * as the structured serialization of Deno KV, which spends more bytes than
 * JSON on type tags and lengths of small values, e.g., empty arrays, and up
 * to nine bytes on a fractional number that JSON writes in three.
 */
const PER_VALUE_SERIALIZATION_OVERHEAD = 8;

/**
 * Estimates, conservatively, how large a queued message is once a queue
 * backend serializes it: the UTF-8 length of its JSON serialization, plus
 * a fixed overhead for each JSON value in it, plus the bytes that encoding
 * strings beyond Latin-1 as UTF-16 adds.
 * @internal
 */
export function estimateQueuedMessageSize(message: unknown): number {
  const encoder = new TextEncoder();
  let values = 0;
  let stringExpansion = 0;
  // A string with any character beyond Latin-1 may be serialized as UTF-16,
  // i.e., two bytes for every character, including ASCII ones, which UTF-8
  // encodes in one byte:
  const countString = (value: string): void => {
    values++;
    if (!/[\u0100-\uffff]/.test(value)) return;
    const expansion = value.length * 2 - encoder.encode(value).byteLength;
    if (expansion > 0) stringExpansion += expansion;
  };
  const count = (value: unknown): void => {
    if (typeof value === "string") {
      countString(value);
      return;
    }
    values++;
    if (Array.isArray(value)) {
      for (const item of value) count(item);
    } else if (value != null && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined) continue;
        countString(key);
        count(item);
      }
    }
  };
  count(message);
  return encoder.encode(JSON.stringify(message)).byteLength +
    stringExpansion + values * PER_VALUE_SERIALIZATION_OVERHEAD;
}

/**
 * Checks whether an activity that declares no actor is authenticated: at
 * least one principal must be authenticated for it, and its ID, if any, must
 * have the same [FEP-fe34] origin as one of those principals.
 *
 * [FEP-fe34]: https://w3id.org/fep/fe34
 * @returns `"ok"` if it is authenticated, or why it is not.
 * @internal
 */
export function checkActorlessActivity(
  activity: Activity,
  authentication: InboxAuthenticationEvidence,
):
  | { readonly status: "ok"; readonly principals: readonly InboxPrincipal[] }
  | {
    readonly status: "noAuthenticatedPrincipal" | "activityOriginMismatch";
    readonly principals: readonly InboxPrincipal[];
  } {
  const principals = getEffectivePrincipals(authentication);
  if (principals.length < 1) {
    return { status: "noAuthenticatedPrincipal", principals };
  }
  if (activity.id == null) return { status: "ok", principals };
  const origin = getAuthenticationOrigin(activity.id);
  if (
    origin == null ||
    !principals.some((principal) =>
      getAuthenticationOrigin(principal.id) === origin
    )
  ) {
    return { status: "activityOriginMismatch", principals };
  }
  return { status: "ok", principals };
}

/**
 * Same as {@link checkActorlessActivity}, but returns a boolean.
 * @internal
 */
export function isActorlessActivityAuthenticated(
  activity: Activity,
  authentication: InboxAuthenticationEvidence,
): boolean {
  return checkActorlessActivity(activity, authentication).status === "ok";
}

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
  /**
   * Who was authenticated for the activity.
   * @internal
   */
  authentication?: InboxAuthenticationEvidence;
  /**
   * The interpretation of the activity that was authenticated, to replay in
   * queue workers.
   * @internal
   */
  verifiedView?: SerializedVerifiedActivityView;
  /**
   * Whether the activity declares no actor and has been admitted for
   * a listener that allows such activities.
   * @internal
   */
  actorless?: boolean;
  activity: Activity;
  recipient: string | null;
  inboxListeners?: ActivityListenerSet<InboxContext<TContextData>>;
  inboxContextFactory: InboxContextFactory<TContextData>;
  /**
   * An internal context factory for dispatching inbox listeners when Fedify
   * needs a different payload than the public low-level hook should see.
   * @internal
   */
  listenerInboxContextFactory?: InboxContextFactory<TContextData>;
  inboxErrorHandler?: InboxErrorHandler<TContextData>;
  kv: KvStore;
  kvPrefixes: { activityIdempotence: KvKey };
  queue?: MessageQueue;
  span: Span;
  /**
   * The meter provider for recording metrics.
   * @since 2.3.0
   */
  meterProvider?: MeterProvider;
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
    authentication,
    verifiedView,
    actorless,
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
    meterProvider,
    tracerProvider,
    idempotencyStrategy,
  }: RouteActivityParameters<TContextData>,
): Promise<RouteActivityResult> {
  const logger = getLogger(["fedify", "federation", "inbox"]);

  if (activity.actorId == null && !actorless) {
    logger.error("Missing actor.", { activity: json });
    span.setStatus({ code: SpanStatusCode.ERROR, message: "Missing actor." });
    recordInboxActivity(meterProvider, "rejected", getTypeId(activity).href);
    return "missingActor";
  }

  const contextMetadata = { authentication };
  const cacheKey = await getInboxIdempotencyKey(
    idempotencyStrategy,
    () =>
      inboxContextFactory(
        recipient,
        json,
        activity.id?.href,
        getTypeId(activity).href,
        contextMetadata,
      ),
    activity,
    ctx.origin,
    recipient,
    kvPrefixes.activityIdempotence,
  );
  if (
    await isInboxActivityProcessed(
      kv,
      cacheKey,
      activity,
      ctx.origin,
      kvPrefixes.activityIdempotence,
    )
  ) {
    logger.debug("Activity {activityId} has already been processed.", {
      activityId: activity.id?.href,
      activity: json,
      recipient,
    });
    span.setStatus({
      code: SpanStatusCode.UNSET,
      message: `Activity ${activity.id?.href} has already been processed.`,
    });
    recordInboxActivity(
      meterProvider,
      "rejected",
      getTypeId(activity).href,
    );
    return "alreadyProcessed";
  }
  if (activity.actorId != null) {
    span.setAttribute("activitypub.actor.id", activity.actorId.href);
  }
  let message: InboxMessage | undefined;
  if (queue != null) {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    message = {
      type: "inbox",
      id: crypto.randomUUID(),
      baseUrl: ctx.origin,
      activity: originalJson ?? json,
      // Keep queued LDS inbox work self-contained.  This avoids depending
      // on external sidecar lifecycles across retries and redeliveries
      // while preserving the original payload for forwarding.
      ...(normalizedActivity == null ? {} : { normalizedActivity }),
      ...(ldSignatureVerified == null ? {} : { ldSignatureVerified }),
      // The interpretation and the principals that were authenticated travel
      // with the message, so that workers and retries neither load contexts
      // again nor lose who was authenticated:
      ...(verifiedView == null ? {} : { verifiedView }),
      ...(authentication == null
        ? {}
        : { authentication: serializeAuthentication(authentication) }),
      identifier: recipient,
      attempt: 0,
      started: new Date().toISOString(),
      traceContext: carrier,
    } satisfies InboxMessage;
    const maxMessageSize = queue.maxMessageSize;
    if (
      maxMessageSize != null &&
      estimateQueuedMessageSize(message) >
        maxMessageSize - QUEUED_MESSAGE_HEADROOM
    ) {
      // The queue could not hold the message, so the activity is processed
      // right away instead, as if there were no queue.  This is decided
      // before responding, so that the sender is told whether it succeeded:
      logger.warn(
        "The incoming activity {activityId} is too large to enqueue; " +
          "processing it immediately instead.",
        { activityId: activity.id?.href, recipient, maxMessageSize },
      );
      message = undefined;
    }
  }
  if (queue != null && message != null) {
    try {
      await queue.enqueue(message);
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
    getFederationMetrics(meterProvider).recordQueueTaskEnqueued(
      { role: "inbox", queue, activityType: getTypeId(activity).href },
      0,
    );
    recordInboxActivity(meterProvider, "queued", getTypeId(activity).href);
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
      const dispatched = inboxListeners?.dispatchWithClass(activity);
      if (dispatched == null) {
        logger.error(
          "Unsupported activity type:\n{activity}",
          { activity: json, recipient },
        );
        span.setStatus({
          code: SpanStatusCode.UNSET,
          message: `Unsupported activity type: ${getTypeId(activity).href}`,
        });
        recordInboxActivity(
          meterProvider,
          "rejected",
          getTypeId(activity).href,
        );
        span.end();
        return "unsupportedActivity";
      }
      const { class: cls, listener } = dispatched;
      span.updateName(`activitypub.dispatch_inbox_listener ${cls.name}`);
      try {
        const activityType = getTypeId(activity).href;
        const started = performance.now();
        try {
          const contextFactory = listenerInboxContextFactory ??
            inboxContextFactory;
          await listener(
            contextFactory(
              recipient,
              contextFactory === inboxContextFactory
                ? json
                : originalJson ?? json,
              activity.id?.href,
              activityType,
              contextMetadata,
            ),
            activity,
          );
        } finally {
          getFederationMetrics(meterProvider).recordInboxProcessingDuration(
            activityType,
            getDurationMs(started),
          );
        }
      } catch (error) {
        try {
          await inboxErrorHandler?.(ctx, error as Error);
        } catch (error) {
          logger.error(
            "An unexpected error occurred in inbox error handler:\n{error}",
            {
              error,
              activityId: activity.id?.href,
              activity: json,
              recipient,
            },
          );
        }
        logger.error(
          "Failed to process the incoming activity {activityId}:\n{error}",
          {
            error,
            activityId: activity.id?.href,
            activity: json,
            recipient,
          },
        );
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
        recordInboxActivity(
          meterProvider,
          "rejected",
          getTypeId(activity).href,
        );
        span.end();
        return "error";
      }
      recordInboxActivity(
        meterProvider,
        "processed",
        getTypeId(activity).href,
      );
      if (cacheKey != null) {
        await kv.set(cacheKey, true, {
          ttl: Temporal.Duration.from({ days: 1 }),
        });
      }
      logger.info(
        "Activity {activityId} has been processed.",
        { activityId: activity.id?.href, activity: json, recipient },
      );
      span.end();
      return "success";
    },
  );
}
