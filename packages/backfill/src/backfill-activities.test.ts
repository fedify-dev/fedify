import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Activity,
  Create,
  Delete,
  Like,
  Note,
  OrderedCollection,
  Update,
} from "@fedify/vocab";
import {
  backfill,
  backfillActivities,
  type BackfillActivityOptions,
  type BackfillContext,
  type BackfillItem,
} from "./mod.ts";

describe("backfillActivities", () => {
  it("does not expose skipped items cached by an earlier post traversal", async () => {
    const collectionId = new URL("https://example.com/context");
    const missingId = new URL("https://example.com/missing");
    const collection = new OrderedCollection({
      items: [missingId, new Activity({})],
    });
    const context: BackfillContext = {
      documentLoader: (iri) =>
        Promise.resolve(iri.href === collectionId.href ? collection : null),
    };
    const seed = new Note({ contexts: [collectionId] });
    deepStrictEqual(await Array.fromAsync(backfill(context, seed)), []);
    const items = await Array.fromAsync(backfillActivities(context, seed));
    strictEqual(items.length, 1);
    strictEqual(items[0].object.constructor, Activity);
  });

  it("lazily preserves activities, references, order, and activity metadata", async () => {
    const collectionId = new URL("https://example.com/context");
    const seed = new Note({
      id: new URL("https://example.com/post"),
      contexts: [collectionId],
    });
    const actor = new URL("https://example.com/actor");
    const activities = [Create, Update, Delete, Like].map(
      (Type, index) =>
        new Type({
          // Activity identity must be independent of seed/post identity.
          id:
            index === 0
              ? seed.id
              : new URL(`https://example.com/activity/${index}`),
          actor,
          object: seed.id,
        }),
    );
    const requests: string[] = [];
    const context: BackfillContext = {
      documentLoader: (iri) => {
        requests.push(iri.href);
        strictEqual(iri.href, collectionId.href);
        return Promise.resolve(
          new OrderedCollection({
            items: [
              seed,
              activities[0],
              activities[0],
              ...activities.slice(1),
              new Like({ id: new URL("https://example.com/extra") }),
            ],
          }),
        );
      },
    };
    const unsupported = { strategies: ["reply-tree"] as const };
    // @ts-expect-error Post strategies are excluded even through a variable.
    const invalidStrategies: BackfillActivityOptions = unsupported;
    const invalidOutput: BackfillActivityOptions = {
      // @ts-expect-error There is no output option on the activity API.
      output: "activities",
    };
    // These declarations check types only; no runtime validation is required.
    void invalidStrategies;
    void invalidOutput;
    // The Note seed does not determine the iterator's result type.
    const stream: AsyncGenerator<
      BackfillItem<Activity>,
      void,
      void
    > = backfillActivities(context, seed, { maxItems: activities.length });
    deepStrictEqual(requests, []);
    const items = await Array.fromAsync(stream);
    deepStrictEqual(
      items.map((item) => item.object),
      activities,
    );
    deepStrictEqual(requests, [collectionId.href]);
    for (const item of items) {
      strictEqual(item.id?.href, item.object.id?.href);
      strictEqual(item.object.actorId?.href, actor.href);
      strictEqual(item.object.objectId?.href, seed.id?.href);
      strictEqual(item.strategy, "context-activities");
      strictEqual(item.origin, "collection");
      strictEqual(item.depth, 0);
    }
  });

  it("skips unresolved and rejected items while loading referenced activities", async () => {
    const collectionId = new URL("https://example.com/context");
    const missingId = new URL("https://example.com/missing");
    const failedId = new URL("https://example.com/failed");
    const activityId = new URL("https://example.com/activity");
    const activity = new Delete({
      id: activityId,
      object: new URL("https://example.com/deleted"),
    });
    const context: BackfillContext = {
      documentLoader: (iri) => {
        if (iri.href === collectionId.href) {
          return Promise.resolve(
            new OrderedCollection({
              items: [missingId, failedId, activityId, new Like({})],
            }),
          );
        }
        if (iri.href === failedId.href)
          return Promise.reject(new Error("failed"));
        return Promise.resolve(iri.href === activityId.href ? activity : null);
      },
    };
    const items = await Array.fromAsync(
      backfillActivities(context, new Note({ contexts: [collectionId] }), {
        maxItems: 1,
      }),
    );
    strictEqual(items.length, 1);
    strictEqual(items[0].object.constructor, Delete);
    strictEqual(items[0].id?.href, activityId.href);
    strictEqual(items[0].object.objectId?.href, activity.objectId?.href);
  });

  it("passes history and ancestor discovery options to collection selection", async () => {
    const parentId = new URL("https://example.com/parent");
    const requests: string[] = [];
    const context: BackfillContext = {
      documentLoader: (iri) => {
        requests.push(iri.href);
        strictEqual(iri.href, parentId.href);
        return Promise.resolve(
          new Note({
            id: parentId,
            contextHistory: new OrderedCollection({ items: [new Like({})] }),
          }),
        );
      },
    };
    const items = await Array.fromAsync(
      backfillActivities(context, new Note({ replyTarget: parentId }), {
        contextSource: "history-first",
        contextDiscovery: "ancestors",
        maxDepth: 1,
      }),
    );
    strictEqual(items.length, 1);
    strictEqual(items[0].object.constructor, Like);
    strictEqual(items[0].depth, 0);
    deepStrictEqual(requests, [parentId.href]);
  });

  it("retains yielded activities when the request budget is exhausted", async () => {
    const collectionId = new URL("https://example.com/context");
    const activityId = new URL("https://example.com/activity");
    const embedded = new Like({});
    const requests: string[] = [];
    const context: BackfillContext = {
      documentLoader: (iri) => {
        requests.push(iri.href);
        strictEqual(iri.href, collectionId.href);
        return Promise.resolve(
          new OrderedCollection({ items: [embedded, activityId] }),
        );
      },
    };
    const items = await Array.fromAsync(
      backfillActivities(context, new Note({ contexts: [collectionId] }), {
        maxRequests: 1,
      }),
    );
    deepStrictEqual(
      items.map((item) => item.object),
      [embedded],
    );
    deepStrictEqual(requests, [collectionId.href]);
  });

  it("propagates cancellation without yielding a loaded activity", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const context: BackfillContext = {
      documentLoader: (_iri, options) => {
        strictEqual(options?.signal, controller.signal);
        controller.abort(reason);
        return Promise.resolve(
          new OrderedCollection({ items: [new Delete({})] }),
        );
      },
    };
    await rejects(
      Array.fromAsync(
        backfillActivities(
          context,
          new Note({ contexts: [new URL("https://example.com/context")] }),
          {
            signal: controller.signal,
          },
        ),
      ),
      (error) => error === reason,
    );
  });
});
