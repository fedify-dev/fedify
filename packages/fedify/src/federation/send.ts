import type { Recipient } from "@fedify/vocab";
import { FetchError, UrlError, validatePublicUrl } from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import {
  type Attributes,
  type MeterProvider,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
  type TracerProvider,
} from "@opentelemetry/api";
import metadata from "../../deno.json" with { type: "json" };
import {
  doubleKnock,
  type HttpMessageSignaturesSpecDeterminer,
} from "../sig/http.ts";
import { isPortableUri } from "../sig/portable-key-id.ts";
import { getDurationMs, getFederationMetrics } from "./metrics.ts";
import {
  mergeGatewayInboxes,
  resolvePortableDeliveryTarget,
} from "./portable-delivery.ts";

/**
 * Parameters for {@link extractInboxes}.
 */
export interface ExtractInboxesParameters {
  /**
   * Actors to extract the inboxes from.
   */
  readonly recipients: readonly Recipient[];

  /**
   * Whether to prefer the shared inbox over the personal inbox.
   * Defaults to `false`.
   */
  readonly preferSharedInbox?: boolean;

  /**
   * The base URIs to exclude from the recipients' inboxes.  It is useful
   * for excluding the recipients having the same shared inbox with the sender.
   *
   * Note that the only `origin` parts of the `URL`s are compared.  For
   * an [FEP-ef61] portable inbox, they are compared with the origins of
   * the recipient's gateways, and only the excluded gateways are skipped.
   *
   * [FEP-ef61]: https://w3id.org/fep/ef61
   *
   * @since 0.9.0
   */
  readonly excludeBaseUris?: readonly URL[];
}

/**
 * An inbox extracted by {@link extractInboxes}.
 */
export interface ExtractedInbox {
  /**
   * The IDs of the recipients that the inbox belongs to.
   */
  actorIds: Set<string>;

  /**
   * Whether the inbox is a shared inbox.
   */
  sharedInbox: boolean;

  /**
   * The canonical form of the [FEP-ef61] portable inbox, i.e., an `ap:` or
   * `ap+ef61:` URI, that the inbox stands for.  It is set only if the inbox
   * is resolved from a portable inbox, in which case the inbox is the portable
   * inbox's compatible identifier on its first gateway.
   *
   * [FEP-ef61]: https://w3id.org/fep/ef61
   * @since 2.4.0
   */
  portableInbox?: string;

  /**
   * The compatible identifiers of the portable inbox on each gateway to
   * deliver through, in order, starting with the inbox itself.  It is set
   * only if {@link portableInbox} is set.
   * @since 2.4.0
   */
  gatewayInboxes?: string[];
}

/**
 * Extracts the inbox URLs from recipients.
 *
 * An [FEP-ef61] portable inbox, i.e., an `ap:` or `ap+ef61:` URI, is resolved
 * to its compatible identifiers on the recipient's gateways, or, if the
 * recipient has no valid gateway, on the gateways in the `@gateway` location
 * hints of the inbox URI.  The inbox is keyed by the compatible identifier on
 * the first gateway, and the others are listed in
 * {@link ExtractedInbox.gatewayInboxes}.  A recipient whose portable inbox
 * has no gateway to deliver through is skipped.  The shared inbox of
 * a recipient with a portable inbox is never preferred, since only a portable
 * inbox is synchronized between the gateways.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @param parameters The parameters to extract the inboxes.
 *                   See also {@link ExtractInboxesParameters}.
 * @returns The inboxes as a map of inbox URL to actor URIs.
 */
export function extractInboxes(
  { recipients, preferSharedInbox, excludeBaseUris }: ExtractInboxesParameters,
): Record<string, ExtractedInbox> {
  const inboxes: Record<string, ExtractedInbox> = {};
  // The keys of portable inboxes by their canonical forms, so that different
  // spellings of the same portable inbox are merged:
  const portableKeys = new Map<string, string>();
  // The keys of portable inboxes by their compatible identifiers on each of
  // their gateways, so that a recipient that has one of them as its inbox is
  // merged too:
  const compatibleKeys = new Map<string, string>();
  for (const recipient of recipients) {
    if (recipient.id == null) continue;
    let inbox: URL | null;
    let sharedInbox = false;
    if (
      preferSharedInbox && recipient.endpoints?.sharedInbox != null &&
      (recipient.inboxId == null || !isPortableUri(recipient.inboxId))
    ) {
      inbox = recipient.endpoints.sharedInbox;
      sharedInbox = true;
    } else {
      inbox = recipient.inboxId;
    }
    if (inbox == null) continue;
    if (isPortableUri(inbox)) {
      const target = resolvePortableDeliveryTarget(
        recipient,
        inbox,
        excludeBaseUris,
      );
      if (target == null) continue;
      const gatewayInboxes = target.inboxes.map((u) => u.href);
      const key = portableKeys.get(target.portableInbox) ??
        gatewayInboxes.find((i) => i in inboxes) ?? gatewayInboxes[0];
      portableKeys.set(target.portableInbox, key);
      const entry = inboxes[key] ??= { actorIds: new Set(), sharedInbox };
      // An entry that an ordinary recipient reached through the same URL,
      // e.g., the compatible identifier as its inbox, is upgraded:
      entry.sharedInbox = false;
      entry.portableInbox = target.portableInbox;
      entry.gatewayInboxes = mergeGatewayInboxes(
        entry.gatewayInboxes ?? [key],
        gatewayInboxes,
      );
      for (const i of entry.gatewayInboxes) compatibleKeys.set(i, key);
      entry.actorIds.add(recipient.id.href);
      continue;
    }
    if (
      excludeBaseUris != null &&
      excludeBaseUris.some((u) => u.origin === inbox?.origin)
    ) {
      continue;
    }
    const key = compatibleKeys.get(inbox.href) ?? inbox.href;
    inboxes[key] ??= { actorIds: new Set(), sharedInbox };
    inboxes[key].actorIds.add(recipient.id.href);
  }
  return inboxes;
}

/**
 * A key pair for an actor who sends an activity.
 * @since 0.10.0
 */
export interface SenderKeyPair {
  /**
   * The actor's private key to sign the request.
   */
  readonly privateKey: CryptoKey;

  /**
   * The public key ID that corresponds to the private key.
   */
  readonly keyId: URL;
}

/**
 * Parameters for {@link sendActivity}.
 */
export interface SendActivityParameters {
  /**
   * The activity to send.
   */
  readonly activity: unknown;

  /**
   * The activity ID to send.
   * @since 1.0.0
   */
  readonly activityId?: string | null;

  /**
   * The qualified URI of the activity type.
   * @since 1.3.0
   */
  readonly activityType?: string;

  /**
   * The key pairs of the sender to sign the request.  If it is empty,
   * the request is sent without a signature, e.g., when the activity is
   * authenticated by its own proof.
   * @since 0.10.0
   */
  readonly keys: readonly SenderKeyPair[];

  /**
   * The inbox URL to send the activity to.
   */
  readonly inbox: URL;

  /**
   * Whether to allow delivery to private network addresses, including redirects.
   * Defaults to `false`.  Only enable this for local testing.
   */
  readonly allowPrivateAddress?: boolean;

  /**
   * Whether the inbox is a shared inbox.
   * @since 1.3.0
   */
  readonly sharedInbox?: boolean;

  /**
   * Additional headers to include in the request.
   */
  readonly headers?: Headers;

  /**
   * The spec determiner to use for signing requests with double-knocking.
   * @since 1.6.0
   */
  readonly specDeterminer?: HttpMessageSignaturesSpecDeterminer;

  /**
   * The meter provider for recording metrics.
   * If omitted, the global meter provider is used.
   * @since 2.3.0
   */
  readonly meterProvider?: MeterProvider;

  /**
   * The tracer provider for tracing the request.
   * If omitted, the global tracer provider is used.
   * @since 1.3.0
   */
  readonly tracerProvider?: TracerProvider;
}

/**
 * Sends an {@link Activity} to an inbox.
 *
 * @param parameters The parameters for sending the activity.
 *                   See also {@link SendActivityParameters}.
 * @throws {Error} If the activity fails to send.
 */
export function sendActivity(
  options: SendActivityParameters,
): Promise<void> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  return tracer.startActiveSpan(
    "activitypub.send_activity",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "activitypub.shared_inbox": options.sharedInbox ?? false,
      },
    },
    async (span) => {
      if (options.activityId != null) {
        span.setAttribute("activitypub.activity.id", options.activityId);
      }
      if (options.activityType != null) {
        span.setAttribute("activitypub.activity.type", options.activityType);
      }
      try {
        await sendActivityInternal({ ...options, tracerProvider }, span);
      } catch (e) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
        throw e;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Sends an activity to the first of the given inboxes that accepts it, i.e.,
 * the compatible identifiers of a portable inbox on its gateways, trying them
 * one after another.
 * @param parameters The parameters, except for the inbox.
 * @param inboxes The inboxes to try, in order.  Must not be empty.
 * @throws {Error} The error of the last inbox if no inbox accepts it.
 */
export async function sendActivityThroughGateways(
  parameters: Omit<SendActivityParameters, "inbox">,
  inboxes: readonly URL[],
): Promise<void> {
  const logger = getLogger(["fedify", "federation", "outbox"]);
  let lastError: unknown;
  for (const [i, inbox] of inboxes.entries()) {
    try {
      await sendActivity({ ...parameters, inbox });
      return;
    } catch (error) {
      lastError = error;
      if (i < inboxes.length - 1) {
        logger.warn(
          "Failed to send activity {activityId} to {inbox}; trying the next " +
            "gateway {next}:\n{error}",
          {
            activityId: parameters.activityId,
            inbox: inbox.href,
            next: inboxes[i + 1].href,
            error,
          },
        );
      }
    }
  }
  throw lastError;
}

const MAX_ERROR_RESPONSE_BODY_BYTES = 1024;

function getActivityActorId(activity: unknown): string | undefined {
  if (!isRecord(activity)) return undefined;
  return getIdValue(activity.actor);
}

function getIdValue(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (value instanceof URL) return value.href;
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = getIdValue(item);
      if (id != null) return id;
    }
    return undefined;
  }
  if (isRecord(value)) return getIdValue(value.id);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

async function readLimitedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (response.body == null) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (totalBytes + value.length > maxBytes) {
        const remaining = maxBytes - totalBytes;
        if (remaining > 0) {
          chunks.push(
            decoder.decode(value.slice(0, remaining), { stream: true }),
          );
        }
        truncated = true;
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
      totalBytes += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  let result = chunks.join("");
  if (truncated) {
    result += "… (truncated)";
  }
  return result;
}

async function sendActivityInternal(
  {
    activity,
    activityId,
    activityType,
    keys,
    inbox,
    allowPrivateAddress,
    headers,
    specDeterminer,
    meterProvider,
    tracerProvider,
  }: SendActivityParameters,
  span: Span,
): Promise<void> {
  const logger = getLogger(["fedify", "federation", "outbox"]);
  const federationMetrics = getFederationMetrics(meterProvider);
  const started = performance.now();
  let deliverySuccess = false;
  async function validateUrl(url: string): Promise<void> {
    if (!allowPrivateAddress) {
      try {
        await validatePublicUrl(url);
      } catch (error) {
        if (error instanceof UrlError && error.reason === "dns") {
          logger.error("DNS resolution failed for URL: {url}", { url, error });
          const failure = new FetchError(url, error.message);
          failure.cause = error;
          throw failure;
        }
        if (error instanceof UrlError) {
          logger.error("Disallowed private URL: {url}", { url, error });
        }
        throw error;
      }
    }
  }

  try {
    await validateUrl(inbox.href);
  } catch (error) {
    // DNS validation failures are transport failures. Initial policy
    // rejections still exit before delivery accounting or request creation.
    if (error instanceof FetchError) {
      federationMetrics.recordDelivery(
        inbox,
        getDurationMs(started),
        false,
        activityType,
      );
    }
    throw error;
  }
  headers = new Headers(headers);
  headers.set("Content-Type", "application/activity+json");
  const request = new Request(inbox, {
    method: "POST",
    headers,
    body: JSON.stringify(activity),
    redirect: "manual",
  });
  let rsaKey: SenderKeyPair | null = null;
  for (const key of keys) {
    if (key.privateKey.algorithm.name === "RSASSA-PKCS1-v1_5") {
      rsaKey = key;
      break;
    }
  }
  if (rsaKey == null && keys.length < 1) {
    logger.debug(
      "Sending the activity {activityId} to {inbox} without a signature.",
      { activityId, inbox: inbox.href },
    );
  } else if (rsaKey == null) {
    logger.warn(
      "No supported key found to sign the request to {inbox}.  " +
        "The request will be sent without a signature.  " +
        "In order to sign the request, at least one RSASSA-PKCS1-v1_5 key " +
        "must be provided.",
      {
        inbox: inbox.href,
        keys: keys.map((pair) => ({
          keyId: pair.keyId.href,
          privateKey: pair.privateKey,
        })),
      },
    );
  }
  let response: Response;
  try {
    response = rsaKey == null
      ? await fetchWithValidatedRedirects(request, validateUrl)
      : await doubleKnock(request, rsaKey, {
        tracerProvider,
        specDeterminer,
        validateRedirect: validateUrl,
      });
  } catch (error) {
    // A destination refused by the private-address policy is a policy
    // decision rather than a transport failure, so it surfaces as the
    // `UrlError` it is, just as a refused inbox URL does before the request
    // is ever made.  See GHSA-f59r-8gcj-68f2.
    const failure = error instanceof FetchError || error instanceof UrlError
      ? error
      : createFetchError(inbox.href, error);
    logger.error(
      "Failed to send activity {activityId} to {inbox}:\n{error}",
      {
        activityId,
        inbox: inbox.href,
        error: failure,
      },
    );
    federationMetrics.recordDelivery(
      inbox,
      getDurationMs(started),
      false,
      activityType,
    );
    throw failure;
  }
  try {
    if (!response.ok) {
      let error: string;
      try {
        error = await readLimitedResponseBody(
          response,
          MAX_ERROR_RESPONSE_BODY_BYTES,
        );
      } catch (_) {
        error = "";
      }
      logger.error(
        "Failed to send activity {activityId} to {inbox} ({status} " +
          "{statusText}):\n{error}",
        {
          activityId,
          inbox: inbox.href,
          status: response.status,
          statusText: response.statusText,
          error,
        },
      );
      throw new SendActivityError(
        inbox,
        response.status,
        `Failed to send activity ${activityId} to ${inbox.href} ` +
          `(${response.status} ${response.statusText}):\n${error}`,
        error,
        response.headers,
      );
    }

    deliverySuccess = true;

    // Record the sent activity with delivery details
    const eventAttributes: Attributes = {
      "activitypub.inbox.url": inbox.href,
      "activitypub.activity.id": activityId ?? "",
    };
    if (activityType != null) {
      eventAttributes["activitypub.activity.type"] = activityType;
    }
    const actorId = getActivityActorId(activity);
    if (actorId != null) {
      eventAttributes["activitypub.actor.id"] = actorId;
    }
    span.addEvent("activitypub.activity.sent", eventAttributes);
  } finally {
    federationMetrics.recordDelivery(
      inbox,
      getDurationMs(started),
      deliverySuccess,
      activityType,
    );
  }
}

function createFetchError(url: string, cause: unknown): FetchError {
  const message = cause instanceof Error ? cause.message : String(cause);
  const error = new FetchError(url, message);
  error.cause = cause;
  return error;
}

// Preserve Fetch's redirect semantics while validating every destination.
async function fetchWithValidatedRedirects(
  request: Request,
  validateUrl: (url: string) => Promise<void>,
): Promise<Response> {
  let body: string | undefined = await request.clone().text();
  for (let redirects = 0;; redirects++) {
    // Bun also needs the redirect option on fetch() itself.
    const response = await fetch(request, { redirect: "manual" });
    const location = response.headers.get("Location");
    if (
      ![301, 302, 303, 307, 308].includes(response.status) || location == null
    ) return response;
    await response.body?.cancel();
    if (redirects >= 20) throw new TypeError("Too many redirects");
    const url = new URL(location, request.url);
    await validateUrl(url.href);
    const headers = new Headers(request.headers);
    if (url.origin !== new URL(request.url).origin) {
      headers.delete("Authorization");
      headers.delete("Proxy-Authorization");
      headers.delete("Cookie");
      headers.delete("Host");
    }
    let method = request.method;
    if (
      (response.status === 301 || response.status === 302) &&
        method === "POST" ||
      response.status === 303 && method !== "GET" && method !== "HEAD"
    ) {
      method = "GET";
      body = undefined;
      for (
        const name of [
          "Content-Encoding",
          "Content-Language",
          "Content-Length",
          "Content-Location",
          "Content-Type",
        ]
      ) headers.delete(name);
    }
    request = new Request(url, { method, headers, body, redirect: "manual" });
  }
}

/**
 * An error that is thrown when an activity fails to send to a remote inbox.
 * It contains structured information about the failure, including the HTTP
 * status code, the inbox URL, and the response body.
 * @since 2.0.0
 */
export class SendActivityError extends Error {
  /**
   * The inbox URL that the activity was being sent to.
   */
  readonly inbox: URL;

  /**
   * The HTTP status code returned by the inbox.
   */
  readonly statusCode: number;

  /**
   * The response body from the inbox, if any.  Note that this may be
   * truncated to a maximum of 1 KiB to prevent excessive memory consumption
   * when remote servers return large error pages (e.g., Cloudflare error pages).
   * If truncated, the string will end with `"… (truncated)"`.
   */
  readonly responseBody: string;

  /**
   * The response headers from the inbox.
   * @since 2.3.0
   */
  readonly responseHeaders: Headers;

  /**
   * Creates a new {@link SendActivityError}.
   * @param inbox The inbox URL.
   * @param statusCode The HTTP status code.
   * @param message The error message.
   * @param responseBody The response body.
   * @param responseHeaders The response headers.
   */
  constructor(
    inbox: URL,
    statusCode: number,
    message: string,
    responseBody: string,
    responseHeaders?: HeadersInit,
  ) {
    super(message);
    this.name = "SendActivityError";
    this.inbox = inbox;
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.responseHeaders = new Headers(responseHeaders);
  }
}
