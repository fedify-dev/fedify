import {
  getUserAgent,
  type GetUserAgentOptions,
  UrlError,
  validatePublicUrl,
} from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import {
  type Attributes,
  type Counter,
  type Histogram,
  type MeterProvider,
  SpanKind,
  SpanStatusCode,
  trace,
  type TracerProvider,
} from "@opentelemetry/api";
import metadata from "../deno.json" with { type: "json" };
import type { ResourceDescriptor } from "./jrd.ts";

const logger = getLogger(["fedify", "webfinger", "lookup"]);

const DEFAULT_MAX_REDIRECTION = 5;

/**
 * The terminal classification of an outgoing {@link lookupWebFinger} call,
 * recorded as the `webfinger.lookup.result` attribute on the
 * `webfinger.lookup` counter and `webfinger.lookup.duration` histogram.
 *
 *  -  `found`: the lookup returned a {@link ResourceDescriptor}.
 *  -  `not_found`: the remote responded with HTTP `404 Not Found` or
 *     `410 Gone`.  Recorded together with `http.response.status_code`.
 *  -  `invalid`: the remote responded with content Fedify could not parse
 *     into a {@link ResourceDescriptor} (JSON parse failure), the
 *     redirect chain exceeded `maxRedirection`, the remote redirected to
 *     a different protocol, or the queried `acct:` resource itself was
 *     malformed.
 *  -  `network_error`: no HTTP response was received (the URL was
 *     rejected as a private address, `fetch()` threw, or an `AbortError`
 *     cancelled the request).
 *  -  `error`: the remote responded with a non-2xx HTTP response that is
 *     neither `404` nor `410`, or any other unexpected failure bubbled up
 *     from the lookup.
 * @since 2.3.0
 */
export type WebFingerLookupResult =
  | "found"
  | "not_found"
  | "invalid"
  | "network_error"
  | "error";

interface WebFingerInstruments {
  lookup: Counter;
  lookupDuration: Histogram;
}

const WEBFINGER_HISTOGRAM_BUCKETS: ReadonlyArray<number> = [
  5,
  10,
  25,
  50,
  75,
  100,
  250,
  500,
  750,
  1000,
  2500,
  5000,
  7500,
  10000,
];

const webFingerInstruments = new WeakMap<MeterProvider, WebFingerInstruments>();

function getWebFingerInstruments(
  meterProvider: MeterProvider,
): WebFingerInstruments {
  let instruments = webFingerInstruments.get(meterProvider);
  if (instruments == null) {
    const meter = meterProvider.getMeter(metadata.name, metadata.version);
    instruments = {
      lookup: meter.createCounter("webfinger.lookup", {
        description: "Outgoing WebFinger lookup attempts.",
        unit: "{lookup}",
      }),
      lookupDuration: meter.createHistogram("webfinger.lookup.duration", {
        description: "Duration of outgoing WebFinger lookups.",
        unit: "ms",
        advice: { explicitBucketBoundaries: [...WEBFINGER_HISTOGRAM_BUCKETS] },
      }),
    };
    webFingerInstruments.set(meterProvider, instruments);
  }
  return instruments;
}

function getResourceScheme(resource: URL | string): string {
  if (typeof resource === "string") {
    const colon = resource.indexOf(":");
    return colon > 0 ? resource.substring(0, colon).toLowerCase() : "";
  }
  return resource.protocol.replace(/:$/, "").toLowerCase();
}

// The scheme attribute is recorded on the `webfinger.lookup` metric.  Even
// though most call sites pass scheme-controlled resources (Fedify code and
// library users), `lookupObject()` accepts user-supplied identifiers that
// flow into here, so the metric attribute is bucketed to the schemes
// WebFinger / fediverse clients legitimately use (RFC 7565 +
// ActivityPub).  Anything else is bucketed as `other`, keeping metric
// cardinality bounded even when a remote returns redirects whose target
// scheme is unusual.
const WEBFINGER_LOOKUP_SCHEME_WHITELIST: ReadonlySet<string> = new Set([
  "acct",
  "http",
  "https",
  "mailto",
]);

function getMetricResourceScheme(scheme: string): string {
  return WEBFINGER_LOOKUP_SCHEME_WHITELIST.has(scheme) ? scheme : "other";
}

interface WebFingerLookupOutcome {
  resource: ResourceDescriptor | null;
  result: WebFingerLookupResult;
  statusCode?: number;
  remoteHost?: string;
}

/**
 * Options for {@link lookupWebFinger}.
 * @since 1.3.0
 */
export interface LookupWebFingerOptions {
  /**
   * The options for making `User-Agent` header.
   * If a string is given, it is used as the `User-Agent` header value.
   * If an object is given, it is passed to {@link getUserAgent} to generate
   * the `User-Agent` header value.
   */
  userAgent?: GetUserAgentOptions | string;

  /**
   * Whether to allow private IP addresses in the URL.
   *
   * Mostly useful for testing purposes.  *Do not use this in production.*
   *
   * Turned off by default.
   * @since 1.4.0
   */
  allowPrivateAddress?: boolean;

  /**
   * The maximum number of redirections to follow.
   * @default `5`
   * @since 1.8.0
   */
  maxRedirection?: number;

  /**
   * The OpenTelemetry tracer provider.  If omitted, the global tracer provider
   * is used.
   */
  tracerProvider?: TracerProvider;

  /**
   * The OpenTelemetry meter provider used to record the `webfinger.lookup`
   * counter and `webfinger.lookup.duration` histogram.  If omitted, no
   * metric measurements are emitted (the helper is opt-in to avoid
   * touching the global meter provider for callers that do not use
   * OpenTelemetry).
   * @since 2.3.0
   */
  meterProvider?: MeterProvider;

  /**
   * AbortSignal for cancelling the request.
   * @since 1.8.0
   */
  signal?: AbortSignal;
}

/**
 * Looks up a WebFinger resource.
 * @param resource The resource URL to look up.
 * @param options Extra options for looking up the resource.
 * @returns The resource descriptor, or `null` if not found.
 * @since 0.2.0
 */
export async function lookupWebFinger(
  resource: URL | string,
  options: LookupWebFingerOptions = {},
): Promise<ResourceDescriptor | null> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(
    metadata.name,
    metadata.version,
  );
  const scheme = getResourceScheme(resource);
  return await tracer.startActiveSpan(
    "webfinger.lookup",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "webfinger.resource": resource.toString(),
        "webfinger.resource.scheme": scheme,
      },
    },
    async (span) => {
      const meterProvider = options.meterProvider;
      const start = meterProvider == null ? 0 : performance.now();
      // Initialise the outcome with the `error` shape that the `finally`
      // block records when `lookupWebFingerInternal()` itself rejects;
      // the `try` body reassigns this to the actual outcome before any
      // other statement runs, so the `catch` does not need to reassign.
      let outcome: WebFingerLookupOutcome = {
        resource: null,
        result: "error",
      };
      try {
        outcome = await lookupWebFingerInternal(resource, options);
        span.setStatus({
          code: outcome.resource === null
            ? SpanStatusCode.ERROR
            : SpanStatusCode.OK,
        });
        return outcome.resource;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(error),
        });
        throw error;
      } finally {
        if (meterProvider != null) {
          const durationMs = Math.max(0, performance.now() - start);
          recordWebFingerLookup(meterProvider, durationMs, scheme, outcome);
        }
        span.end();
      }
    },
  );
}

function recordWebFingerLookup(
  meterProvider: MeterProvider,
  durationMs: number,
  scheme: string,
  outcome: WebFingerLookupOutcome,
): void {
  const attributes: Attributes = {
    "webfinger.lookup.result": outcome.result,
    "webfinger.resource.scheme": getMetricResourceScheme(scheme),
  };
  if (outcome.remoteHost != null) {
    attributes["activitypub.remote.host"] = outcome.remoteHost;
  }
  if (outcome.statusCode != null) {
    attributes["http.response.status_code"] = outcome.statusCode;
  }
  const instruments = getWebFingerInstruments(meterProvider);
  instruments.lookup.add(1, attributes);
  instruments.lookupDuration.record(durationMs, attributes);
}

async function lookupWebFingerInternal(
  resource: URL | string,
  options: LookupWebFingerOptions = {},
): Promise<WebFingerLookupOutcome> {
  if (typeof resource === "string") resource = new URL(resource);
  let protocol = "https:";
  let server: string;
  if (resource.protocol === "acct:" || resource.protocol === "mailto:") {
    // `acct:` (RFC 7565) and `mailto:` (RFC 6068, used as a WebFinger
    // resource per RFC 7033 §4.5) are opaque-path schemes: their
    // `user@host` authority lives in `pathname`, not in `host`.  The
    // WebFinger host is extracted from the substring after the last
    // `@`, and the lookup always goes to https on that host.
    const atPos = resource.pathname.lastIndexOf("@");
    if (atPos < 0) return { resource: null, result: "invalid" };
    server = resource.pathname.substring(atPos + 1);
    // The authority part of both schemes must be a bare host: no
    // path, query, or fragment characters embedded in it.  The
    // WHATWG URL parser routes anything after the first `?` or `#`
    // into `search` / `hash`, so by the time we read `pathname` the
    // only stray characters that can land in `server` are slashes.
    // Reject those (along with an empty authority) for both schemes.
    if (server === "" || /[/?#]/.test(server)) {
      return { resource: null, result: "invalid" };
    }
    // `acct:` (RFC 7565 §3) is bare authority only: no `search` or
    // `hash` allowed.  `mailto:` (RFC 6068 §2) explicitly permits
    // `?hfields=…` header fields and fragment identifiers, so we
    // forward those to the remote WebFinger lookup unchanged and
    // only enforce the stricter shape for `acct:`.
    if (
      resource.protocol === "acct:" &&
      (resource.search !== "" || resource.hash !== "")
    ) {
      return { resource: null, result: "invalid" };
    }
  } else {
    protocol = resource.protocol;
    server = resource.host;
  }
  let url = new URL(`${protocol}//${server}/.well-known/webfinger`);
  url.searchParams.set("resource", resource.href);
  let redirected = 0;
  while (true) {
    const remoteHost = url.hostname;
    logger.debug(
      "Fetching WebFinger resource descriptor from {url}...",
      { url: url.href },
    );
    let response: Response;
    if (options.allowPrivateAddress !== true) {
      try {
        await validatePublicUrl(url.href);
      } catch (e) {
        if (e instanceof UrlError) {
          logger.error(
            "Invalid URL for WebFinger resource descriptor: {error}",
            { error: e },
          );
          return { resource: null, result: "network_error", remoteHost };
        }
        throw e;
      }
    }
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/jrd+json",
          "User-Agent": typeof options.userAgent === "string"
            ? options.userAgent
            : getUserAgent(options.userAgent),
        },
        redirect: "manual",
        signal: options.signal,
      });
    } catch (error) {
      logger.debug(
        "Failed to fetch WebFinger resource descriptor: {error}",
        { url: url.href, error },
      );
      return { resource: null, result: "network_error", remoteHost };
    }
    if (
      response.status >= 300 && response.status < 400 &&
      response.headers.has("Location")
    ) {
      redirected++;
      const maxRedirection = options.maxRedirection ?? DEFAULT_MAX_REDIRECTION;
      // `maxRedirection: N` is documented as "the maximum number of
      // redirections to follow", so the Nth redirect must still be
      // followed and the (N+1)th rejected.  An earlier version used
      // `>=` here, which drifted by one from the documented semantics
      // and from the sibling code in @fedify/vocab-runtime's document
      // loader.
      if (redirected > maxRedirection) {
        logger.error(
          "Too many redirections ({redirections}) while fetching WebFinger " +
            "resource descriptor.",
          { redirections: redirected },
        );
        return {
          resource: null,
          result: "invalid",
          statusCode: response.status,
          remoteHost,
        };
      }
      let redirectedUrl: URL;
      try {
        redirectedUrl = new URL(
          response.headers.get("Location")!,
          response.url == null || response.url === "" ? url : response.url,
        );
      } catch (e) {
        logger.error(
          "Invalid Location header while following WebFinger redirect: " +
            "{error}",
          { url: url.href, error: e },
        );
        return {
          resource: null,
          result: "invalid",
          statusCode: response.status,
          remoteHost,
        };
      }
      if (redirectedUrl.protocol !== url.protocol) {
        logger.error(
          "Redirected to a different protocol ({protocol} to " +
            "{redirectedProtocol}) while fetching WebFinger resource " +
            "descriptor.",
          {
            protocol: url.protocol,
            redirectedProtocol: redirectedUrl.protocol,
          },
        );
        return {
          resource: null,
          result: "invalid",
          statusCode: response.status,
          remoteHost,
        };
      }
      url = redirectedUrl;
      continue;
    }
    if (!response.ok) {
      logger.debug(
        "Failed to fetch WebFinger resource descriptor: {status} {statusText}.",
        {
          url: url.href,
          status: response.status,
          statusText: response.statusText,
        },
      );
      const isNotFound = response.status === 404 || response.status === 410;
      return {
        resource: null,
        result: isNotFound ? "not_found" : "error",
        statusCode: response.status,
        remoteHost,
      };
    }
    try {
      const parsed = await response.json() as ResourceDescriptor;
      return {
        resource: parsed,
        result: "found",
        statusCode: response.status,
        remoteHost,
      };
    } catch (e) {
      if (e instanceof SyntaxError) {
        logger.debug(
          "Failed to parse WebFinger resource descriptor as JSON: {error}",
          { error: e },
        );
        return {
          resource: null,
          result: "invalid",
          statusCode: response.status,
          remoteHost,
        };
      }
      throw e;
    }
  }
}
