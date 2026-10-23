import type { GetUserAgentOptions } from "@fedify/vocab-runtime";
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

import {
  type LookupWebFingerDependencies,
  lookupWebFingerInternal,
} from "./lookup-impl.ts";

/**
 * The terminal classification of an outgoing {@link lookupWebFinger} call,
 * recorded as the `webfinger.lookup.result` attribute on the
 * `webfinger.lookup` counter and `webfinger.lookup.duration` histogram.
 *
 *  -  `found`: the lookup returned a {@link ResourceDescriptor}.
 *  -  `not_found`: the remote responded with HTTP `404 Not Found` or
 *     `410 Gone`.  Recorded together with `http.response.status_code`.
 *  -  `invalid`: the remote responded with content Fedify could not parse
 *     into a {@link ResourceDescriptor} (JSON parse failure or a body over
 *     the size limit), the redirect chain exceeded `maxRedirection`, the
 *     remote redirected to a different protocol, or the queried `acct:`
 *     resource itself was malformed.
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

export interface WebFingerLookupOutcome {
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
  return await lookupWebFingerWithDependencies(resource, options);
}

/**
 * The lookup implementation with injectable hop sessions for tests.
 * Not exported from the package entry point.
 * @internal
 */
export async function lookupWebFingerWithDependencies(
  resource: URL | string,
  options: LookupWebFingerOptions = {},
  deps: LookupWebFingerDependencies = {},
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
        outcome = await lookupWebFingerInternal(resource, options, deps);
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
