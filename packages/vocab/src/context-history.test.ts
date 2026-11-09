import { test } from "@fedify/fixture";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import {
  Article,
  Create,
  Note,
  Object as VocabularyObject,
  OrderedCollection,
  Person,
} from "./vocab.ts";

const property = "https://w3id.org/fep/171b/contextHistory";
const inlineContext = [
  "https://www.w3.org/ns/activitystreams",
  { contextHistory: { "@id": property, "@type": "@id" } },
];
const remoteContext = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/fep/171b",
];
const historyIds = [
  new URL("https://example.com/conversations/1/history"),
  new URL("https://example.com/conversations/2/history"),
];

test("contextHistory ID access preserves multiple references without fetching", async () => {
  const fetched: string[] = [];
  // oxlint-disable-next-line eslint/require-await
  const documentLoader: DocumentLoader = async (url) => {
    fetched.push(url);
    return {
      contextUrl: null,
      documentUrl: url,
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: url,
        type: "OrderedCollection",
        totalItems: 0,
      },
    };
  };
  const note = await Note.fromJsonLd(
    {
      "@context": inlineContext,
      type: "Note",
      contextHistory: historyIds.map((id) => id.href),
    },
    { documentLoader },
  );
  deepStrictEqual(note.contextHistoryId, historyIds[0]);
  deepStrictEqual(note.contextHistoryIds, historyIds);
  deepStrictEqual(fetched, []);

  const first = await note.getContextHistory();
  ok(first instanceof OrderedCollection);
  deepStrictEqual(first.id, historyIds[0]);
  deepStrictEqual(fetched, [historyIds[0].href]);
  const histories = await Array.fromAsync(note.getContextHistories());
  deepStrictEqual(
    histories.map((history) => history.id),
    historyIds,
  );
  ok(histories.every((history) => history instanceof OrderedCollection));
  deepStrictEqual(
    fetched,
    historyIds.map((id) => id.href),
  );
});

for (const Type of [
  VocabularyObject,
  Note,
  Article,
  Person,
  Create,
  OrderedCollection,
]) {
  for (const processor of [false, true]) {
    test(`${Type.name} contextHistory round trip (${processor ? "JSON-LD processor" : "default serializer"})`, async () => {
      const object = new Type({ contextHistories: historyIds });
      const json = (await object.toJsonLd(
        processor ? { format: "compact" } : {},
      )) as Record<string, unknown>;
      deepStrictEqual(
        json.contextHistory,
        historyIds.map((id) => id.href),
      );
      strictEqual(property in json, false);
      const restored = await Type.fromJsonLd(json);
      deepStrictEqual(restored.contextHistoryIds, historyIds);
    });
  }
}

test("contextHistory is omitted when absent or empty", async () => {
  for (const note of [new Note({}), new Note({ contextHistories: [] })]) {
    strictEqual(note.contextHistoryId, null);
    deepStrictEqual(note.contextHistoryIds, []);
    strictEqual(await note.getContextHistory(), null);
    deepStrictEqual(await Array.fromAsync(note.getContextHistories()), []);
    for (const format of [undefined, "compact"] as const) {
      const json = (await note.toJsonLd({ format })) as Record<string, unknown>;
      strictEqual("contextHistory" in json, false);
    }
  }
});

test("contextHistory and context retain separate canonical properties", async () => {
  const context = new URL("https://example.com/conversations/1");
  const note = new Note({ contexts: [context], contextHistory: historyIds[0] });
  for (const format of [undefined, "compact"] as const) {
    const json = await note.toJsonLd({ format });
    const restored = await Note.fromJsonLd(json);
    deepStrictEqual(restored.contextIds, [context]);
    deepStrictEqual(restored.contextHistoryIds, [historyIds[0]]);
  }
  const expanded = await note.toJsonLd({ format: "expand" });
  deepStrictEqual((expanded as Record<string, unknown>[])[0][property], [
    { "@id": historyIds[0].href },
  ]);
  deepStrictEqual(
    (expanded as Record<string, unknown>[])[0][
      "https://www.w3.org/ns/activitystreams#context"
    ],
    [{ "@id": context.href }],
  );
});

test("contextHistory serializes embedded ordered collections", async () => {
  const item = new Create({ id: new URL("https://example.com/activities/1") });
  const history = new OrderedCollection({ id: historyIds[0], items: [item] });
  const note = new Note({
    id: new URL("https://example.com/posts/1"),
    contextHistory: history,
  });
  for (const format of [undefined, "compact"] as const) {
    const json = await note.toJsonLd({ format });
    const restored = await Note.fromJsonLd(json, {
      documentLoader: (url) => {
        throw new Error(`Unexpected fetch: ${url}`);
      },
    });
    const collection = await restored.getContextHistory();
    ok(collection instanceof OrderedCollection);
    deepStrictEqual(collection.id, historyIds[0]);
    deepStrictEqual(collection.itemIds, [item.id]);
  }
});

for (const context of [
  inlineContext,
  ["https://www.w3.org/ns/activitystreams", "https://w3id.org/fep/171b"],
]) {
  test(`contextHistory parses inline collections with ${typeof context[1] === "string" ? "preloaded" : "inline"} context`, async () => {
    const note = await Note.fromJsonLd({
      "@context": context,
      id: "https://example.com/posts/1",
      type: "Note",
      contextHistory: [
        {
          id: historyIds[0].href,
          type: "OrderedCollection",
          orderedItems: ["https://example.com/conversations/1"],
        },
        { id: historyIds[1].href, type: "OrderedCollection", totalItems: 0 },
      ],
    });
    deepStrictEqual(note.contextHistoryIds, historyIds);
    const history = await note.getContextHistory();
    ok(history instanceof OrderedCollection);
    deepStrictEqual(history.itemIds, [
      new URL("https://example.com/conversations/1"),
    ]);
    strictEqual((await Array.fromAsync(note.getContextHistories())).length, 2);
  });
}

test("contextHistory accepts explicit references using the published context", async () => {
  const note = await Note.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/fep/171b",
    ],
    type: "Note",
    contextHistory: historyIds.map((id) => ({ id: id.href })),
  });
  deepStrictEqual(note.contextHistoryIds, historyIds);
});

test("contextHistory survives embedding in Create and OrderedCollection", async () => {
  const note = new Note({ contextHistory: historyIds[0] });
  const create = new Create({ object: note });
  const collection = new OrderedCollection({ items: [create] });
  for (const processor of [false, true]) {
    const options = processor
      ? { format: "compact" as const, context: remoteContext }
      : {};
    const json = (await collection.toJsonLd(options)) as {
      orderedItems: { object: { contextHistory: unknown } }[];
    };
    strictEqual(json.orderedItems[0].object.contextHistory, historyIds[0].href);
    const restored = await OrderedCollection.fromJsonLd(json);
    const [activity] = await Array.fromAsync(restored.getItems());
    ok(activity instanceof Create);
    const restoredNote = await activity.getObject();
    ok(restoredNote instanceof Note);
    deepStrictEqual(restoredNote.contextHistoryIds, [historyIds[0]]);
  }
});
