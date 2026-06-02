import type { Object as APObject } from "@fedify/vocab";

/**
 * Backfill traversal strategy used to discover the returned object.
 *
 * @since 2.x.0
 */
export type BackfillStrategy = "context-posts";

/**
 * Source relation that produced a backfilled object.
 *
 * @since 2.x.0
 */
export type BackfillOrigin = "context" | "collection";

/**
 * Options passed to {@link BackfillDocumentLoader}.
 *
 * @since 2.x.0
 */
export interface BackfillDocumentLoaderOptions {
  /**
   * Cancellation signal for the current dereference operation.
   */
  readonly signal?: AbortSignal;
}

/**
 * Dereferences an ActivityPub object or collection IRI.
 *
 * @since 2.x.0
 */
export type BackfillDocumentLoader = (
  iri: URL,
  options?: BackfillDocumentLoaderOptions,
) => Promise<APObject | null>;

/**
 * Dependencies used by backfill traversal.
 *
 * @since 2.x.0
 */
export interface BackfillContext {
  /**
   * Dereferences context collections and collection item IRIs.
   */
  readonly documentLoader: BackfillDocumentLoader;
}

/**
 * Controls direct context collection backfill traversal.
 *
 * @since 2.x.0
 */
export interface BackfillOptions<
  TObject extends APObject = APObject,
> {
  /**
   * Maximum number of items to yield.  Skipped duplicates do not count.
   */
  readonly maxItems?: number;

  /**
   * Maximum traversal depth.  This is reserved for future reply-tree traversal;
   */
  readonly maxDepth?: number;

  /**
   * Maximum number of calls to {@link BackfillContext.documentLoader}.
   *
   * Dereferencing the note context, collection item IRIs, and future page IRIs
   * all count as requests.  Embedded collection items do not count.
   */
  readonly maxRequests?: number;

  /**
   * Delay between `documentLoader` requests.
   *
   * When a callback is provided, `iteration` is the zero-based request index.
   */
  readonly interval?:
    | Temporal.DurationLike
    | string
    | ((iteration: number) => Temporal.DurationLike | string);

  /**
   * Cancels traversal before requests and before yields.
   */
  readonly signal?: AbortSignal;
}

/**
 * A single object discovered by backfill traversal.
 *
 * @since 2.x.0
 */
export interface BackfillItem<
  TObject extends APObject = APObject,
> {
  /**
   * The discovered ActivityPub object.
   */
  readonly object: TObject;

  /**
   * The object's ActivityPub ID, when present.
   */
  readonly id?: URL;

  /**
   * The traversal strategy that produced this item.
   */
  readonly strategy: BackfillStrategy;

  /**
   * The source relation that produced this item.
   */
  readonly origin: BackfillOrigin;

  /**
   * Traversal depth.  Direct context collection items are depth 0; deeper
   * values are reserved for future reply-tree traversal.
   */
  readonly depth?: number;
}
