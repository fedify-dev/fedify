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
 *    `replies` descendants, yielding discovered post-like objects.
 *
 * @since 2.3.0
 */
export type BackfillStrategy =
  | "context-objects"
  | "context-activities"
  | "context-auto"
  | "reply-tree";

/**
 * Source relation that produced a backfilled object.
 *
 * @since 2.3.0
 */
export type BackfillOrigin = "collection" | "in-reply-to" | "replies";

/**
 * Options passed to {@link BackfillDocumentLoader}.
 *
 * @since 2.3.0
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
 * @since 2.3.0
 */
export type BackfillDocumentLoader = (
  iri: URL,
  options?: BackfillDocumentLoaderOptions,
) => Promise<APObject | null>;

/**
 * Dependencies used by backfill traversal.
 *
 * @since 2.3.0
 */
export interface BackfillContext {
  /**
   * Dereferences context and context history collections, collection item IRIs,
   * reply targets, and replies collections.
   */
  readonly documentLoader: BackfillDocumentLoader;
}

/**
 * Controls backfill traversal.
 *
 * @since 2.3.0
 */
export interface BackfillOptions<
  // TObject is part of the public generic API even though this interface
  // body does not reference it.
  // oxlint-disable-next-line eslint/no-unused-vars
  TObject extends APObject = APObject,
> {
  /**
   * Selects the collection source for context-based strategies.
   *
   * If omitted, uses the seed's first `context` ID. Set to `"history-first"`
   * to try the first `contextHistory` value, falling back to the first `context`
   * ID when history is absent or unavailable. Unavailable includes a lookup
   * returning `null`, an ordinary loader error, or a non-collection result.
   * With {@link contextDiscovery} set to `"ancestors"`, the same selection
   * applies to each ancestor.
   *
   * A resolved history collection remains selected even if empty or no
   * supported objects can be yielded. Later history references are not tried,
   * and history and context collections are not merged. Later explicitly
   * configured strategies can still run.
   *
   * @since 2.5.0
   */
  readonly contextSource?: "history-first";

  /**
   * Discovers a conversation collection through `inReplyTo` ancestors.
   *
   * Set to `"ancestors"` to search when the seed has no usable collection.
   * Selects the nearest ancestor with a collection, following reply-target
   * property order at the same depth. Uses {@link contextSource} for each
   * post. A valid empty collection remains selected.
   *
   * Discovery is bounded by {@link maxDepth}. Collection items have origin
   * `"collection"` and depth 0. Ancestors themselves are yielded only when
   * `"reply-tree"` is configured. Discovery shares request and item budgets,
   * document caching, cancellation, and ID deduplication with the configured
   * strategies. If omitted, context strategies make no ancestor requests.
   * Per-object loader and portable-object verifier defaults are preserved
   * across strategies without hydrating the seed or loaded ancestors.
   *
   * @since 2.5.0
   */
  readonly contextDiscovery?: "ancestors";

  /**
   * Backfill strategies to run.
   *
   * Strategies run in order and share request, item, abort, and deduplication
   * state.  If multiple strategies discover the same object ID, the first
   * strategy keeps its {@link BackfillItem} metadata.
   *
   * Defaults to `["context-auto"]`.
   * If `"context-auto"` is included, it absorbs other context collection
   * strategies.
   *
   * @since 2.3.0
   */
  readonly strategies?: readonly BackfillStrategy[];

  /**
   * Maximum number of items to yield.  Skipped duplicates do not count.
   */
  readonly maxItems?: number;

  /**
   * Maximum reply-tree traversal and ancestor collection discovery depth.
   *
   * Immediate `inReplyTo` targets and direct `replies` collection items have
   * depth 1.  Their parents or replies have depth 2, and so on.  Context
   * collection items are depth 0 and are not limited by this option.
   *
   * Defaults to 10.
   */
  readonly maxDepth?: number;

  /**
   * Maximum number of calls to {@link BackfillContext.documentLoader}.
   *
   * Dereferencing the seed's or an ancestor's context or history, collection
   * item IRIs, reply target IRIs, replies collection IRIs, and collection page
   * IRIs all count as requests across all strategies. Embedded objects and
   * collections accepted without fetching do not count.
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
 * @since 2.3.0
 */
export interface BackfillItem<TObject extends APObject = APObject> {
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
   * Traversal depth.
   *
   * Context collection items are depth 0, including items from collections
   * discovered through ancestors. Reply-tree items use depth 1 for immediate
   * `inReplyTo` targets and direct `replies` collection items, depth 2 for the
   * next level, and so on.
   */
  readonly depth?: number;
}
