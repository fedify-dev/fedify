import {
  type LanguageString,
  Link as LinkObject,
  Tombstone,
} from "@fedify/vocab";
import type { Link, ResourceDescriptor } from "@fedify/webfinger";
import { getLogger } from "@logtape/logtape";
import type { Span, Tracer } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { domainToASCII } from "node:url";
import type {
  ActorAliasMapper,
  ActorDispatcher,
  ActorHandleMapper,
  WebFingerLinksDispatcher,
} from "./callback.ts";
import type { RequestContext } from "./context.ts";

const logger = getLogger(["fedify", "webfinger", "server"]);

interface WebFingerSubjectAndAliasesOptions {
  resourceUrl: URL;
  actorUri: URL;
  preferredUsername: string | LanguageString | null | undefined;
  acctUsername: string | null;
  host: string | undefined;
  contextHost: string;
}

function getWebFingerSubjectAndAliases(
  {
    resourceUrl,
    actorUri,
    preferredUsername,
    acctUsername,
    host,
    contextHost,
  }: WebFingerSubjectAndAliasesOptions,
): Pick<ResourceDescriptor, "subject" | "aliases"> {
  const aliases: string[] = [];
  let subject = resourceUrl.href;
  if (resourceUrl.protocol != "acct:" && preferredUsername != null) {
    aliases.push(`acct:${preferredUsername}@${host ?? contextHost}`);
    if (host != null && host !== contextHost) {
      aliases.push(`acct:${preferredUsername}@${contextHost}`);
    }
  }
  if (resourceUrl.href !== actorUri.href) {
    aliases.push(actorUri.href);
  }
  if (
    resourceUrl.protocol === "acct:" && host != null &&
    host !== contextHost &&
    !resourceUrl.href.endsWith(`@${host}`)
  ) {
    subject = `acct:${preferredUsername ?? acctUsername}@${host}`;
    aliases.push(resourceUrl.href);
    if (
      preferredUsername != null && preferredUsername !== "" &&
      preferredUsername !== acctUsername
    ) {
      aliases.push(`acct:${preferredUsername}@${contextHost}`);
    }
  }
  return { subject, aliases };
}

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
  let acctUsername: string | null = null;
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
        acctUsername = match[1];
        identifier = await mapUsernameToIdentifier(acctUsername);
        resourceUrl = new URL(`acct:${acctUsername}@${normalizedHost}`);
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
  const actorUri = context.getActorUri(identifier);
  const links: Link[] = [
    {
      rel: "self",
      href: actorUri.href,
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

  const { subject, aliases } = getWebFingerSubjectAndAliases({
    resourceUrl,
    actorUri,
    preferredUsername: actor.preferredUsername,
    acctUsername,
    host,
    contextHost: context.url.host,
  });
  const jrd: ResourceDescriptor = {
    subject,
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
