import type {
  GetUserAgentOptions,
  PortableObjectVerifier,
} from "@fedify/vocab-runtime";
import {
  canonicalizePortableUri,
  type DocumentLoader,
  formatIri,
  fromCompatibleEf61Id,
  getDocumentLoader,
  haveSameFe34Origin,
  haveSameIriOrigin,
  parseIri,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import {
  dereferencePortableIri,
  getPortableGatewayCandidates,
  isPortableIri,
  PortableObjectRejectedError,
} from "@fedify/vocab-runtime/internal/portable-dereference";
import { lookupWebFinger } from "@fedify/webfinger";
import { getLogger } from "@logtape/logtape";
import {
  type Attributes,
  type Counter,
  type MeterProvider,
  SpanStatusCode,
  trace,
  type TracerProvider,
} from "@opentelemetry/api";
import { delay } from "es-toolkit";
import metadata from "../deno.json" with { type: "json" };
import { isActor } from "./actor.ts";
import { toAcctUrl } from "./handle.ts";
import { getTypeId } from "./type.ts";
import { type Collection, type Link, Object } from "./vocab.ts";

/**
 * The classification of an ActivityStreams lookup performed by
 * {@link lookupObject}, recorded as `activitypub.lookup.kind` on the
 * `activitypub.object.lookup` counter.
 *
 *  -  `actor`: the resolved object is an {@link import("./actor.ts").Actor}.
 *  -  `object`: the resolved object is a non-actor ActivityStreams object.
 *  -  `other`: the lookup did not resolve to an object (not found, network
 *     failure, parse failure).
 * @since 2.3.0
 */
export type ObjectLookupKind = "actor" | "object" | "other";

const objectLookupCounters = new WeakMap<MeterProvider, Counter>();

function getObjectLookupCounter(meterProvider: MeterProvider): Counter {
  let counter = objectLookupCounters.get(meterProvider);
  if (counter == null) {
    counter = meterProvider
      .getMeter(metadata.name, metadata.version)
      .createCounter("activitypub.object.lookup", {
        description:
          "ActivityStreams object lookups via lookupObject(), classified " +
          "by whether the resolved value is an Actor.",
        unit: "{lookup}",
      });
    objectLookupCounters.set(meterProvider, counter);
  }
  return counter;
}

function getLookupRemoteHost(identifier: string | URL): string | undefined {
  let url: URL | undefined;
  if (identifier instanceof URL) {
    url = identifier;
  } else if (PORTABLE_IRI_PATTERN.test(identifier)) {
    // The authority of a portable IRI is a DID, not a host:
    return undefined;
  } else {
    try {
      url = new URL(identifier);
    } catch {
      // Not a URL — try to interpret as a bare fediverse handle below.
      const stripped = identifier.startsWith("@")
        ? identifier.slice(1)
        : identifier;
      return extractHandleHost(stripped);
    }
  }
  if (isPortableIri(url)) return undefined;
  if (url.host !== "") return url.host;
  // `acct:` URIs are opaque (no `//host` form), so the URL host is empty.
  // The user and authority live in `url.pathname` as
  // `user@host`; reuse the same handle-extraction logic, which both
  // takes only the substring after the last `@` and refuses to record
  // anything that looks like a path / query / fragment rather than a
  // bare host.
  if (url.protocol === "acct:") return extractHandleHost(url.pathname);
  return undefined;
}

function extractHandleHost(handle: string): string | undefined {
  const at = handle.lastIndexOf("@");
  if (at < 0 || at >= handle.length - 1) return undefined;
  const candidate = handle.slice(at + 1);
  // Reject anything that is not just an authority — paths, queries,
  // fragments, and spaces would all leak high-cardinality metadata into
  // the metric attribute, so we drop the host entirely in those cases.
  if (/[/?#\s]/.test(candidate)) return undefined;
  // Round-trip through `URL` so the parser validates the authority and
  // strips any userinfo before we record it.
  try {
    return new URL(`https://${candidate}`).host || undefined;
  } catch {
    return undefined;
  }
}

const logger = getLogger(["fedify", "vocab", "lookup"]);

/**
 * Options for the {@link lookupObject} function.
 *
 * @since 0.2.0
 */
export interface LookupObjectOptions {
  /**
   * The document loader for loading remote JSON-LD documents.
   */
  documentLoader?: DocumentLoader;

  /**
   * The context loader for loading remote JSON-LD contexts.
   * @since 0.8.0
   */
  contextLoader?: DocumentLoader;

  /**
   * Whether to allow fetching an object with an `@id` having a different
   * origin than the object's URL.  This is not recommended, as it may
   * lead to security issues.  Only use this option if you know what you
   * are doing.
   *
   * How to handle the case when an object's `@id` has a different origin
   * than the object's URL:
   *
   *  -  `"ignore"` (default): Do not return the object, and log a warning.
   *  -  `"throw"`: Throw an error.
   *  -  `"trust"`: Bypass the check and return the object anyway.  This
   *     is not recommended, as it may lead to security issues.  Only use
   *     this option if you know what you are doing.
   *
   * @since 1.9.0
   */
  crossOrigin?: "ignore" | "throw" | "trust";

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
   * `activitypub.object.lookup` counter.  If omitted, the counter is not
   * emitted at all (the helper is opt-in to avoid touching the global
   * meter provider for callers that do not use OpenTelemetry).
   * @since 2.3.0
   */
  meterProvider?: MeterProvider;

  /**
   * AbortSignal for cancelling the request.
   * @since 1.8.0
   */
  signal?: AbortSignal;

  /**
   * The [FEP-ef61] proof policy to apply to portable objects, typically
   * `verifyPortableObjectProof()` from `@fedify/fedify`, which
   * `Context.lookupObject()` uses by default.
   *
   * When it is given, portable `ap:`/`ap+ef61:` identifiers and compatible
   * identifiers (e.g., `https://server.example/.well-known/apgateway/did:...`),
   * whether they are looked up directly or found in the `self` links of
   * a WebFinger response, are fetched through FEP-ef61 gateways.  A fetched
   * portable object is returned only if its `@id` identifies the requested
   * portable object and this function accepts it.  Note that
   * `crossOrigin: "trust"` does not skip these checks.
   *
   * Without it, portable identifiers are not looked up, and compatible
   * identifiers are fetched as ordinary HTTP(S) URLs, whose objects with
   * a portable `@id` are refused as cross-origin objects, even with
   * `crossOrigin: "trust"`.
   *
   * [FEP-ef61]: https://w3id.org/fep/ef61
   * @since 2.4.0
   */
  verifyPortableObject?: PortableObjectVerifier;
}

/**
 * The maximum number of requests to FEP-ef61 gateways that a single
 * {@link lookupObject} call makes for portable objects.  Gateways come from
 * possibly untrusted WebFinger responses and location hints, so they are
 * bounded to keep a single lookup from fanning out to many servers.
 */
const MAX_PORTABLE_ATTEMPTS = 5;

/**
 * Looks up an ActivityStreams object by its URI (including `acct:` URIs)
 * or a fediverse handle (e.g., `@user@server` or `user@server`).
 *
 * @example
 * ``` typescript
 * // Look up an actor by its fediverse handle:
 * await lookupObject("@hongminhee@fosstodon.org");
 * // returning a `Person` object.
 *
 * // A fediverse handle can omit the leading '@':
 * await lookupObject("hongminhee@fosstodon.org");
 * // returning a `Person` object.
 *
 * // A `acct:` URI can be used as well:
 * await lookupObject("acct:hongminhee@fosstodon.org");
 * // returning a `Person` object.
 *
 * // Look up an object by its URI:
 * await lookupObject("https://todon.eu/@hongminhee/112060633798771581");
 * // returning a `Note` object.
 *
 * // It can be a `URL` object as well:
 * await lookupObject(new URL("https://todon.eu/@hongminhee/112060633798771581"));
 * // returning a `Note` object.
 * ```
 *
 * [FEP-ef61] portable objects, including portable actors found through
 * WebFinger, are looked up only if the `verifyPortableObject` option is
 * given; see {@link LookupObjectOptions.verifyPortableObject}.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 *
 * @param identifier The URI or fediverse handle to look up.
 * @param options Lookup options.
 * @returns The object, or `null` if not found.
 * @since 0.2.0
 */
export async function lookupObject(
  identifier: string | URL,
  options: LookupObjectOptions = {},
): Promise<Object | null> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(
    metadata.name,
    metadata.version,
  );
  return await tracer.startActiveSpan(
    "activitypub.lookup_object",
    async (span) => {
      let kind: ObjectLookupKind = "other";
      try {
        const result = await lookupObjectInternal(identifier, options);
        // Classify the result as soon as `lookupObjectInternal` returns,
        // so that any subsequent throw (for example from
        // `result.toJsonLd(options)` while building the span event) does
        // not roll `kind` back to `"other"` in the `finally` block.
        if (result != null) {
          kind = isActor(result) ? "actor" : "object";
        }
        if (result == null) span.setStatus({ code: SpanStatusCode.ERROR });
        else {
          if (result.id != null) {
            span.setAttribute("activitypub.object.id", result.id.href);
          }
          span.setAttribute("activitypub.object.type", getTypeId(result).href);
          if (result.replyTargetIds.length > 0) {
            span.setAttribute(
              "activitypub.object.in_reply_to",
              result.replyTargetIds.map((id) => id.href),
            );
          }

          // Record the fetched object details
          span.addEvent("activitypub.object.fetched", {
            "activitypub.object.type": getTypeId(result).href,
            "activitypub.object.json": JSON.stringify(
              await result.toJsonLd(options),
            ),
          });
        }
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(error),
        });
        throw error;
      } finally {
        if (options.meterProvider != null) {
          const attributes: Attributes = {
            "activitypub.lookup.kind": kind,
          };
          const host = getLookupRemoteHost(identifier);
          if (host != null) attributes["activitypub.remote.host"] = host;
          getObjectLookupCounter(options.meterProvider).add(1, attributes);
        }
        span.end();
      }
    },
  );
}

async function lookupObjectInternal(
  identifier: string | URL,
  options: LookupObjectOptions = {},
): Promise<Object | null> {
  const documentLoader = options.documentLoader ??
    getDocumentLoader({ userAgent: options.userAgent });
  const portable: PortableLookup = {
    options,
    documentLoader,
    attempted: new Set(),
    remaining: MAX_PORTABLE_ATTEMPTS,
  };
  if (typeof identifier === "string") {
    if (PORTABLE_IRI_PATTERN.test(identifier)) {
      const candidate = parsePortableCandidate(identifier);
      if (candidate == null) return null;
      return await lookupPortableObject(portable, candidate, undefined);
    }
    identifier = toAcctUrl(identifier) ?? new URL(identifier);
  }
  if (isPortableIri(identifier)) {
    let candidate: URL;
    try {
      candidate = parseIri(identifier);
    } catch (error) {
      if (error instanceof TypeError) return null;
      throw error;
    }
    return await lookupPortableObject(portable, candidate, undefined);
  }
  let remoteDoc: RemoteDocument | null = null;
  if (identifier.protocol === "http:" || identifier.protocol === "https:") {
    const compatible = getCompatibleCandidate(identifier.href, options);
    if (compatible !== undefined) {
      if (compatible == null) return null;
      return await lookupPortableObject(
        portable,
        compatible.id,
        [compatible.gateway],
      );
    }
    try {
      remoteDoc = await documentLoader(identifier.href, {
        signal: options.signal,
      });
    } catch (error) {
      logger.debug("Failed to fetch remote document:\n{error}", { error });
    }
  }
  if (remoteDoc == null) {
    const jrd = await lookupWebFinger(identifier, {
      userAgent: options.userAgent,
      tracerProvider: options.tracerProvider,
      meterProvider: options.meterProvider,
      allowPrivateAddress: "allowPrivateAddress" in options &&
        options.allowPrivateAddress === true,
      signal: options.signal,
    });
    if (jrd?.links == null) return null;
    const webFingerGateway = getWebFingerGateway(identifier);
    for (const l of jrd.links) {
      if (
        l.type !== "application/activity+json" &&
          !l.type?.match(
            /application\/ld\+json;\s*profile="https:\/\/www.w3.org\/ns\/activitystreams"/,
          ) || l.rel !== "self" || l.href == null
      ) continue;
      if (PORTABLE_IRI_PATTERN.test(l.href)) {
        // FEP-ef61 says the WebFinger host is the actor's first gateway, so
        // ask it first, and then the location hints in the link:
        if (options.verifyPortableObject == null) {
          logger.debug(
            "Skipping the portable self link {href}, as the " +
              "verifyPortableObject option is not given.",
            { href: l.href },
          );
          continue;
        }
        const candidate = parsePortableCandidate(l.href);
        if (candidate == null) continue;
        const gateways = webFingerGateway == null ? [] : [webFingerGateway];
        gateways.push(...getPortableGatewayCandidates(candidate));
        const object = await lookupPortableObject(
          portable,
          candidate,
          gateways,
        );
        if (object != null) return object;
        if (options.signal?.aborted) return null;
        continue;
      }
      const compatible = getCompatibleCandidate(l.href, options);
      if (compatible !== undefined) {
        if (compatible == null) continue;
        const object = await lookupPortableObject(
          portable,
          compatible.id,
          [compatible.gateway],
        );
        if (object != null) return object;
        if (options.signal?.aborted) return null;
        continue;
      }
      try {
        remoteDoc = await documentLoader(l.href, {
          signal: options.signal,
        });
        break;
      } catch (error) {
        logger.debug("Failed to fetch remote document:\n{error}", { error });
        continue;
      }
    }
  }
  if (remoteDoc == null) return null;
  let object: Object;
  let documentUrl: URL;
  try {
    documentUrl = parseIri(remoteDoc.documentUrl);
    object = await Object.fromJsonLd(remoteDoc.document, {
      documentLoader,
      contextLoader: options.contextLoader,
      tracerProvider: options.tracerProvider,
      baseUrl: documentUrl,
    });
  } catch (error) {
    if (error instanceof TypeError) {
      logger.debug(
        "Failed to parse JSON-LD document: {error}\n{document}",
        { ...remoteDoc, error },
      );
      return null;
    }
    throw error;
  }
  if (
    object.id != null &&
    // A portable object belongs to its DID, not to the server that serves
    // it, so crossOrigin: "trust" does not let a server vouch for it:
    (options.crossOrigin !== "trust" || isPortableIri(object.id)) &&
    !haveSameIriOrigin(object.id, documentUrl) &&
    !haveSameFe34Origin(object.id, documentUrl)
  ) {
    if (options.crossOrigin === "throw") {
      throw new Error(
        `The object's @id (${object.id.href}) has a different origin than ` +
          `the document URL (${remoteDoc.documentUrl}); refusing to return ` +
          `the object.  If you want to bypass this check and are aware of ` +
          `the security implications, set the crossOrigin option to "trust".`,
      );
    }
    logger.warn(
      "The object's @id ({objectId}) has a different origin than the document " +
        "URL ({documentUrl}); refusing to return the object.  If you want to " +
        "bypass this check and are aware of the security implications, " +
        'set the crossOrigin option to "trust".',
      { ...remoteDoc, objectId: object.id.href },
    );
    return null;
  }
  return object;
}

const PORTABLE_IRI_PATTERN = /^ap(?:\+ef61)?:/i;

interface PortableLookup {
  readonly options: LookupObjectOptions;
  readonly documentLoader: DocumentLoader;
  /** Pairs of a canonical portable ID and a gateway already asked. */
  readonly attempted: Set<string>;
  /** The number of gateway requests left for this lookup. */
  remaining: number;
}

/**
 * Parses a raw portable IRI.  URL parsing normalizes dot segments in the
 * opaque path, which would make the parsed IRI identify another portable
 * object, so such IRIs are refused.
 */
function parsePortableCandidate(iri: string): URL | null {
  try {
    const parsed = parseIri(iri);
    if (
      canonicalizePortableUri(iri) !==
        canonicalizePortableUri(formatIri(parsed))
    ) {
      logger.debug(
        "Refusing to look up the portable IRI {iri}, as its path cannot be " +
          "represented without changing the identified object.",
        { iri },
      );
      return null;
    }
    return parsed;
  } catch (error) {
    if (error instanceof TypeError) {
      logger.debug("Invalid portable IRI {iri}: {error}", { iri, error });
      return null;
    }
    throw error;
  }
}

/**
 * Recognizes an FEP-ef61 compatible identifier to look up as a portable
 * object.
 * @returns `undefined` if the URL should be fetched as an ordinary HTTP(S)
 *          URL, i.e., it is not a compatible identifier, or the
 *          `verifyPortableObject` option is not given; `null` if it is
 *          a malformed compatible identifier; otherwise, the portable ID and
 *          the gateway to ask.
 */
function getCompatibleCandidate(
  href: string,
  options: LookupObjectOptions,
): { id: URL; gateway: URL } | null | undefined {
  if (options.verifyPortableObject == null || !URL.canParse(href)) {
    return undefined;
  }
  const url = new URL(href);
  try {
    const id = fromCompatibleEf61Id(url);
    if (id == null) return undefined;
    return { id, gateway: new URL(url.origin) };
  } catch (error) {
    if (error instanceof TypeError) {
      logger.debug(
        "Invalid FEP-ef61 compatible identifier {href}: {error}",
        { href, error },
      );
      return null;
    }
    throw error;
  }
}

/**
 * Gets the origin of the WebFinger server that {@link lookupWebFinger} asks
 * for the identifier, which is also the first gateway of a portable actor.
 */
function getWebFingerGateway(identifier: URL): URL | undefined {
  let url: URL;
  if (identifier.protocol === "acct:") {
    const host = extractHandleHost(identifier.pathname);
    if (host == null) return undefined;
    url = new URL(`https://${host}/`);
  } else if (
    identifier.protocol === "http:" || identifier.protocol === "https:"
  ) {
    url = new URL(identifier.origin);
  } else {
    return undefined;
  }
  return url.username === "" && url.password === "" ? url : undefined;
}

/**
 * Looks up a portable object through FEP-ef61 gateways.
 * @param gateways The gateways to ask in order.  If omitted, the location
 *                 hints in the IRI are used, and if there are none, the
 *                 portable IRI itself is passed to the document loader.
 */
async function lookupPortableObject(
  lookup: PortableLookup,
  id: URL,
  gateways: readonly URL[] | undefined,
): Promise<Object | null> {
  const { options } = lookup;
  const iri = formatIri(id);
  if (options.verifyPortableObject == null) {
    logger.debug(
      "Cannot look up the portable object {iri}, as the " +
        "verifyPortableObject option is not given.",
      { iri },
    );
    return null;
  }
  const canonicalId = canonicalizePortableUri(iri);
  let candidates: URL[];
  if (gateways == null) {
    candidates = getPortableGatewayCandidates(id);
    if (candidates.length < 1) {
      // No gateway to ask; a custom document loader may know how to
      // retrieve the portable IRI itself:
      const key = `${canonicalId} `;
      if (lookup.remaining < 1 || lookup.attempted.has(key)) return null;
      lookup.attempted.add(key);
      lookup.remaining--;
      return await dereference(lookup, id, []);
    }
  } else {
    candidates = [...gateways];
  }
  const selected: URL[] = [];
  for (const gateway of candidates) {
    if (selected.length >= lookup.remaining) break;
    const key = `${canonicalId} ${gateway.href}`;
    if (lookup.attempted.has(key)) continue;
    lookup.attempted.add(key);
    selected.push(gateway);
  }
  if (selected.length < 1) return null;
  lookup.remaining -= selected.length;
  return await dereference(lookup, id, selected);
}

async function dereference(
  { options, documentLoader }: PortableLookup,
  id: URL,
  gateways: readonly URL[],
): Promise<Object | null> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  try {
    return await dereferencePortableIri(id, {
      documentLoader,
      contextLoader: options.contextLoader ??
        getDocumentLoader({ userAgent: options.userAgent }),
      tracerProvider,
      gateways,
      verifyPortableObject: options.verifyPortableObject,
      crossOrigin: options.crossOrigin === "throw" ? "throw" : "ignore",
      signal: options.signal,
      parse: (document, { contextLoader, baseUrl }) =>
        Object.fromJsonLd(document, {
          documentLoader,
          contextLoader,
          tracerProvider,
          baseUrl,
        }),
    });
  } catch (error) {
    if (error instanceof PortableObjectRejectedError) throw error;
    logger.debug(
      "Failed to look up the portable object {iri}:\n{error}",
      { iri: formatIri(id), error },
    );
    return null;
  }
}

/**
 * Options for the {@link traverseCollection} function.
 * @since 1.1.0
 */
export interface TraverseCollectionOptions {
  /**
   * The document loader for loading remote JSON-LD documents.
   */
  documentLoader?: DocumentLoader;

  /**
   * The context loader for loading remote JSON-LD contexts.
   */
  contextLoader?: DocumentLoader;

  /**
   * Whether to suppress errors when fetching pages.  If `true`,
   * errors will be logged but not thrown.  Defaults to `false`.
   */
  suppressError?: boolean;

  /**
   * The interval to wait between fetching pages.  Zero or negative
   * values will disable the interval.  Disabled by default.
   *
   * @default `{ seconds: 0 }`
   */
  interval?: Temporal.Duration | Temporal.DurationLike;
}

/**
 * Traverses a collection, yielding each item in the collection.
 * If the collection is paginated, it will fetch the next page
 * automatically.
 *
 * @example
 * ``` typescript
 * const collection = await lookupObject(collectionUrl);
 * if (collection instanceof Collection) {
 *   for await (const item of traverseCollection(collection)) {
 *     console.log(item.id?.href);
 *   }
 * }
 * ```
 *
 * @param collection The collection to traverse.
 * @param options Options for traversing the collection.
 * @returns An async iterable of each item in the collection.
 * @since 1.1.0
 */
export async function* traverseCollection(
  collection: Collection,
  options: TraverseCollectionOptions = {},
): AsyncIterable<Object | Link> {
  const interval = Temporal.Duration.from(options.interval ?? { seconds: 0 })
    .total("millisecond");
  let page = await collection.getFirst(options);
  if (page == null) {
    for await (const item of collection.getItems(options)) {
      yield item;
    }
  } else {
    while (page != null) {
      for await (const item of page.getItems(options)) {
        yield item;
      }
      if (interval > 0) await delay(interval);
      page = await page.getNext(options);
    }
  }
}
