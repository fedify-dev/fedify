import { type Collection, type Link, Object } from "@fedify/vocab";
import type { GetUserAgentOptions } from "@fedify/vocab-runtime";
import {
  type DocumentLoader,
  getDocumentLoader,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import { SpanStatusCode, trace, type TracerProvider } from "@opentelemetry/api";
import { delay } from "es-toolkit";
import metadata from "../../deno.json" with { type: "json" };
import { lookupWebFinger } from "../webfinger/lookup.ts";
import { toAcctUrl } from "./handle.ts";
import { getTypeId } from "./type.ts";

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
      try {
        const result = await lookupObjectInternal(identifier, options);
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
  try {
    object = await Object.fromJsonLd(remoteDoc.document, {
      documentLoader,
      contextLoader: options.contextLoader,
      tracerProvider: options.tracerProvider,
      baseUrl: new URL(remoteDoc.documentUrl),
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
    object.id.origin !== new URL(remoteDoc.documentUrl).origin
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
  if (collection.firstId == null) {
    for await (const item of collection.getItems(options)) {
      yield item;
    }
  } else {
    const interval = Temporal.Duration.from(options.interval ?? { seconds: 0 })
      .total("millisecond");
    let page = await collection.getFirst(options);
    while (page != null) {
      for await (const item of page.getItems(options)) {
        yield item;
      }
      if (interval > 0) await delay(interval);
      page = await page.getNext(options);
    }
  }
}
