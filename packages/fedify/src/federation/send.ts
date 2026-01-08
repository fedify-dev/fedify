import type { Recipient } from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
import {
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
   * Note that the only `origin` parts of the `URL`s are compared.
   *
   * @since 0.9.0
   */
  readonly excludeBaseUris?: readonly URL[];
}

/**
 * Extracts the inbox URLs from recipients.
 * @param parameters The parameters to extract the inboxes.
 *                   See also {@link ExtractInboxesParameters}.
 * @returns The inboxes as a map of inbox URL to actor URIs.
 */
export function extractInboxes(
  { recipients, preferSharedInbox, excludeBaseUris }: ExtractInboxesParameters,
): Record<string, { actorIds: Set<string>; sharedInbox: boolean }> {
  const inboxes: Record<
    string,
    { actorIds: Set<string>; sharedInbox: boolean }
  > = {};
  for (const recipient of recipients) {
    let inbox: URL | null;
    let sharedInbox = false;
    if (preferSharedInbox && recipient.endpoints?.sharedInbox != null) {
      inbox = recipient.endpoints.sharedInbox;
      sharedInbox = true;
    } else {
      inbox = recipient.inboxId;
    }
    if (inbox != null && recipient.id != null) {
      if (
        excludeBaseUris != null &&
        excludeBaseUris.some((u) => u.origin === inbox?.origin)
      ) {
        continue;
      }
      inboxes[inbox.href] ??= { actorIds: new Set(), sharedInbox };
      inboxes[inbox.href].actorIds.add(recipient.id.href);
    }
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
   * The key pairs of the sender to sign the request.  It must not be empty.
   * @since 0.10.0
   */
  readonly keys: readonly SenderKeyPair[];

  /**
   * The inbox URL to send the activity to.
   */
  readonly inbox: URL;

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

async function sendActivityInternal(
  {
    activity,
    activityId,
    keys,
    inbox,
    headers,
    specDeterminer,
    tracerProvider,
  }: SendActivityParameters,
  span: Span,
): Promise<void> {
  const logger = getLogger(["fedify", "federation", "outbox"]);
  headers = new Headers(headers);
  headers.set("Content-Type", "application/activity+json");
  const request = new Request(inbox, {
    method: "POST",
    headers,
    body: JSON.stringify(activity),
  });
  let rsaKey: SenderKeyPair | null = null;
  for (const key of keys) {
    if (key.privateKey.algorithm.name === "RSASSA-PKCS1-v1_5") {
      rsaKey = key;
      break;
    }
  }
  if (rsaKey == null) {
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
      ? await fetch(request)
      : await doubleKnock(request, rsaKey, { tracerProvider, specDeterminer });
  } catch (error) {
    logger.error(
      "Failed to send activity {activityId} to {inbox}:\n{error}",
      {
        activityId,
        inbox: inbox.href,
        error,
      },
    );
    throw error;
  }
  if (!response.ok) {
    let error;
    try {
      error = await response.text();
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
    throw new Error(
      `Failed to send activity ${activityId} to ${inbox.href} ` +
        `(${response.status} ${response.statusText}):\n${error}`,
    );
  }

  // Record the sent activity with delivery details
  span.addEvent("activitypub.activity.sent", {
    "activitypub.activity.json": JSON.stringify(activity),
    "activitypub.inbox.url": inbox.href,
    "activitypub.activity.id": activityId ?? "",
  });
}
