import type { GetUserAgentOptions } from "@fedify/vocab-runtime";
import {
  canonicalizePortableUri,
  formatIri,
  fromCompatibleEf61Id,
  isGatewayUrl,
} from "@fedify/vocab-runtime";
import { lookupWebFinger, type ResourceDescriptor } from "@fedify/webfinger";
import {
  type Attributes,
  type Counter,
  type Histogram,
  type MeterProvider,
  SpanStatusCode,
  trace,
  type TracerProvider,
} from "@opentelemetry/api";
import { domainToASCII, domainToUnicode } from "node:url";
import metadata from "../deno.json" with { type: "json" };
import { getTypeId } from "./type.ts";
import { Application, Group, Organization, Person, Service } from "./vocab.ts";

/**
 * The terminal classification of a {@link getActorHandle} call, recorded as
 * the `activitypub.actor.discovery.result` attribute on the
 * `activitypub.actor.discovery` counter and
 * `activitypub.actor.discovery.duration` histogram.
 *
 *  -  `resolved`: a handle was returned to the caller.
 *  -  `not_found`: WebFinger did not yield a usable `acct:` alias and the
 *     `preferredUsername` fallback could not run.  This corresponds to the
 *     `TypeError("Actor does not have enough information…")` path.
 *  -  `error`: any other thrown exception bubbled up from the lookup.
 *
 * Per-WebFinger-call failure detail (HTTP status, parse failure, network
 * failure, etc.) lives on `webfinger.lookup` and is intentionally not
 * duplicated here.
 * @since 2.3.0
 */
export type ActorDiscoveryResult = "resolved" | "not_found" | "error";

interface ActorDiscoveryInstruments {
  discovery: Counter;
  discoveryDuration: Histogram;
}

const ACTOR_DISCOVERY_HISTOGRAM_BUCKETS: ReadonlyArray<number> = [
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

const actorDiscoveryInstruments = new WeakMap<
  MeterProvider,
  ActorDiscoveryInstruments
>();

function getActorDiscoveryInstruments(
  meterProvider: MeterProvider,
): ActorDiscoveryInstruments {
  let instruments = actorDiscoveryInstruments.get(meterProvider);
  if (instruments == null) {
    const meter = meterProvider.getMeter(metadata.name, metadata.version);
    instruments = {
      discovery: meter.createCounter("activitypub.actor.discovery", {
        description: "Actor handle discovery attempts via getActorHandle(), " +
          "classified by terminal outcome.",
        unit: "{discovery}",
      }),
      discoveryDuration: meter.createHistogram(
        "activitypub.actor.discovery.duration",
        {
          description: "Duration of getActorHandle() actor discovery calls.",
          unit: "ms",
          advice: {
            explicitBucketBoundaries: [...ACTOR_DISCOVERY_HISTOGRAM_BUCKETS],
          },
        },
      ),
    };
    actorDiscoveryInstruments.set(meterProvider, instruments);
  }
  return instruments;
}

function getActorDiscoveryRemoteHost(
  actor: Actor | URL,
): string | undefined {
  const id = actor instanceof URL ? actor : actor.id;
  if (id == null) return undefined;
  // The authority of a portable ID is a DID, not a host; the handle of
  // a portable actor comes from its first gateway:
  if (isPortableActorId(id)) {
    return actor instanceof URL ? undefined : actor.gateway?.host;
  }
  return id.host === "" ? undefined : id.host;
}

// Subclass of TypeError that preserves the documented `throws {TypeError}`
// API contract while letting the actor-discovery metric distinguish the
// "actor lacks enough information to derive a handle" terminal path from
// other TypeError-shaped failures that can come from malformed remote data
// (e.g. an alias that does not parse as a URL, or an invalid preferred
// username that breaks normalizeActorHandle).
class ActorHandleNotFoundError extends TypeError {
  constructor() {
    super("Actor does not have enough information to get the handle.");
    this.name = "ActorHandleNotFoundError";
  }
}

/**
 * Actor types are {@link Object} types that are capable of performing
 * activities.
 */
export type Actor = Application | Group | Organization | Person | Service;

/**
 * Checks if the given object is an {@link Actor}.
 * @param object The object to check.
 * @returns `true` if the given object is an {@link Actor}.
 */
export function isActor(object: unknown): object is Actor {
  return (
    object instanceof Application ||
    object instanceof Group ||
    object instanceof Organization ||
    object instanceof Person ||
    object instanceof Service
  );
}

/**
 * A string representation of an actor type name.
 */
export type ActorTypeName =
  | "Application"
  | "Group"
  | "Organization"
  | "Person"
  | "Service";

/**
 * Gets the type name of the given actor.
 * @param actor The actor to get the type name of.
 * @returns The type name of the given actor.
 */
export function getActorTypeName(
  actor: Actor,
): ActorTypeName {
  if (actor instanceof Application) return "Application";
  else if (actor instanceof Group) return "Group";
  else if (actor instanceof Organization) return "Organization";
  else if (actor instanceof Person) return "Person";
  else if (actor instanceof Service) return "Service";
  throw new Error("Unknown actor type.");
}

/**
 * Gets the actor class by the given type name.
 * @param typeName The type name to get the actor class by.
 * @returns The actor class by the given type name.
 */
export function getActorClassByTypeName(
  typeName: ActorTypeName,
):
  | typeof Application
  | typeof Group
  | typeof Organization
  | typeof Person
  | typeof Service {
  switch (typeName) {
    case "Application":
      return Application;
    case "Group":
      return Group;
    case "Organization":
      return Organization;
    case "Person":
      return Person;
    case "Service":
      return Service;
  }
  throw new Error("Unknown actor type name.");
}

/**
 * Options for {@link getActorHandle}.
 * @since 1.3.0
 */
export interface GetActorHandleOptions extends NormalizeActorHandleOptions {
  /**
   * The options for making `User-Agent` header.
   * If a string is given, it is used as the `User-Agent` header value.
   * If an object is given, it is passed to {@link getUserAgent} to generate
   * the `User-Agent` header value.
   * @since 1.3.0
   */
  userAgent?: GetUserAgentOptions | string;

  /**
   * The OpenTelemetry tracer provider.  If omitted, the global tracer provider
   * is used.
   * @since 1.3.0
   */
  tracerProvider?: TracerProvider;

  /**
   * The OpenTelemetry meter provider used to record the
   * `activitypub.actor.discovery` counter and
   * `activitypub.actor.discovery.duration` histogram.  When set, the same
   * meter provider is also forwarded to the nested WebFinger lookups so
   * each discovery emits both the actor-discovery measurements and the
   * underlying `webfinger.lookup` measurements.  If omitted, no
   * measurements are emitted (the helper is opt-in to avoid touching the
   * global meter provider for callers that do not use OpenTelemetry).
   * @since 2.3.0
   */
  meterProvider?: MeterProvider;
}

/**
 * Gets the actor handle, of the form `@username@domain`, from the given actor
 * or an actor URI.
 *
 * @example
 * ``` typescript
 * // Get the handle of an actor object:
 * await getActorHandle(
 *   new Person({ id: new URL("https://fosstodon.org/users/hongminhee") })
 * );
 *
 * // Get the handle of an actor URI:
 * await getActorHandle(new URL("https://fosstodon.org/users/hongminhee"));
 * ```
 *
 * For an [FEP-ef61] portable actor, whose ID is an `ap:` or `ap+ef61:` URI,
 * the domain is taken from the first gateway in the actor's `gateways` rather
 * than from its ID.  The handle is returned only if its WebFinger response
 * links back to the actor, since the actor's `gateways` are claimed by the
 * actor itself; a failed WebFinger lookup is not enough information to get
 * the handle.  A portable actor without `gateways` or
 * `preferredUsername`, or a portable actor URI (which does not tell its
 * gateways), is not supported.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 *
 * @param actor The actor or actor URI to get the handle from.
 * @param options The extra options for getting the actor handle.
 * @returns The actor handle.  It starts with `@` and is followed by the
 *          username and domain, separated by `@` by default (it can be
 *          customized with the options).
 * @throws {TypeError} If the actor does not have enough information to get the
 *                     handle.
 * @since 0.4.0
 */
export async function getActorHandle(
  actor: Actor | URL,
  options: GetActorHandleOptions = {},
): Promise<`@${string}@${string}` | `${string}@${string}`> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(
    metadata.name,
    metadata.version,
  );
  return await tracer.startActiveSpan(
    "activitypub.get_actor_handle",
    async (span) => {
      if (isActor(actor)) {
        if (actor.id != null) {
          span.setAttribute("activitypub.actor.id", actor.id.href);
        }
        span.setAttribute("activitypub.actor.type", getTypeId(actor).href);
      }
      const meterProvider = options.meterProvider;
      const start = meterProvider == null ? 0 : performance.now();
      let result: ActorDiscoveryResult = "error";
      try {
        const handle = await getActorHandleInternal(actor, options);
        result = "resolved";
        return handle;
      } catch (error) {
        result = error instanceof ActorHandleNotFoundError
          ? "not_found"
          : "error";
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(error),
        });
        throw error;
      } finally {
        if (meterProvider != null) {
          const attributes: Attributes = {
            "activitypub.actor.discovery.result": result,
          };
          const host = getActorDiscoveryRemoteHost(actor);
          if (host != null) attributes["activitypub.remote.host"] = host;
          const instruments = getActorDiscoveryInstruments(meterProvider);
          instruments.discovery.add(1, attributes);
          instruments.discoveryDuration.record(
            Math.max(0, performance.now() - start),
            attributes,
          );
        }
        span.end();
      }
    },
  );
}

async function getActorHandleInternal(
  actor: Actor | URL,
  options: GetActorHandleOptions = {},
): Promise<`@${string}@${string}` | `${string}@${string}`> {
  const actorId = actor instanceof URL ? actor : actor.id;
  if (actorId != null && isPortableActorId(actorId)) {
    if (actor instanceof URL) throw new ActorHandleNotFoundError();
    return await getPortableActorHandle(actor, actorId, options);
  }
  if (actorId != null) {
    const result = await lookupWebFinger(actorId, {
      userAgent: options.userAgent,
      tracerProvider: options.tracerProvider,
      meterProvider: options.meterProvider,
    });
    if (result != null) {
      const aliases = [...(result.aliases ?? [])];
      if (result.subject != null) aliases.unshift(result.subject);
      for (const alias of aliases) {
        const match = alias.match(/^acct:([^@]+)@([^@]+)$/);
        if (match != null) {
          const hostname = new URL(`https://${match[2]}/`).hostname;
          if (
            hostname !== actorId.hostname &&
            !await verifyCrossOriginActorHandle(
              actorId.href,
              alias,
              options.userAgent,
              options.tracerProvider,
              options.meterProvider,
            )
          ) {
            continue;
          }
          return normalizeActorHandle(`@${match[1]}@${match[2]}`, options);
        }
      }
    }
  }
  if (
    !(actor instanceof URL) && actor.preferredUsername != null &&
    actor.id != null
  ) {
    return normalizeActorHandle(
      `@${actor.preferredUsername}@${actor.id.host}`,
      options,
    );
  }
  throw new ActorHandleNotFoundError();
}

function isPortableActorId(id: URL): boolean {
  return id.protocol === "ap:" || id.protocol === "ap+ef61:";
}

/**
 * The reverse discovery of an FEP-ef61 portable actor's WebFinger address,
 * which takes the domain from the first gateway in its `gateways`.
 */
async function getPortableActorHandle(
  actor: Actor,
  actorId: URL,
  options: GetActorHandleOptions,
): Promise<`@${string}@${string}` | `${string}@${string}`> {
  const gateway = actor.gateway;
  const username = actor.preferredUsername?.toString();
  if (gateway == null || !isGatewayUrl(gateway) || username == null) {
    throw new ActorHandleNotFoundError();
  }
  const canonicalId = canonicalizePortableUri(formatIri(actorId));
  const handle = `acct:${username}@${gateway.host}`;
  const result = await lookupWebFinger(handle, {
    userAgent: options.userAgent,
    tracerProvider: options.tracerProvider,
    meterProvider: options.meterProvider,
  });
  // Unlike an ordinary actor, whose ID vouches for its host, a portable
  // actor's gateways are claimed by the actor itself, so there is no
  // fallback when the gateway does not link back to the actor:
  if (result == null || !linksToPortableActor(result, canonicalId)) {
    throw new ActorHandleNotFoundError();
  }
  // The subject is the canonical address when it differs from the queried
  // one; follow it once if it also links back to the actor:
  const subject = result.subject?.match(/^acct:([^@]+)@([^@]+)$/);
  if (subject != null && result.subject !== handle) {
    const subjectResult = await lookupWebFinger(result.subject!, {
      userAgent: options.userAgent,
      tracerProvider: options.tracerProvider,
      meterProvider: options.meterProvider,
    });
    if (
      subjectResult != null && linksToPortableActor(subjectResult, canonicalId)
    ) {
      return normalizeActorHandle(`@${subject[1]}@${subject[2]}`, options);
    }
  }
  return normalizeActorHandle(`@${username}@${gateway.host}`, options);
}

/**
 * Checks if the first ActivityStreams `self` link of a WebFinger response
 * identifies the portable actor, either by its portable ID or by
 * a compatible identifier.
 */
function linksToPortableActor(
  jrd: ResourceDescriptor,
  canonicalId: string,
): boolean {
  const link = jrd.links?.find((l) =>
    l.rel === "self" && l.href != null &&
    (l.type === "application/activity+json" ||
      l.type?.match(
          /application\/ld\+json;\s*profile="https:\/\/www.w3.org\/ns\/activitystreams"/,
        ) != null)
  );
  if (link?.href == null) return false;
  try {
    let id: string;
    if (/^ap(?:\+ef61)?:/i.test(link.href)) id = link.href;
    else {
      const portable = URL.canParse(link.href)
        ? fromCompatibleEf61Id(link.href)
        : null;
      if (portable == null) return false;
      id = formatIri(portable);
    }
    return canonicalizePortableUri(id) === canonicalId;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

async function verifyCrossOriginActorHandle(
  actorId: string,
  alias: string,
  userAgent: GetUserAgentOptions | string | undefined,
  tracerProvider: TracerProvider | undefined,
  meterProvider: MeterProvider | undefined,
): Promise<boolean> {
  const response = await lookupWebFinger(alias, {
    userAgent,
    tracerProvider,
    meterProvider,
  });
  if (response == null) return false;
  for (const alias of response.aliases ?? []) {
    if (new URL(alias).href === actorId) return true;
  }
  return false;
}

/**
 * Options for {@link normalizeActorHandle}.
 * @since 0.9.0
 */
export interface NormalizeActorHandleOptions {
  /**
   * Whether to trim the leading `@` from the actor handle.  Turned off by
   * default.
   */
  trimLeadingAt?: boolean;

  /**
   * Whether to convert the domain part of the actor handle to punycode, if it
   * is an internationalized domain name.  Turned off by default.
   */
  punycode?: boolean;
}

/**
 * Normalizes the given actor handle.
 * @param handle The full handle of the actor to normalize.
 * @param options The options for normalizing the actor handle.
 * @returns The normalized actor handle.
 * @throws {TypeError} If the actor handle is invalid.
 * @since 0.9.0
 */
export function normalizeActorHandle(
  handle: string,
  options: NormalizeActorHandleOptions = {},
): `@${string}@${string}` | `${string}@${string}` {
  handle = handle.replace(/^@/, "");
  const atPos = handle.indexOf("@");
  if (atPos < 1) throw new TypeError("Invalid actor handle.");
  let domain = handle.substring(atPos + 1);
  if (domain.length < 1 || domain.includes("@")) {
    throw new TypeError("Invalid actor handle.");
  }
  domain = domain.toLowerCase();
  domain = options.punycode ? domainToASCII(domain) : domainToUnicode(domain);
  domain = domain.toLowerCase();
  const user = handle.substring(0, atPos);
  return options.trimLeadingAt ? `${user}@${domain}` : `@${user}@${domain}`;
}

/**
 * The object that can be a recipient of an activity.
 *
 * Note that every {@link Actor} is also a {@link Recipient}.
 */
export interface Recipient {
  /**
   * The URI of the actor.
   */
  readonly id: URL | null;

  /**
   * The URI of the actor's inbox.
   */
  readonly inboxId: URL | null;

  /**
   * The endpoints of the actor.
   */
  readonly endpoints?: {
    /**
     * The URI of the actor's shared inbox.
     */
    readonly sharedInbox: URL | null;
  } | null;
}
