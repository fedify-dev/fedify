import { getLogger } from "@logtape/logtape";
import type { Span, Tracer } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { domainToASCII } from "node:url";
import type {
  ActorAliasMapper,
  ActorDispatcher,
  ActorHandleMapper,
} from "../federation/callback.ts";
import type { RequestContext } from "../federation/context.ts";
import { Link as LinkObject } from "../vocab/mod.ts";
import type { Link, ResourceDescriptor } from "./jrd.ts";

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
  if (options.tracer == null) {
    return await handleWebFingerInternal(request, options);
  }
  return await options.tracer.startActiveSpan(
    "webfinger.handle",
    { kind: SpanKind.SERVER },
    async (span) => {
      try {
        const response = await handleWebFingerInternal(request, options);
        span.setStatus({
          code: response.ok ? SpanStatusCode.UNSET : SpanStatusCode.ERROR,
        });
        return response;
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
  }: WebFingerHandlerParameters<TContextData>,
): Promise<Response> {
  if (actorDispatcher == null) return await onNotFound(request);
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
  if (actorDispatcher == null) {
    logger.error("Actor dispatcher is not set.");
    return await onNotFound(request);
  }

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
    const link: Link = {
      rel: "http://webfinger.net/rel/avatar",
      href: image.url.href.toString(),
    };
    if (image.mediaType != null) link.type = image.mediaType;
    links.push(link);
  }
  const aliases: string[] = [];
  if (resourceUrl.protocol != "acct:" && actor.preferredUsername != null) {
    aliases.push(`acct:${actor.preferredUsername}@${host ?? context.url.host}`);
    if (host != null && host !== context.url.host) {
      aliases.push(`acct:${actor.preferredUsername}@${context.url.host}`);
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
