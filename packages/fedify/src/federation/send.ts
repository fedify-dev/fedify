import type { Recipient } from "@fedify/vocab";
import { FetchError, UrlError } from "@fedify/vocab-runtime";
import {
  openDirectFetch,
  openPublicFetch,
  type PublicFetchSession,
} from "@fedify/vocab-runtime/internal";
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
  type DoubleKnockOpenHop,
  doubleKnockScoped,
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
   * The tracer provider for tracing the request.
   * If omitted, the global tracer provider is used.
   * @since 1.3.0
   */
  readonly tracerProvider?: TracerProvider;
}

/**
 * The dependencies of {@link sendActivity}, for tests.
 */
export interface SendActivityDependencies {
  /**
   * Opens a fetch session for each hop, instead of `openPublicFetch()` (or
   * `openDirectFetch()` if private addresses are allowed).
   */
  readonly openHop?: DoubleKnockOpenHop;
}

/**
 * Sends an {@link Activity} to an inbox.
 *
 * @param parameters The parameters for sending the activity.
 *                   See also {@link SendActivityParameters}.
 * @param deps The dependencies, for tests.
 * @throws {Error} If the activity fails to send.
 */
export function sendActivity(
  options: SendActivityParameters,
  deps: SendActivityDependencies = {},
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
        await sendActivityInternal({ ...options, tracerProvider }, span, deps);
      } catch (e) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
        throw e;
      } finally {
        span.end();
      }
    },
  );
}

const MAX_ERROR_RESPONSE_BODY_BYTES = 1024;

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
    // Start cancelling the rest of a truncated body instead of leaving it
    // unread.  It is not awaited, since the cancellation of a tee branch
    // (e.g., a body cloned by a fetch mock) may never settle:
    if (truncated) reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  let result = chunks.join("");
  if (truncated) {
    result += "… (truncated)";
  }
  return result;
}

/**
 * The outcome of a delivery, determined while its session is open.
 */
type SendActivityOutcome =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly status: number;
    readonly statusText: string;
    readonly error: string;
  };

async function sendActivityInternal(
  {
    activity,
    activityId,
    keys,
    inbox,
    allowPrivateAddress,
    headers,
    specDeterminer,
    tracerProvider,
  }: SendActivityParameters,
  span: Span,
  deps: SendActivityDependencies,
): Promise<void> {
  const logger = getLogger(["fedify", "federation", "outbox"]);
  const openUnvalidatedHop: DoubleKnockOpenHop = deps.openHop ??
    (allowPrivateAddress ? openDirectFetch : (url) => openPublicFetch(url));
  // Whether the initial destination has been opened; failures before that
  // are logged only by openHop():
  let opened = false;
  async function openHop(url: string): Promise<PublicFetchSession> {
    let session: PublicFetchSession;
    try {
      session = await openUnvalidatedHop(url);
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
    opened = true;
    return session;
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
  // TODO: When forwarding to 2.3+, include initial DNS failures in delivery
  // metrics without changing disallowed-URL handling. Test metrics and
  // circuit-breaker accounting for both direct and redirected destinations.
  // https://github.com/fedify-dev/fedify/issues/1055
  let outcome: SendActivityOutcome;
  try {
    outcome = rsaKey == null
      ? await fetchWithValidatedRedirects(
        request,
        openHop,
        (response) => consumeSendActivityResponse(response, inbox),
      )
      : await doubleKnockScoped(
        request,
        rsaKey,
        { tracerProvider, specDeterminer },
        openHop,
        (response) => consumeSendActivityResponse(response, inbox),
      );
  } catch (error) {
    if (opened) {
      logger.error(
        "Failed to send activity {activityId} to {inbox}:\n{error}",
        {
          activityId,
          inbox: inbox.href,
          error,
        },
      );
    }
    throw error;
  }
  if (!outcome.ok) {
    const { status, statusText, error } = outcome;
    logger.error(
      "Failed to send activity {activityId} to {inbox} ({status} " +
        "{statusText}):\n{error}",
      {
        activityId,
        inbox: inbox.href,
        status,
        statusText,
        error,
      },
    );
    throw new SendActivityError(
      inbox,
      status,
      `Failed to send activity ${activityId} to ${inbox.href} ` +
        `(${status} ${statusText}):\n${error}`,
      error,
    );
  }

  // Record the sent activity with delivery details
  span.addEvent("activitypub.activity.sent", {
    "activitypub.activity.json": JSON.stringify(activity),
    "activitypub.inbox.url": inbox.href,
    "activitypub.activity.id": activityId ?? "",
  });
}

/**
 * Starts cancelling the body of a response without waiting for it to settle.
 * The cancellation of a branch of a tee (e.g., a body cloned by a fetch mock)
 * settles only after the other branch is cancelled too, per the Streams
 * standard, so awaiting it could block forever.  Failures are only logged.
 */
function cancelResponseBody(response: Response, url: string): void {
  response.body?.cancel().catch((error) => {
    getLogger(["fedify", "federation", "outbox"]).debug(
      "Failed to cancel the response body from {url}: {error}",
      { url, error },
    );
  });
}

/**
 * Reads what is needed from the final response of a delivery while its
 * session is open: the body of a successful response is cancelled, and at
 * most 1 KiB of an error response body is read.
 */
async function consumeSendActivityResponse(
  response: Response,
  inbox: URL,
): Promise<SendActivityOutcome> {
  if (response.ok) {
    cancelResponseBody(response, response.url || inbox.href);
    return { ok: true };
  }
  let error: string;
  try {
    error = await readLimitedResponseBody(
      response,
      MAX_ERROR_RESPONSE_BODY_BYTES,
    );
  } catch (_) {
    error = "";
  }
  return {
    ok: false,
    status: response.status,
    statusText: response.statusText,
    error,
  };
}

/**
 * Sends a request without signing it, following redirects manually like the
 * Fetch standard does.  Every hop is opened with `openHop()`, which validates
 * the destination, after the previous hop is closed.  The final response is
 * passed to `consume()`, and its session is closed after that.
 * This is exported only for tests; it is not exported from any entry point.
 * @param request The request to send.
 * @param openHop The function to open a session for each hop.
 * @param consume The function to consume the final response.
 * @returns The value returned by `consume`.
 */
export async function fetchWithValidatedRedirects<T>(
  request: Request,
  openHop: DoubleKnockOpenHop,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const logger = getLogger(["fedify", "federation", "outbox"]);
  let body: string | undefined = await request.clone().text();
  for (let redirects = 0;; redirects++) {
    const session = await openHop(request.url);
    let response: Response;
    try {
      // Bun also needs the redirect option on fetch() itself.
      response = await session.fetch(request, { redirect: "manual" });
    } catch (error) {
      await closeAfterError(session, logger);
      throw error;
    }
    const location = response.headers.get("Location");
    if (
      ![301, 302, 303, 307, 308].includes(response.status) || location == null
    ) {
      try {
        return await consume(response);
      } catch (error) {
        logger.debug(
          "Failed to consume the response from {url}; closing the session: " +
            "{error}",
          { url: request.url, error },
        );
        throw error;
      } finally {
        await session.close();
      }
    }
    // The current hop is closed before the next one is validated and opened:
    cancelResponseBody(response, request.url);
    await session.close();
    if (redirects >= 20) throw new TypeError("Too many redirects");
    const url = new URL(location, request.url);
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

async function closeAfterError(
  session: PublicFetchSession,
  logger: ReturnType<typeof getLogger>,
): Promise<void> {
  try {
    await session.close();
  } catch (error) {
    logger.debug(
      "Failed to close the session for {url}: {error}",
      { url: session.url.href, error },
    );
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
   * Creates a new {@link SendActivityError}.
   * @param inbox The inbox URL.
   * @param statusCode The HTTP status code.
   * @param message The error message.
   * @param responseBody The response body.
   */
  constructor(
    inbox: URL,
    statusCode: number,
    message: string,
    responseBody: string,
  ) {
    super(message);
    this.name = "SendActivityError";
    this.inbox = inbox;
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}
