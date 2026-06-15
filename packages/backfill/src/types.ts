import type { Object as APObject } from "@fedify/vocab";

/**
 * Backfill traversal strategy used to discover the returned object.
 *
 * -  `"context-objects"` yields post-like objects directly from the context
 *    collection.
 * -  `"context-activities"` yields objects extracted from supported `Create`
 *    activities in the context collection.
 * -  `"context-auto"` classifies context collection items automatically,
 *    handling direct post-like objects and supported `Create` activities.
 *    If included, it absorbs other context collection strategies.
 * -  `"reply-tree"` walks the reply graph through `inReplyTo` ancestors and
 *    `replies` descendants.
 *
 * @since 2.x.0
 */
export type BackfillStrategy =
  | "context-objects"
  | "context-activities"
  | "context-auto"
  | "reply-tree";

/**
 * Source relation that produced a backfilled object.
 *
 * @since 2.x.0
 */
export type BackfillOrigin =
  | "context"
  | "collection"
  | "in-reply-to"
  | "replies";

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
   * Backfill strategies to run.
   *
   * Defaults to `["context-auto"]`.
   * If `"context-auto"` is included, it absorbs other context collection
   * strategies.
   *
   * @since 2.x.0
   */
  readonly strategies?: readonly BackfillStrategy[];

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
