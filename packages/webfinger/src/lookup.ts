import type { GetUserAgentOptions } from "@fedify/vocab-runtime";
import {
  SpanKind,
  SpanStatusCode,
  trace,
  type TracerProvider,
} from "@opentelemetry/api";
import metadata from "../deno.json" with { type: "json" };
import type { ResourceDescriptor } from "./jrd.ts";
import { lookupWebFingerInternal } from "./lookup-impl.ts";

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
  return await tracer.startActiveSpan(
    "webfinger.lookup",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "webfinger.resource": resource.toString(),
        "webfinger.resource.scheme": typeof resource === "string"
          ? resource.replace(/:.*$/, "")
          : resource.protocol.replace(/:$/, ""),
      },
    },
    async (span) => {
      try {
        const result = await lookupWebFingerInternal(resource, options);
        span.setStatus({
          code: result === null ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
