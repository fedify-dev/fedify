import type { Actor } from "@fedify/vocab";
import {
  canonicalizePortableUri,
  formatIri,
  getFe34Origin,
  isGatewayUrl,
  toCompatibleEf61Id,
} from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import {
  context,
  type MeterProvider,
  propagation,
  type TracerProvider,
} from "@opentelemetry/api";
import type { KvKey, KvStore } from "./kv.ts";
import { recordOutboxEnqueue } from "./metrics.ts";
import type { MessageQueue } from "./mq.ts";
import type { OutboxMessage } from "./queue.ts";
import { sendActivity } from "./send.ts";

/**
 * How long Fedify remembers that it has forwarded an activity from
 * a portable inbox to a gateway.
 */
export const PORTABLE_INBOX_FORWARDING_TTL: Temporal.Duration = Temporal
  .Duration.from({ days: 30 });

/**
 * The maximum number of other gateways that a single delivery to a portable
 * inbox is forwarded to.
 */
export const MAX_PORTABLE_INBOX_FORWARDING_TARGETS = 10;

/**
 * How long Fedify waits for immediate forwarding requests, which are made when
 * no outbox queue is configured, before responding to the delivery.
 */
export const PORTABLE_INBOX_FORWARDING_DEADLINE_MS = 10_000;

/**
 * The portable actor that owns a portable inbox and accepts deliveries through
 * this server.
 */
export interface PortableInboxRecipient {
  /** The ID of the portable inbox, e.g., `ap+ef61://did:key:.../inbox`. */
  readonly inboxId: URL;
  /** The canonical form of {@link inboxId}. */
  readonly canonicalInboxId: string;
  /** The gateways of the portable actor. */
  readonly gateways: readonly URL[];
}

/**
 * The result of {@link resolvePortableInboxRecipient}.
 */
export type PortableInboxResolution =
  | { readonly status: "accepted"; readonly recipient: PortableInboxRecipient }
  | {
    readonly status: "rejected";
    readonly reason:
      | "notFound"
      | "notPortable"
      | "authorityMismatch"
      | "inboxMismatch"
      | "notGateway";
  };

/**
 * Decides whether this server accepts a delivery to a portable inbox on behalf
 * of the given actor, which the actor dispatcher returned for the identifier
 * in the requested inbox path.
 *
 * The actor document comes from the application, so it is trusted as is and
 * its proof is not verified here.
 * @param actor The actor the actor dispatcher returned.
 * @param options The requested DID, the canonical form of the requested inbox
 *                ID, and the origin of this server.
 * @returns The resolution.
 */
export function resolvePortableInboxRecipient(
  actor: Actor | null,
  { authority, canonicalInboxId, localOrigin }: {
    authority: string;
    canonicalInboxId: string;
    localOrigin: string;
  },
): PortableInboxResolution {
  if (actor == null) return { status: "rejected", reason: "notFound" };
  const id = actor.id;
  if (id == null || (id.protocol !== "ap:" && id.protocol !== "ap+ef61:")) {
    return { status: "rejected", reason: "notPortable" };
  }
  if (!isSameAuthority(id, authority)) {
    return { status: "rejected", reason: "authorityMismatch" };
  }
  const inboxId = actor.inboxId;
  if (inboxId == null || canonicalize(inboxId) !== canonicalInboxId) {
    return { status: "rejected", reason: "inboxMismatch" };
  }
  const gateways = actor.gateways;
  if (!gateways.some((g) => isGatewayUrl(g) && g.origin === localOrigin)) {
    return { status: "rejected", reason: "notGateway" };
  }
  return {
    status: "accepted",
    recipient: { inboxId, canonicalInboxId, gateways },
  };
}

function isSameAuthority(id: URL, authority: string): boolean {
  try {
    return getFe34Origin(id) === authority;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

function canonicalize(iri: URL | string): string | null {
  try {
    return canonicalizePortableUri(
      typeof iri === "string" ? iri : formatIri(iri),
    );
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

/**
 * Parameters for {@link forwardPortableInboxActivity}.
 */
export interface ForwardPortableInboxActivityParameters {
  /** The portable inbox that received the activity. */
  readonly recipient: PortableInboxRecipient;
  /** The received activity, exactly as it was received. */
  readonly activity: unknown;
  /** The ID of the activity. */
  readonly activityId: URL;
  /** The qualified URI of the activity type. */
  readonly activityType: string;
  /**
   * The origins of this server, which are never forwarded to, i.e., its
   * canonical origin and the origin of the request.
   */
  readonly excludedOrigins: readonly string[];
  /** The origin of this server, used for queued messages. */
  readonly baseUrl: string;
  readonly kv: KvStore;
  /** The key prefix of forwarding claims. */
  readonly kvPrefix: KvKey;
  readonly outboxQueue?: MessageQueue;
  /** Starts the queue unless it is started manually. */
  readonly startQueue?: () => void;
  readonly allowPrivateAddress?: boolean;
  /**
   * How long to wait for immediate forwarding requests in milliseconds.
   * Defaults to {@link PORTABLE_INBOX_FORWARDING_DEADLINE_MS}.
   */
  readonly deadline?: number;
  readonly meterProvider?: MeterProvider;
  readonly tracerProvider?: TracerProvider;
}

/**
 * Forwards an activity received in a portable inbox to the inboxes of the same
 * portable actor on its other gateways, as FEP-ef61 recommends.
 *
 * FEP-ef61 forbids forwarding an activity from an inbox more than once, so
 * each target gateway is claimed with an atomic compare-and-swap before the
 * activity is handed off, and a claim is never released, even if the hand-off
 * fails, since a failed hand-off does not prove that nothing was delivered.
 * Forwarding is therefore best effort.  Without {@link KvStore.cas}, nothing is
 * forwarded.
 *
 * Forwarded requests are not signed with HTTP Signatures; the receiving
 * gateways authenticate the activity by its own proof.
 * @param parameters The parameters.
 * @returns The target inbox URLs that the activity was handed off to.
 */
export async function forwardPortableInboxActivity(
  parameters: ForwardPortableInboxActivityParameters,
): Promise<URL[]> {
  const logger = getLogger(["fedify", "federation", "inbox"]);
  const {
    recipient,
    activityId,
    excludedOrigins,
    kv,
    kvPrefix,
    outboxQueue,
  } = parameters;
  if (kv.cas == null) return [];
  const canonicalActivityId = canonicalize(activityId) ?? activityId.href;
  const targets = getForwardingTargets(recipient, excludedOrigins);
  if (targets.length > MAX_PORTABLE_INBOX_FORWARDING_TARGETS) {
    logger.warn(
      "The portable actor that owns the inbox {inbox} has more than " +
        "{max} other gateways; the activity {activityId} is forwarded only " +
        "to the first {max} of them.",
      {
        inbox: recipient.canonicalInboxId,
        activityId: activityId.href,
        max: MAX_PORTABLE_INBOX_FORWARDING_TARGETS,
      },
    );
    targets.length = MAX_PORTABLE_INBOX_FORWARDING_TARGETS;
  }
  const claimed: URL[] = [];
  for (const { gateway, inbox } of targets) {
    const key: KvKey = [
      ...kvPrefix,
      recipient.canonicalInboxId,
      canonicalActivityId,
      gateway,
    ];
    if (
      await kv.cas(key, undefined, true, { ttl: PORTABLE_INBOX_FORWARDING_TTL })
    ) {
      claimed.push(inbox);
    }
  }
  if (claimed.length < 1) return [];
  logger.debug(
    "Forwarding activity {activityId} from the portable inbox {inbox} to " +
      "other gateways:\n{targets}",
    {
      activityId: activityId.href,
      inbox: recipient.canonicalInboxId,
      targets: claimed.map((t) => t.href),
    },
  );
  if (outboxQueue == null) {
    await forwardImmediately(parameters, claimed);
  } else {
    await enqueueForwarding(parameters, outboxQueue, claimed);
  }
  return claimed;
}

function getForwardingTargets(
  recipient: PortableInboxRecipient,
  excludedOrigins: readonly string[],
): { gateway: string; inbox: URL }[] {
  const logger = getLogger(["fedify", "federation", "inbox"]);
  const seen = new Set<string>(excludedOrigins);
  const targets: { gateway: string; inbox: URL }[] = [];
  for (const gateway of recipient.gateways) {
    if (!isGatewayUrl(gateway) || seen.has(gateway.origin)) continue;
    seen.add(gateway.origin);
    let inbox: URL;
    try {
      inbox = toCompatibleEf61Id(recipient.inboxId, gateway.origin);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      logger.warn(
        "Cannot forward to the gateway {gateway}, as the portable inbox " +
          "{inbox} cannot be represented as its compatible identifier.",
        { gateway: gateway.origin, inbox: recipient.canonicalInboxId },
      );
      continue;
    }
    targets.push({ gateway: gateway.origin, inbox });
  }
  return targets;
}

async function forwardImmediately(
  {
    activity,
    activityId,
    activityType,
    allowPrivateAddress,
    deadline = PORTABLE_INBOX_FORWARDING_DEADLINE_MS,
    meterProvider,
    tracerProvider,
  }: ForwardPortableInboxActivityParameters,
  inboxes: readonly URL[],
): Promise<void> {
  const logger = getLogger(["fedify", "federation", "inbox"]);
  const sends = inboxes.map((inbox) =>
    sendActivity({
      activity,
      activityId: activityId.href,
      activityType,
      keys: [],
      inbox,
      allowPrivateAddress,
      meterProvider,
      tracerProvider,
    }).catch((error) => {
      logger.error(
        "Failed to forward activity {activityId} to {inbox}; it will not " +
          "be forwarded to the inbox again:\n{error}",
        { activityId: activityId.href, inbox: inbox.href, error },
      );
    })
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    Promise.all(sends).then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), deadline);
    }),
  ]);
  clearTimeout(timer);
  if (timedOut) {
    logger.warn(
      "Forwarding activity {activityId} to other gateways did not finish " +
        "in {deadline} ms; responding to the delivery without waiting for it.",
      { activityId: activityId.href, deadline },
    );
  }
}

async function enqueueForwarding(
  {
    activity,
    activityId,
    activityType,
    baseUrl,
    startQueue,
    meterProvider,
  }: ForwardPortableInboxActivityParameters,
  outboxQueue: MessageQueue,
  inboxes: readonly URL[],
): Promise<void> {
  const logger = getLogger(["fedify", "federation", "inbox"]);
  startQueue?.();
  const started = new Date().toISOString();
  const traceContext: Record<string, string> = {};
  propagation.inject(context.active(), traceContext);
  await Promise.all(inboxes.map(async (inbox) => {
    const message: OutboxMessage = {
      type: "outbox",
      id: crypto.randomUUID(),
      baseUrl,
      keys: [],
      activity,
      activityId: activityId.href,
      activityType,
      inbox: inbox.href,
      sharedInbox: false,
      started,
      attempt: 0,
      headers: {},
      traceContext,
    };
    try {
      await outboxQueue.enqueue(message);
    } catch (error) {
      logger.error(
        "Failed to enqueue activity {activityId} to forward to {inbox}; it " +
          "will not be forwarded to the inbox again:\n{error}",
        { activityId: activityId.href, inbox: inbox.href, error },
      );
      return;
    }
    recordOutboxEnqueue(meterProvider, outboxQueue, message);
  }));
}
