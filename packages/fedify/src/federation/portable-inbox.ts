import type { Actor } from "@fedify/vocab";
import {
  fromCompatibleEf61Id,
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
import type { HttpMessageSignaturesSpecDeterminer } from "../sig/http.ts";
import { exportJwk, validateCryptoKey } from "../sig/key.ts";
import {
  getCanonicalPortableId,
  getPortableDid,
  isPortableId,
  isPortableUri,
} from "../sig/portable-key-id.ts";
import type { PortableInboxForwardingOptions } from "./federation.ts";
import type { KvKey, KvStore } from "./kv.ts";
import { recordOutboxEnqueue } from "./metrics.ts";
import type { MessageQueue } from "./mq.ts";
import type { OutboxMessage, SenderKeyJwkPair } from "./queue.ts";
import { sendActivity, type SenderKeyPair } from "./send.ts";

/**
 * {@link PortableInboxForwardingOptions} with the defaults filled in.
 */
export interface ResolvedPortableInboxForwardingOptions {
  readonly maxTargets: number;
  readonly ttl: Temporal.Duration;
  readonly deadline: Temporal.Duration;
}

// The longest delay that setTimeout() supports:
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Fills in the defaults of {@link PortableInboxForwardingOptions} and
 * validates them.
 * @param options The options.
 * @returns The resolved options.
 * @throws {RangeError} If `maxTargets` is not a non-negative integer, if `ttl`
 *                      is not positive, if `deadline` is negative or longer
 *                      than 2,147,483,647 milliseconds (about 24.8 days), or
 *                      if either duration has calendar units, i.e., weeks,
 *                      months, or years, whose length depends on the date.
 */
export function resolvePortableInboxForwardingOptions(
  options: PortableInboxForwardingOptions = {},
): ResolvedPortableInboxForwardingOptions {
  const maxTargets = options.maxTargets ?? 10;
  if (!Number.isInteger(maxTargets) || maxTargets < 0) {
    throw new RangeError(
      "portableInboxForwarding.maxTargets must be a non-negative integer.",
    );
  }
  const ttl = Temporal.Duration.from(options.ttl ?? { days: 30 });
  // total() also rejects calendar units, whose length depends on the date:
  if (ttl.total("millisecond") <= 0) {
    throw new RangeError("portableInboxForwarding.ttl must be positive.");
  }
  const deadline = Temporal.Duration.from(options.deadline ?? { seconds: 10 });
  const deadlineMs = deadline.total("millisecond");
  // setTimeout() fires almost immediately for longer delays:
  if (deadlineMs < 0 || deadlineMs > MAX_TIMEOUT_MS) {
    throw new RangeError(
      "portableInboxForwarding.deadline must be between 0 and " +
        `${MAX_TIMEOUT_MS} milliseconds.`,
    );
  }
  return { maxTargets, ttl, deadline };
}

/**
 * The portable actor that owns a portable inbox and accepts deliveries through
 * this server.
 */
export interface PortableInboxRecipient {
  /**
   * The ID of the portable actor, either an `ap:` or `ap+ef61:` URI or
   * a compatible identifier.
   */
  readonly actorId: URL;
  /**
   * The portable ID of the portable inbox, e.g.,
   * `ap+ef61://did:key:.../inbox`, even if the actor's `inbox` is its
   * compatible identifier.
   */
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
  // The actor may be identified by a compatible identifier instead of an ap:
  // URI, as FEP-ef61 allows, in which case its inbox usually is one too:
  const id = actor.id;
  const did = id == null || !isPortableId(id) ? null : getPortableDid(id);
  if (id == null || did == null) {
    return { status: "rejected", reason: "notPortable" };
  }
  if (did !== authority) {
    return { status: "rejected", reason: "authorityMismatch" };
  }
  const inboxId = actor.inboxId == null ? null : toPortableUri(actor.inboxId);
  if (inboxId == null || getCanonicalPortableId(inboxId) !== canonicalInboxId) {
    return { status: "rejected", reason: "inboxMismatch" };
  }
  const gateways = actor.gateways;
  if (!gateways.some((g) => isGatewayUrl(g) && g.origin === localOrigin)) {
    return { status: "rejected", reason: "notGateway" };
  }
  return {
    status: "accepted",
    recipient: { actorId: id, inboxId, canonicalInboxId, gateways },
  };
}

/**
 * Gets the portable form of an `ap:` or `ap+ef61:` URI or a compatible
 * identifier, keeping its query.
 * @returns The portable URI, or `null` if the ID is neither, or is malformed.
 */
function toPortableUri(id: URL): URL | null {
  if (isPortableUri(id)) return id;
  try {
    return fromCompatibleEf61Id(id);
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
   * Gets this server's gateway key pairs for the portable actor, which sign
   * the forwarded requests with HTTP Signatures.  It is called only if the
   * activity is forwarded to any gateway.  If omitted, or it returns no
   * RSASSA-PKCS1-v1_5 key, the requests are not signed.
   */
  readonly getKeys?: () => Promise<readonly SenderKeyPair[]>;
  /** The spec determiner for signing forwarded requests with double-knocking. */
  readonly specDeterminer?: HttpMessageSignaturesSpecDeterminer;
  /** The forwarding options.  Defaults are used if omitted. */
  readonly options?: ResolvedPortableInboxForwardingOptions;
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
 * Forwarded requests are signed with HTTP Signatures by the RSA key among
 * {@link ForwardPortableInboxActivityParameters.getKeys}, if any, so that
 * servers requiring HTTP Signatures accept them, and are sent unsigned
 * otherwise.  Either way, the receiving gateways authenticate the activity by
 * its own proof.
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
  const { maxTargets, ttl } = parameters.options ??
    resolvePortableInboxForwardingOptions();
  if (kv.cas == null || maxTargets < 1) return [];
  // A compatible activity ID is canonicalized too, so that its equivalent
  // representations share the same forwarding claims:
  const canonicalActivityId = getCanonicalPortableId(activityId) ??
    activityId.href;
  const targets = getForwardingTargets(recipient, excludedOrigins);
  if (targets.length > maxTargets) {
    logger.warn(
      "The portable actor that owns the inbox {inbox} has more than " +
        "{max} other gateways; the activity {activityId} is forwarded only " +
        "to the first {max} of them.",
      {
        inbox: recipient.canonicalInboxId,
        activityId: activityId.href,
        max: maxTargets,
      },
    );
    targets.length = maxTargets;
  }
  const claimed: URL[] = [];
  for (const { gateway, inbox } of targets) {
    const key: KvKey = [
      ...kvPrefix,
      recipient.canonicalInboxId,
      canonicalActivityId,
      gateway,
    ];
    if (await kv.cas(key, undefined, true, { ttl })) {
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

/**
 * Resolves the key that signs forwarded requests: the first RSASSA-PKCS1-v1_5
 * key, as {@link sendActivity} signs requests only with such a key.  Since
 * the targets have already been claimed, the activity is forwarded unsigned
 * rather than not at all if the key cannot be resolved or used.
 */
async function resolveForwardingKey(
  { getKeys, activityId }: ForwardPortableInboxActivityParameters,
): Promise<SenderKeyPair | null> {
  if (getKeys == null) return null;
  const logger = getLogger(["fedify", "federation", "inbox"]);
  let key: SenderKeyPair | undefined;
  try {
    key = (await getKeys()).find((k) =>
      k.privateKey.algorithm.name === "RSASSA-PKCS1-v1_5"
    );
  } catch (error) {
    logger.error(
      "Failed to get the gateway keys to sign forwarded requests with; " +
        "forwarding activity {activityId} without HTTP Signatures:\n{error}",
      { activityId: activityId.href, error },
    );
    return null;
  }
  if (key == null) return null;
  try {
    validateCryptoKey(key.privateKey, "private");
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    logger.warn(
      "The gateway key {keyId} cannot sign forwarded requests; forwarding " +
        "activity {activityId} without HTTP Signatures:\n{error}",
      { keyId: key.keyId.href, activityId: activityId.href, error },
    );
    return null;
  }
  return key;
}

async function forwardImmediately(
  parameters: ForwardPortableInboxActivityParameters,
  inboxes: readonly URL[],
): Promise<void> {
  const {
    activity,
    activityId,
    activityType,
    allowPrivateAddress,
    specDeterminer,
    options,
    meterProvider,
    tracerProvider,
  } = parameters;
  const logger = getLogger(["fedify", "federation", "inbox"]);
  const deadline = (options ?? resolvePortableInboxForwardingOptions())
    .deadline.total("millisecond");
  // The deadline also covers resolving the key, which may be slow:
  const forwarding = resolveForwardingKey(parameters).then((key) =>
    Promise.all(inboxes.map((inbox) =>
      sendActivity({
        activity,
        activityId: activityId.href,
        activityType,
        keys: key == null ? [] : [key],
        inbox,
        allowPrivateAddress,
        specDeterminer,
        meterProvider,
        tracerProvider,
      }).catch((error) => {
        logger.error(
          "Failed to forward activity {activityId} to {inbox}; it will not " +
            "be forwarded to the inbox again:\n{error}",
          { activityId: activityId.href, inbox: inbox.href, error },
        );
      })
    ))
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    forwarding.then(() => false),
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
  parameters: ForwardPortableInboxActivityParameters,
  outboxQueue: MessageQueue,
  inboxes: readonly URL[],
): Promise<void> {
  const {
    activity,
    activityId,
    activityType,
    baseUrl,
    startQueue,
    meterProvider,
  } = parameters;
  const logger = getLogger(["fedify", "federation", "inbox"]);
  const key = await resolveForwardingKey(parameters);
  const keys: SenderKeyJwkPair[] = [];
  if (key != null) {
    try {
      keys.push({
        keyId: key.keyId.href,
        privateKey: await exportJwk(key.privateKey),
      });
    } catch (error) {
      logger.error(
        "Failed to export the gateway key {keyId}; forwarding activity " +
          "{activityId} without HTTP Signatures:\n{error}",
        { keyId: key.keyId.href, activityId: activityId.href, error },
      );
    }
  }
  startQueue?.();
  const started = new Date().toISOString();
  const traceContext: Record<string, string> = {};
  propagation.inject(context.active(), traceContext);
  await Promise.all(inboxes.map(async (inbox) => {
    const message: OutboxMessage = {
      type: "outbox",
      id: crypto.randomUUID(),
      baseUrl,
      keys,
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
