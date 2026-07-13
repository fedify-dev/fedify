import type { GetUserAgentOptions } from "@fedify/vocab-runtime";
import {
  type DocumentLoader,
  getDocumentLoader,
  haveSameFe34Origin,
  haveSameIriOrigin,
  parseIri,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
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
}

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
  if (typeof identifier === "string") {
    identifier = toAcctUrl(identifier) ?? new URL(identifier);
  }
  let remoteDoc: RemoteDocument | null = null;
  if (identifier.protocol === "http:" || identifier.protocol === "https:") {
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
    for (const l of jrd.links) {
      if (
        l.type !== "application/activity+json" &&
          !l.type?.match(
            /application\/ld\+json;\s*profile="https:\/\/www.w3.org\/ns\/activitystreams"/,
          ) || l.rel !== "self" || l.href == null
      ) continue;
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
    options.crossOrigin !== "trust" && object.id != null &&
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
