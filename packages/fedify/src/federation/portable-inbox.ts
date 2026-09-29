import type { Actor, CryptographicKey } from "@fedify/vocab";
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
import type {
  HttpMessageSignaturesSpecDeterminer,
  RequestSignature,
} from "../sig/http.ts";
import { exportJwk, validateCryptoKey } from "../sig/key.ts";
import {
  getCanonicalPortableId,
  getPortableDid,
  isCompatibleKeyId,
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
 * An HTTP Signature of a delivery to a portable inbox, which may tell which
 * gateway of the recipient forwarded the delivery.
 */
export interface PortableInboxSignature {
  /** The ID of the key that the signature claims to be made with. */
  readonly keyId: URL;
  /**
   * Whether the signature covers the method, the target URI, and the body of
   * the request, so that it cannot be reused for another delivery.
   */
  readonly coversDelivery: boolean;
  /**
   * Verifies this signature, and no other signature of the request.
   * @returns The key that the signature is verified with, or `null` if it is
   *          not verified.
   */
  verify(): Promise<CryptographicKey | null>;
}

// The components that a signature has to cover to be bound to a delivery,
// spelled exactly as the specifications do, since a different spelling may
// skip a check, e.g., Content-Digest is verified only if content-digest is
// covered:
const RFC9421_DELIVERY_COMPONENTS = [
  "@method",
  "@target-uri",
  "content-digest",
];
const DRAFT_DELIVERY_COMPONENTS = ["(request-target)", "host", "digest"];

/**
 * Checks whether an HTTP Signature covers the method, the target URI, and the
 * body of a request, which both Fedify and Mitra sign when forwarding.
 * @param signature The signature.
 * @returns `true` if the signature covers them.
 */
export function coversDelivery(signature: RequestSignature): boolean {
  const required = signature.label == null
    ? DRAFT_DELIVERY_COMPONENTS
    : RFC9421_DELIVERY_COMPONENTS;
  return required.every((name) =>
    signature.components.some((c) =>
      c.value === name && Object.keys(c.params).length < 1
    )
  );
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
  /**
   * The HTTP Signatures of the delivery, which may identify the gateway that
   * forwarded it, so that the activity is not forwarded back to it.
   */
  readonly signatures?: readonly PortableInboxSignature[];
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
 *
 * If the delivery is signed with a gateway key of the recipient by one of its
 * other gateways, that gateway has the activity already, so it is claimed
 * without forwarding the activity to it.  See {@link identifySendingGateway}.
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
  const options = parameters.options ??
    resolvePortableInboxForwardingOptions();
  const { maxTargets, ttl } = options;
  if (kv.cas == null || maxTargets < 1) return [];
  // The deadline covers both identifying the sending gateway and, without
  // an outbox queue, forwarding:
  const deadline = Date.now() + options.deadline.total("millisecond");
  // A compatible activity ID is canonicalized too, so that its equivalent
  // representations share the same forwarding claims:
  const canonicalActivityId = getCanonicalPortableId(activityId) ??
    activityId.href;
  const claimKey = (gateway: string): KvKey => [
    ...kvPrefix,
    recipient.canonicalInboxId,
    canonicalActivityId,
    gateway,
  ];
  let targets = getForwardingTargets(recipient, excludedOrigins);
  // Before the targets are capped, so that the sender does not take a slot:
  const sender = await identifySendingGateway(
    parameters,
    targets.map((t) => t.gateway),
    claimKey,
    deadline,
  );
  if (sender != null) {
    logger.debug(
      "Not forwarding activity {activityId} from the portable inbox {inbox} " +
        "back to the gateway {gateway}, which delivered it.",
      {
        activityId: activityId.href,
        inbox: recipient.canonicalInboxId,
        gateway: sender,
      },
    );
    // Claimed so that the activity is never forwarded to the gateway, which
    // has it already, even if it is delivered again through another gateway:
    await kv.cas(claimKey(sender), undefined, true, { ttl });
    targets = targets.filter((t) => t.gateway !== sender);
  }
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
    if (await kv.cas(claimKey(gateway), undefined, true, { ttl })) {
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
    await forwardImmediately(parameters, claimed, deadline);
  } else {
    await enqueueForwarding(parameters, outboxQueue, claimed);
  }
  return claimed;
}

/**
 * Identifies the gateway of the recipient that forwarded a delivery to its
 * portable inbox, by the delivery's HTTP Signature made with the recipient's
 * gateway key, which FEP-ef61 has each gateway use for requests on behalf of
 * an actor.  Since the activity is authenticated by its own proof, the
 * signature only tells which gateway to skip, and a delivery whose signature
 * is invalid or cannot be verified is still forwarded to every gateway.
 *
 * Verifying the signature fetches the recipient's actor document from the
 * sending gateway, as gateway keys are not cached, so only the first signature
 * that may save a request is verified: one that covers the delivery and names
 * a gateway key of the recipient on one of the forwarding targets that the
 * activity has not been forwarded to yet.
 * @param parameters The forwarding parameters.
 * @param targets The origins of the gateways to forward to.
 * @param claimKey Gets the key of the claim for a gateway.
 * @param deadline The time by which identification has to finish, in
 *                 milliseconds since the epoch; afterwards, the sending
 *                 gateway is left unidentified.
 * @returns The origin of the sending gateway, or `null` if it is not
 *          identified.
 */
async function identifySendingGateway(
  { recipient, activityId, kv, signatures }:
    ForwardPortableInboxActivityParameters,
  targets: readonly string[],
  claimKey: (gateway: string) => KvKey,
  deadline: number,
): Promise<string | null> {
  if (signatures == null || signatures.length < 1) return null;
  const logger = getLogger(["fedify", "federation", "inbox"]);
  const actorId = getCanonicalPortableId(recipient.actorId);
  if (actorId == null) return null;
  const isGatewayKeyOfRecipient = (keyId: URL): boolean => {
    if (!isCompatibleKeyId(keyId) || !targets.includes(keyId.origin)) {
      return false;
    }
    const base = new URL(keyId.href);
    base.hash = "";
    return getCanonicalPortableId(base) === actorId;
  };
  let signature: PortableInboxSignature | undefined;
  for (const candidate of signatures) {
    if (
      candidate.coversDelivery && isGatewayKeyOfRecipient(candidate.keyId) &&
      await kv.get(claimKey(candidate.keyId.origin)) === undefined
    ) {
      signature = candidate;
      break;
    }
  }
  if (signature == null) return null;
  const { keyId } = signature;
  const logProperties = {
    activityId: activityId.href,
    inbox: recipient.canonicalInboxId,
    keyId: keyId.href,
  };
  // A verification that fails after the deadline must not be left unhandled:
  const verification = Promise.resolve().then(() => signature.verify()).then(
    (key) => {
      if (key == null) {
        logger.debug(
          "The HTTP Signature of the delivery of activity {activityId} to " +
            "the portable inbox {inbox} is not verified with the key " +
            "{keyId}; forwarding it without identifying the sending gateway.",
          logProperties,
        );
      }
      return key;
    },
    (error) => {
      logger.debug(
        "Failed to verify the HTTP Signature of the delivery of activity " +
          "{activityId} to the portable inbox {inbox} with the key {keyId}; " +
          "forwarding it without identifying the sending gateway:\n{error}",
        { ...logProperties, error },
      );
      return null;
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const key = await Promise.race([
    verification,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        logger.debug(
          "Verifying the HTTP Signature of the delivery of activity " +
            "{activityId} to the portable inbox {inbox} did not finish in " +
            "time; forwarding it without identifying the sending gateway.",
          logProperties,
        );
        resolve(null);
      }, Math.max(0, deadline - Date.now()));
    }),
  ]);
  clearTimeout(timer);
  if (key == null) return null;
  // Only a key that the recipient's DID-signed actor document vouches for as
  // a gateway key has a portable actor as its owner:
  if (
    key.id == null || key.id.href !== keyId.href ||
    !isGatewayKeyOfRecipient(key.id) || key.ownerId == null ||
    !isPortableId(key.ownerId) ||
    getCanonicalPortableId(key.ownerId) !== actorId
  ) {
    logger.debug(
      "The delivery of activity {activityId} to the portable inbox {inbox} " +
        "is not signed with a gateway key of the recipient; forwarding it " +
        "without identifying the sending gateway.",
      logProperties,
    );
    return null;
  }
  return key.id.origin;
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
  deadlineAt: number,
): Promise<void> {
  const {
    activity,
    activityId,
    activityType,
    allowPrivateAddress,
    specDeterminer,
    meterProvider,
    tracerProvider,
  } = parameters;
  const logger = getLogger(["fedify", "federation", "inbox"]);
  const deadline = Math.max(0, deadlineAt - Date.now());
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
