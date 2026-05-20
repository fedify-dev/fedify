import { Link as LinkObject, Tombstone } from "@fedify/vocab";
import type { Link, ResourceDescriptor } from "@fedify/webfinger";
import { getLogger } from "@logtape/logtape";
import type { MeterProvider, Span, Tracer } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { domainToASCII } from "node:url";
import type {
  ActorAliasMapper,
  ActorDispatcher,
  ActorHandleMapper,
  WebFingerLinksDispatcher,
} from "./callback.ts";
import type { RequestContext } from "./context.ts";
import {
  recordWebFingerHandle,
  type WebFingerHandleResult,
  type WebFingerResourceScheme,
} from "./metrics.ts";

const logger = getLogger(["fedify", "webfinger", "server"]);

/**
 * Parameters for {@link handleWebFinger}.
 */
export interface WebFingerHandlerParameters<TContextData> {
  /**
   * The request context.
   */
  context: RequestContext<TContextData>;

  /**
   * The canonical hostname of the server, if it's explicitly configured.
   * @since 1.5.0
   */
  host?: string;

  /**
   * The callback for dispatching the actor.
   */
  actorDispatcher?: ActorDispatcher<TContextData>;

  /**
   * The callback for mapping a WebFinger username to the corresponding actor's
   * internal identifier, or `null` if the username is not found.
   * @since 0.15.0
   */
  actorHandleMapper?: ActorHandleMapper<TContextData>;

  /**
   * The callback for mapping a WebFinger query to the corresponding actor's
   * internal identifier or username, or `null` if the query is not found.
   * @since 1.4.0
   */
  actorAliasMapper?: ActorAliasMapper<TContextData>;

  /**
   * The callback for dispatching the Links of webFinger.
   */
  webFingerLinksDispatcher?: WebFingerLinksDispatcher<TContextData>;

  /**
   * The function to call when the actor is not found.
   */
  onNotFound(request: Request): Response | Promise<Response>;

  /**
   * The OpenTelemetry tracer.
   * @since 1.3.0
   */
  tracer?: Tracer;

  /**
   * The span for the request.
   * @since 1.3.0
   */
  span?: Span;

  /**
   * The OpenTelemetry meter provider used to record the `webfinger.handle`
   * counter and `webfinger.handle.duration` histogram.  When omitted, no
   * WebFinger-specific measurements are emitted (the request still
   * contributes to `fedify.http.server.request.*` because that metric is
   * recorded one layer up in `Federation.fetch`).
   * @since 2.3.0
   */
  meterProvider?: MeterProvider;
}

/**
 * Handles a WebFinger request.  You would not typically call this function
 * directly, but instead use {@link Federation.fetch} method.
 * @param request The WebFinger request to handle.
 * @param parameters The parameters for handling the request.
 * @returns The response to the request.
 */
export async function handleWebFinger<TContextData>(
  request: Request,
  options: WebFingerHandlerParameters<TContextData>,
): Promise<Response> {
  const meterProvider = options.meterProvider;
  const start = meterProvider == null ? 0 : performance.now();
  const resource = options.context.url.searchParams.get("resource");
  const scheme = computeResourceScheme(resource);
  // Track whether the response was produced by the caller's `onNotFound`
  // callback so the `webfinger.handle.result` attribute classifies as
  // `not_found` regardless of the status code that callback returned.
  // Frameworks routinely answer 404s with a 200 OK fallback page; without
  // this signal, every such response would skew the metric to `resolved`.
  let notFoundResponse: Response | undefined;
  const wrappedOptions: WebFingerHandlerParameters<TContextData> = {
    ...options,
    async onNotFound(req) {
      const r = await options.onNotFound(req);
      notFoundResponse = r;
      return r;
    },
  };
  let response: Response | undefined;
  try {
    if (options.tracer == null) {
      response = await handleWebFingerInternal(request, wrappedOptions);
    } else {
      response = await options.tracer.startActiveSpan(
        "webfinger.handle",
        { kind: SpanKind.SERVER },
        async (span) => {
          try {
            const inner = await handleWebFingerInternal(
              request,
              wrappedOptions,
            );
            span.setStatus({
              code: inner.ok ? SpanStatusCode.UNSET : SpanStatusCode.ERROR,
            });
            return inner;
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
    return response;
  } finally {
    if (meterProvider != null) {
      recordWebFingerHandle(meterProvider, {
        durationMs: Math.max(0, performance.now() - start),
        result: classifyWebFingerHandleResult(response, notFoundResponse),
        scheme,
        statusCode: response?.status,
      });
    }
  }
}

// The scheme attribute is recorded on the `webfinger.handle` metric, whose
// resource value comes from an attacker-controlled query string.  Buckets are
// whitelisted to the schemes WebFinger / fediverse clients legitimately use
// (RFC 7565 + ActivityPub), with anything else bucketed as `other`.  This
// keeps metric cardinality bounded even when a client probes Fedify with
// arbitrary, very long, or control-character-bearing prefixes.
const WEBFINGER_HANDLE_SCHEME_WHITELIST: ReadonlySet<
  Exclude<WebFingerResourceScheme, "other">
> = new Set(["acct", "http", "https", "mailto"]);

function isAllowedResourceScheme(
  scheme: string,
): scheme is Exclude<WebFingerResourceScheme, "other"> {
  return (WEBFINGER_HANDLE_SCHEME_WHITELIST as ReadonlySet<string>).has(scheme);
}

function computeResourceScheme(
  resource: string | null,
): WebFingerResourceScheme | undefined {
  if (resource == null) return undefined;
  const colon = resource.indexOf(":");
  if (colon <= 0) return undefined;
  const candidate = resource.substring(0, colon).toLowerCase();
  return isAllowedResourceScheme(candidate) ? candidate : "other";
}

function classifyWebFingerHandleResult(
  response: Response | undefined,
  notFoundResponse: Response | undefined,
): WebFingerHandleResult {
  if (response == null) return "error";
  // When the response was produced by the caller's `onNotFound`, the
  // outcome is `not_found` regardless of the status code the callback
  // chose (frameworks may return 200 with a fallback page).
  if (notFoundResponse != null && response === notFoundResponse) {
    return "not_found";
  }
  switch (response.status) {
    case 200:
      return "resolved";
    case 400:
      return "invalid";
    case 404:
      return "not_found";
    case 410:
      return "tombstoned";
    default:
      return "error";
  }
}

async function handleWebFingerInternal<TContextData>(
  request: Request,
  {
    context,
    host,
    actorDispatcher,
    actorHandleMapper,
    actorAliasMapper,
    onNotFound,
    span,
    webFingerLinksDispatcher,
  }: WebFingerHandlerParameters<TContextData>,
): Promise<Response> {
  if (actorDispatcher == null) {
    logger.error("Actor dispatcher is not set.");
    return await onNotFound(request);
  }
  const resource = context.url.searchParams.get("resource");
  if (resource == null) {
    return new Response("Missing resource parameter.", { status: 400 });
  }
  span?.setAttribute("webfinger.resource", resource);
  let resourceUrl: URL;
  try {
    resourceUrl = new URL(resource);
  } catch (e) {
    if (e instanceof TypeError) {
      return new Response("Invalid resource URL.", { status: 400 });
    }
    throw e;
  }
  span?.setAttribute(
    "webfinger.resource.scheme",
    resourceUrl.protocol.replace(/:$/, ""),
  );

  async function mapUsernameToIdentifier(
    username: string,
  ): Promise<string | null> {
    if (actorHandleMapper == null) {
      logger.error(
        "No actor handle mapper is set; use the WebFinger username {username}" +
          " as the actor's internal identifier.",
        { username },
      );
      return username;
    }
    const identifier = await actorHandleMapper(context, username);
    if (identifier == null) {
      logger.error("Actor {username} not found.", { username });
      return null;
    }
    return identifier;
  }

  let identifier: string | null = null;
  const uriParsed = context.parseUri(resourceUrl);
  if (uriParsed?.type != "actor") {
    const match = /^acct:([^@]+)@([^@]+)$/.exec(resource);
    if (match == null) {
      const result = await actorAliasMapper?.(context, resourceUrl);
      if (result == null) return await onNotFound(request);
      if ("identifier" in result) identifier = result.identifier;
      else {
        identifier = await mapUsernameToIdentifier(
          result.username,
        );
      }
    } else {
      const portMatch = /:\d+$/.exec(match[2]);
      const normalizedHost = portMatch == null
        ? domainToASCII(match[2].toLowerCase())
        : domainToASCII(match[2].substring(0, portMatch.index).toLowerCase()) +
          portMatch[0];
      if (normalizedHost != context.url.host && normalizedHost != host) {
        return await onNotFound(request);
      } else {
        identifier = await mapUsernameToIdentifier(match[1]);
        resourceUrl = new URL(`acct:${match[1]}@${normalizedHost}`);
      }
    }
  } else {
    identifier = uriParsed.identifier;
  }
  if (identifier == null) {
    return await onNotFound(request);
  }
  const actor = await actorDispatcher(context, identifier);
  if (actor == null) {
    logger.error("Actor {identifier} not found.", { identifier });
    return await onNotFound(request);
  }
  if (actor instanceof Tombstone) {
    return new Response(null, {
      status: 410,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  const links: Link[] = [
    {
      rel: "self",
      href: context.getActorUri(identifier).href,
      type: "application/activity+json",
    },
  ];
  for (const url of actor.urls) {
    if (url instanceof LinkObject && url.href != null) {
      links.push({
        rel: url.rel ?? "http://webfinger.net/rel/profile-page",
        href: url.href.href,
        type: url.mediaType == null ? undefined : url.mediaType,
      });
    } else if (url instanceof URL) {
      links.push({
        rel: "http://webfinger.net/rel/profile-page",
        href: url.href,
      });
    }
  }
  for await (const image of actor.getIcons()) {
    if (image.url?.href == null) continue;
    links.push({
      rel: "http://webfinger.net/rel/avatar",
      href: image.url.href.toString(),
      ...(image.mediaType != null && { type: image.mediaType }),
    });
  }

  if (webFingerLinksDispatcher != null) {
    const customLinks = await webFingerLinksDispatcher(context, resourceUrl);
    if (customLinks != null) {
      for (const link of customLinks) {
        links.push(link);
      }
    }
  }

  const aliases: string[] = [];
  const preferredUsername = actor.preferredUsername;
  if (resourceUrl.protocol != "acct:" && preferredUsername != null) {
    aliases.push(`acct:${preferredUsername}@${host ?? context.url.host}`);
    if (host != null && host !== context.url.host) {
      aliases.push(`acct:${preferredUsername}@${context.url.host}`);
    }
  }
  if (resourceUrl.href !== context.getActorUri(identifier).href) {
    aliases.push(context.getActorUri(identifier).href);
  }
  if (
    resourceUrl.protocol === "acct:" && host != null &&
    host !== context.url.host &&
    !resourceUrl.href.endsWith(`@${host}`)
  ) {
    const username = resourceUrl.href.replace(/^acct:/, "").replace(/@.*$/, "");
    aliases.push(`acct:${username}@${host}`);
  }
  const jrd: ResourceDescriptor = {
    subject: resourceUrl.href,
    aliases,
    links,
  };
  return new Response(JSON.stringify(jrd), {
    headers: {
      "Content-Type": "application/jrd+json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
