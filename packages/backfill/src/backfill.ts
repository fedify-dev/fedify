import {
  Activity,
  Collection,
  CollectionPage,
  type Link,
  Object as APObject,
  OrderedCollection,
  OrderedCollectionPage,
} from "@fedify/vocab";

import type {
  BackfillContext,
  BackfillItem,
  BackfillOptions,
} from "./types.ts";

/**
 * Thrown when backfill traversal exceeds the configured request budget.
 *
 * @since 2.3.0
 */
export class MaxRequestsExceeded extends Error {}

interface RequestBudget {
  readonly signal?: AbortSignal;
  requestCount: number;
}

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

  const contextId = note.contextIds[0];
  if (contextId == null) return;

  const budget: RequestBudget = {
    signal: options.signal,
    requestCount: 0,
  };
  const seenIds = new Set<string>();
  if (note.id != null) seenIds.add(note.id.href);

  const collection = await loadObject(context, contextId, options, budget);
  if (!isCollection(collection)) return;

  let yielded = 0;
  try {
    for await (
      const object of getCollectionItems(context, collection, options, budget)
    ) {
      if (!isContextPostObject(object)) continue;
      const id = object.id ?? undefined;
      if (id != null) {
        if (seenIds.has(id.href)) continue;
        seenIds.add(id.href);
      }

      options.signal?.throwIfAborted();
      yield {
        object: object as TObject,
        id,
        strategy: "context-posts",
        origin: "collection",
        depth: 0,
      };

      yielded++;
      if (options.maxItems != null && yielded >= options.maxItems) return;
    }
  } catch (error) {
    if (error instanceof MaxRequestsExceeded) return;
    throw error;
  }
}

async function* getCollectionItems(
  context: BackfillContext,
  collection: BackfillCollection,
  options: BackfillOptions,
  budget: RequestBudget,
): AsyncIterable<APObject | Link> {
  yield* collection.getItems({
    documentLoader: async (url) => {
      let object: APObject | null;
      try {
        object = await loadObject(
          context,
          new URL(url),
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
    },
    crossOrigin: "trust",
  });
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
  return await context.documentLoader(iri, { signal: budget.signal });
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
