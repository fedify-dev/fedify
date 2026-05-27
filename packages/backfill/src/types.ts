import type { Object as APObject } from "@fedify/vocab";

/**
 * Backfill traversal strategy used to discover the returned object.
 */
export type BackfillStrategy = "context-posts";

/**
 * Source relation that produced a backfilled object.
 */
export type BackfillOrigin = "context" | "collection";

/**
 * Options passed to {@link BackfillDocumentLoader}.
 */
export interface BackfillDocumentLoaderOptions {
  /**
   * Cancellation signal for the current dereference operation.
   */
  signal?: AbortSignal;
}

/**
 * Dereferences an ActivityPub object or collection IRI.
 */
export type BackfillDocumentLoader = (
  iri: URL,
  options?: BackfillDocumentLoaderOptions,
) => Promise<APObject | null>;

/**
 * Dependencies used by backfill traversal.
 */
export interface BackfillContext {
  /**
   * Dereferences context collections and collection item IRIs.
   */
  documentLoader: BackfillDocumentLoader;
}

/**
 * Controls direct context collection backfill traversal.
 */
export interface BackfillOptions<
  TObject extends APObject = APObject,
> {
  /**
   * Maximum number of items to yield.  Skipped duplicates do not count.
   */
  maxItems?: number;

  /**
   * Maximum traversal depth.  This is reserved for future reply-tree traversal;
   */
  maxDepth?: number;

  /**
   * Maximum number of calls to {@link BackfillContext.documentLoader}.
   *
   * Dereferencing the note context, collection item IRIs, and future page IRIs
   * all count as requests.  Embedded collection items do not count.
   */
  maxRequests?: number;

  /**
   * Delay between `documentLoader` requests.
   *
   * When a callback is provided, `iteration` is the zero-based request index.
   */
  interval?:
    | Temporal.DurationLike
    | ((iteration: number) => Temporal.DurationLike);

  /**
   * Cancels traversal before requests and before yields.
   */
  signal?: AbortSignal;
}

/**
 * A single object discovered by backfill traversal.
 */
export interface BackfillItem<
  TObject extends APObject = APObject,
> {
  /**
   * The discovered ActivityPub object.
   */
  object: TObject;

  /**
   * The object's ActivityPub ID, when present.
   */
  id?: URL;

  /**
   * The traversal strategy that produced this item.
   */
  strategy: BackfillStrategy;

  /**
   * The source relation that produced this item.
   */
  origin: BackfillOrigin;

  /**
   * Traversal depth.  Direct context collection items are depth 0; deeper
   * values are reserved for future reply-tree traversal.
   */
  depth?: number;
}
