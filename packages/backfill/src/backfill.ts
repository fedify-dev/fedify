import {
  Activity,
  Collection,
  CollectionPage,
  Create,
  type Link,
  Object as APObject,
  OrderedCollection,
  OrderedCollectionPage,
} from "@fedify/vocab";

import type {
  BackfillContext,
  BackfillItem,
  BackfillOptions,
  BackfillOrigin,
  BackfillStrategy,
} from "./types.ts";

const defaultStrategies = [
  "context-auto",
] as const satisfies readonly BackfillStrategy[];

const DEFAULT_MAX_DEPTH = 10;

/**
 * Thrown when backfill traversal exceeds the configured request budget.
 *
 * @since 2.3.0
 */
export class MaxRequestsExceeded extends Error {}

interface RequestBudget {
  readonly signal?: AbortSignal;
  requestCount: number;
  readonly documents: Map<string, Promise<APObject | null>>;
}

type StrategyItem = {
  readonly object: APObject;
  readonly strategy: BackfillStrategy;
  readonly origin: BackfillOrigin;
  readonly depth: number;
};

type ReplyTreeTraversal = {
  readonly depth: number;
  readonly visitedObjectIds: Set<string>;
  readonly visitedObjects: WeakSet<APObject>;
  readonly visitedCollectionIds: Set<string>;
  readonly visitedCollections: WeakSet<BackfillCollection>;
};

/**
 * Backfills post-like objects related to a seed object.
 *
 * The seed object is not yielded by default, but its ID is treated as already
 * seen so it will not be yielded again if the collection contains it.
 *
 * @since 2.3.0
 */
export async function* backfill<
  TObject extends APObject = APObject,
>(
  context: BackfillContext,
  note: TObject,
  options: BackfillOptions<TObject> = {},
): AsyncGenerator<BackfillItem<TObject>, void, void> {
  if (options.maxItems != null && options.maxItems <= 0) return;
  const strategies = normalizeStrategies(options.strategies);
  if (strategies.length < 1) return;

  const budget: RequestBudget = {
    signal: options.signal,
    requestCount: 0,
    documents: new Map(),
  };
  const seenIds = new Set<string>();
  if (note.id != null) seenIds.add(note.id.href);

  let yielded = 0;
  try {
    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];
      let items: AsyncIterable<StrategyItem>;
      if (isContextStrategy(strategy)) {
        const contextStrategies: Exclude<BackfillStrategy, "reply-tree">[] = [
          strategy,
        ];
        while (true) {
          const nextStrategy = strategies[i + 1];
          if (nextStrategy == null || !isContextStrategy(nextStrategy)) break;
          contextStrategies.push(nextStrategy);
          i++;
        }
        items = getContextStrategyItems(
          context,
          note,
          contextStrategies,
          options,
          budget,
          seenIds,
        );
      } else {
        items = getStrategyItems(
          context,
          note,
          strategy,
          options,
          budget,
          seenIds,
        );
      }

      for await (const item of items) {
        const id = item.object.id ?? undefined;
        if (id != null) {
          if (seenIds.has(id.href)) continue;
          seenIds.add(id.href);
        }

        options.signal?.throwIfAborted();
        yield {
          object: item.object as TObject,
          id,
          strategy: item.strategy,
          origin: item.origin,
          depth: item.depth,
        };

        yielded++;
        if (options.maxItems != null && yielded >= options.maxItems) return;
      }
    }
  } catch (error) {
    if (error instanceof MaxRequestsExceeded) return;
    throw error;
  }
}

function normalizeStrategies(
  strategies: readonly BackfillStrategy[] = defaultStrategies,
): readonly BackfillStrategy[] {
  const normalized: BackfillStrategy[] = [];
  for (const strategy of strategies) {
    if (strategy === "context-auto") {
      for (
        let i = normalized.length - 1;
        i >= 0 && isContextStrategy(normalized[i]);
        i--
      ) {
        normalized.splice(i, 1);
      }
      if (!normalized.includes(strategy)) normalized.push(strategy);
    } else if (isContextStrategy(strategy)) {
      if (
        !currentContextGroupHasAuto(normalized) &&
        !normalized.includes(strategy)
      ) {
        normalized.push(strategy);
      }
    } else if (!normalized.includes(strategy)) {
      normalized.push(strategy);
    }
  }
  return normalized;
}

function isContextStrategy(
  strategy: BackfillStrategy,
): strategy is Exclude<BackfillStrategy, "reply-tree"> {
  return strategy === "context-objects" ||
    strategy === "context-activities" ||
    strategy === "context-auto";
}

function currentContextGroupHasAuto(
  strategies: readonly BackfillStrategy[],
): boolean {
  for (let i = strategies.length - 1; i >= 0; i--) {
    const strategy = strategies[i];
    if (!isContextStrategy(strategy)) return false;
    if (strategy === "context-auto") return true;
  }
  return false;
}

async function* getContextStrategyItems(
  context: BackfillContext,
  note: APObject,
  strategies: readonly Exclude<BackfillStrategy, "reply-tree">[],
  options: BackfillOptions,
  budget: RequestBudget,
  seenIds: ReadonlySet<string>,
): AsyncIterable<{
  readonly object: APObject;
  readonly strategy: Exclude<BackfillStrategy, "reply-tree">;
  readonly origin: "collection";
  readonly depth: 0;
}> {
  const contextId = note.contextIds[0];
  if (contextId == null) return;
  const collection = await loadObject(context, contextId, options, budget);
  if (!isCollection(collection)) return;
  for await (
    const object of getCollectionItems(
      context,
      collection,
      options,
      budget,
      seenIds,
    )
  ) {
    for (const strategy of strategies) {
      for await (
        const item of getContextBackfillItems(
          context,
          object,
          strategy,
          options,
          budget,
        )
      ) {
        yield {
          object: item.object,
          strategy: item.strategy,
          origin: "collection",
          depth: 0,
        };
      }
    }
  }
}

async function* getStrategyItems(
  context: BackfillContext,
  note: APObject,
  strategy: BackfillStrategy,
  options: BackfillOptions,
  budget: RequestBudget,
  seenIds: ReadonlySet<string>,
): AsyncIterable<{
  readonly object: APObject;
  readonly strategy: BackfillStrategy;
  readonly origin: BackfillOrigin;
  readonly depth: number;
}> {
  if (isContextStrategy(strategy)) {
    yield* getContextStrategyItems(
      context,
      note,
      [strategy],
      options,
      budget,
      seenIds,
    );
  } else if (strategy === "reply-tree") {
    yield* getReplyTreeItems(context, note, options, budget);
  }
}

async function* getReplyTreeItems(
  context: BackfillContext,
  note: APObject,
  options: BackfillOptions,
  budget: RequestBudget,
): AsyncIterable<{
  readonly object: APObject;
  readonly strategy: "reply-tree";
  readonly origin: "in-reply-to" | "replies";
  readonly depth: number;
}> {
  const visitedObjectIds = new Set<string>();
  const visitedObjects = new WeakSet<APObject>();
  const visitedCollectionIds = new Set<string>();
  const visitedCollections = new WeakSet<BackfillCollection>();
  if (note.id != null) visitedObjectIds.add(note.id.href);
  visitedObjects.add(note);
  const ancestors: Array<{
    readonly object: APObject;
    readonly depth: number;
  }> = [];
  for await (
    const item of getReplyAncestors(context, note, options, budget, {
      depth: 1,
      visitedObjectIds,
      visitedObjects,
      visitedCollectionIds,
      visitedCollections,
    })
  ) {
    ancestors.push({ object: item.object, depth: item.depth });
    yield item;
  }
  for (const ancestor of ancestors.toReversed()) {
    yield* getReplyDescendants(context, ancestor.object, options, budget, {
      depth: ancestor.depth + 1,
      visitedObjectIds,
      visitedObjects,
      visitedCollectionIds,
      visitedCollections,
    });
  }
  yield* getReplyDescendants(context, note, options, budget, {
    depth: 1,
    visitedObjectIds,
    visitedObjects,
    visitedCollectionIds,
    visitedCollections,
  });
}

async function* getReplyAncestors(
  context: BackfillContext,
  object: APObject,
  options: BackfillOptions,
  budget: RequestBudget,
  traversal: ReplyTreeTraversal,
): AsyncIterable<{
  readonly object: APObject;
  readonly strategy: "reply-tree";
  readonly origin: "in-reply-to";
  readonly depth: number;
}> {
  if (traversal.depth > (options.maxDepth ?? DEFAULT_MAX_DEPTH)) return;
  for await (
    const target of getReplyTargets(context, object, options, budget)
  ) {
    if (!isContextPostObject(target)) continue;
    if (!visitReplyTreeObject(target, traversal)) continue;
    yield {
      object: target,
      strategy: "reply-tree",
      origin: "in-reply-to",
      depth: traversal.depth,
    };
    yield* getReplyAncestors(context, target, options, budget, {
      depth: traversal.depth + 1,
      visitedObjectIds: traversal.visitedObjectIds,
      visitedObjects: traversal.visitedObjects,
      visitedCollectionIds: traversal.visitedCollectionIds,
      visitedCollections: traversal.visitedCollections,
    });
  }
}

async function* getReplyDescendants(
  context: BackfillContext,
  object: APObject,
  options: BackfillOptions,
  budget: RequestBudget,
  traversal: ReplyTreeTraversal,
): AsyncIterable<{
  readonly object: APObject;
  readonly strategy: "reply-tree";
  readonly origin: "replies";
  readonly depth: number;
}> {
  if (traversal.depth > (options.maxDepth ?? DEFAULT_MAX_DEPTH)) return;
  const repliesId = object.repliesId;
  if (
    repliesId != null &&
    traversal.visitedCollectionIds.has(repliesId.href)
  ) {
    return;
  }
  const replies = await getRepliesCollection(context, object, options, budget);
  if (replies == null) return;
  const unvisited = visitReplyTreeCollection(replies, traversal);
  if (repliesId != null) traversal.visitedCollectionIds.add(repliesId.href);
  if (!unvisited) return;
  for await (
    const reply of getCollectionItems(
      context,
      replies,
      options,
      budget,
      traversal.visitedObjectIds,
    )
  ) {
    if (!isContextPostObject(reply)) continue;
    if (!visitReplyTreeObject(reply, traversal)) continue;
    yield {
      object: reply,
      strategy: "reply-tree",
      origin: "replies",
      depth: traversal.depth,
    };
    yield* getReplyDescendants(context, reply, options, budget, {
      depth: traversal.depth + 1,
      visitedObjectIds: traversal.visitedObjectIds,
      visitedObjects: traversal.visitedObjects,
      visitedCollectionIds: traversal.visitedCollectionIds,
      visitedCollections: traversal.visitedCollections,
    });
  }
}

async function* getReplyTargets(
  context: BackfillContext,
  object: APObject,
  options: BackfillOptions,
  budget: RequestBudget,
): AsyncIterable<APObject | Link> {
  try {
    yield* object.getReplyTargets({
      documentLoader: async (url) => {
        return await loadCollectionItemDocument(context, url, options, budget);
      },
      crossOrigin: "trust",
    });
  } catch (error) {
    if (error instanceof MaxRequestsExceeded) throw error;
    budget.signal?.throwIfAborted();
  }
}

async function getRepliesCollection(
  context: BackfillContext,
  object: APObject,
  options: BackfillOptions,
  budget: RequestBudget,
): Promise<Collection | null> {
  try {
    return await object.getReplies({
      documentLoader: async (url) => {
        return await loadCollectionItemDocument(context, url, options, budget);
      },
      crossOrigin: "trust",
    });
  } catch (error) {
    if (error instanceof MaxRequestsExceeded) throw error;
    budget.signal?.throwIfAborted();
    return null;
  }
}

function visitReplyTreeObject(
  object: APObject,
  traversal: ReplyTreeTraversal,
): boolean {
  if (object.id != null) {
    if (traversal.visitedObjectIds.has(object.id.href)) return false;
    traversal.visitedObjectIds.add(object.id.href);
  } else {
    if (traversal.visitedObjects.has(object)) return false;
  }
  traversal.visitedObjects.add(object);
  return true;
}

function visitReplyTreeCollection(
  collection: BackfillCollection,
  traversal: ReplyTreeTraversal,
): boolean {
  if (collection.id != null) {
    return visitReplyTreeCollectionId(collection.id, traversal);
  } else {
    if (traversal.visitedCollections.has(collection)) return false;
  }
  traversal.visitedCollections.add(collection);
  return true;
}

function visitReplyTreeCollectionId(
  id: URL,
  traversal: ReplyTreeTraversal,
): boolean {
  if (traversal.visitedCollectionIds.has(id.href)) return false;
  traversal.visitedCollectionIds.add(id.href);
  return true;
}

async function* getContextBackfillItems(
  context: BackfillContext,
  object: APObject | Link,
  strategy: Exclude<BackfillStrategy, "reply-tree">,
  options: BackfillOptions,
  budget: RequestBudget,
): AsyncIterable<{
  readonly object: APObject;
  readonly strategy: Exclude<BackfillStrategy, "reply-tree">;
}> {
  if (strategy === "context-objects" && isContextPostObject(object)) {
    yield { object, strategy };
  } else if (strategy === "context-activities") {
    const activityObject = await getCreateActivityObject(
      context,
      object,
      options,
      budget,
    );
    if (activityObject != null && isContextPostObject(activityObject)) {
      yield { object: activityObject, strategy };
    }
  } else if (strategy === "context-auto") {
    if (object instanceof Activity) {
      const activityObject = await getCreateActivityObject(
        context,
        object,
        options,
        budget,
      );
      if (activityObject != null && isContextPostObject(activityObject)) {
        yield { object: activityObject, strategy };
      }
    } else if (isContextPostObject(object)) {
      yield { object, strategy };
    }
  }
}

async function* getCollectionItems(
  context: BackfillContext,
  collection: BackfillCollection,
  options: BackfillOptions,
  budget: RequestBudget,
  skipIds?: ReadonlySet<string>,
): AsyncIterable<APObject | Link> {
  yield* collection.getItems({
    documentLoader: async (url) => {
      return await loadCollectionItemDocument(
        context,
        url,
        options,
        budget,
        skipIds,
      );
    },
    crossOrigin: "trust",
  });
}

async function getCreateActivityObject(
  context: BackfillContext,
  object: APObject | Link,
  options: BackfillOptions,
  budget: RequestBudget,
): Promise<APObject | null> {
  if (!(object instanceof Create)) return null;
  try {
    return await object.getObject({
      documentLoader: async (url) => {
        return await loadCollectionItemDocument(context, url, options, budget);
      },
      crossOrigin: "trust",
    });
  } catch (error) {
    if (error instanceof MaxRequestsExceeded) throw error;
    budget.signal?.throwIfAborted();
    return null;
  }
}

async function loadCollectionItemDocument(
  context: BackfillContext,
  url: string,
  options: BackfillOptions,
  budget: RequestBudget,
  skipIds?: ReadonlySet<string>,
) {
  let object: APObject | null;
  try {
    const iri = new URL(url);
    if (skipIds?.has(iri.href)) return skippedCollectionItemDocument(url);
    object = await loadObject(
      context,
      iri,
      options,
      budget,
      true,
    );
  } catch (error) {
    if (error instanceof MaxRequestsExceeded) throw error;
    budget.signal?.throwIfAborted();
    return skippedCollectionItemDocument(url);
  }
  if (object == null) return skippedCollectionItemDocument(url);
  return {
    contextUrl: null,
    documentUrl: url,
    document: await object.toJsonLd(),
  };
}

function skippedCollectionItemDocument(url: string) {
  return {
    contextUrl: null,
    documentUrl: url,
    document: {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Activity",
    },
  };
}

async function loadObject(
  context: BackfillContext,
  iri: URL,
  options: BackfillOptions,
  budget: RequestBudget,
  throwOnBudgetExceeded = false,
): Promise<APObject | null> {
  budget.signal?.throwIfAborted();
  const cacheKey = iri.href;
  const cached = budget.documents.get(cacheKey);
  if (cached != null) return await cached;

  if (
    options.maxRequests != null &&
    budget.requestCount >= options.maxRequests
  ) {
    if (throwOnBudgetExceeded) throw new MaxRequestsExceeded();
    return null;
  }

  await waitForInterval(options, budget);
  budget.signal?.throwIfAborted();

  budget.requestCount++;
  const document = context.documentLoader(iri, { signal: budget.signal });
  budget.documents.set(cacheKey, document);
  try {
    return await document;
  } catch (error) {
    if (budget.documents.get(cacheKey) === document) {
      budget.documents.delete(cacheKey);
    }
    throw error;
  }
}

async function waitForInterval(
  options: BackfillOptions,
  budget: RequestBudget,
): Promise<void> {
  if (options.interval == null) return;
  const duration = typeof options.interval === "function"
    ? options.interval(budget.requestCount)
    : options.interval;
  const milliseconds = durationToMilliseconds(duration);
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (budget.signal?.aborted) {
      reject(budget.signal.reason);
      return;
    }
    const timeout = setTimeout(() => {
      budget.signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(budget.signal?.reason);
    };
    budget.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function durationToMilliseconds(
  duration: Temporal.DurationLike | string,
): number {
  if (typeof duration === "string") {
    if (typeof Temporal === "undefined") {
      throw new TypeError(
        "Temporal is not globally available; pass interval as a " +
          "Temporal.DurationLike object instead of a string, or provide a " +
          "Temporal polyfill.",
      );
    }
    return Temporal.Duration.from(duration).total({ unit: "milliseconds" });
  }

  return (
    (duration.milliseconds ?? 0) +
    (duration.seconds ?? 0) * 1000 +
    (duration.minutes ?? 0) * 60 * 1000 +
    (duration.hours ?? 0) * 60 * 60 * 1000 +
    (duration.days ?? 0) * 24 * 60 * 60 * 1000
  );
}

type BackfillCollection =
  | Collection
  | OrderedCollection
  | CollectionPage
  | OrderedCollectionPage;

function isCollection(
  object: APObject | null,
): object is BackfillCollection {
  return object instanceof Collection ||
    object instanceof OrderedCollection ||
    object instanceof CollectionPage ||
    object instanceof OrderedCollectionPage;
}

function isContextPostObject(
  object: APObject | Link,
): object is APObject {
  return object instanceof APObject &&
    !(object instanceof Activity) &&
    !isCollection(object);
}
