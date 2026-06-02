import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import test, { describe } from "node:test";
import { backfill, type BackfillContext } from "./mod.ts";
import { Collection, Create, Note } from "@fedify/vocab";

async function collect(
  context: BackfillContext,
  note: Note,
  options: Parameters<typeof backfill>[2] = {},
) {
  return await Array.fromAsync(backfill(context, note, options));
}

describe("backfill", () => {
  test("package exports backfill", () => {
    strictEqual(typeof backfill, "function");
  });

  test("context missing yields nothing", async () => {
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
    });
    const context: BackfillContext = {
      documentLoader: () => {
        throw new Error("documentLoader should not be called");
      },
    };

    deepStrictEqual(await collect(context, note), []);
  });

  test("context resolves to non-collection yields nothing", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
    });
    const context: BackfillContext = {
      documentLoader: () =>
        Promise.resolve(
          new Note({
            id: new URL("https://example.com/notes/2"),
          }),
        ),
    };

    deepStrictEqual(await collect(context, note), []);
  });

  test("context collection with embedded objects yields items", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const item = new Note({
      id: new URL("https://example.com/notes/2"),
      content: "hello",
    });
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
    });
    const context: BackfillContext = {
      documentLoader: () =>
        Promise.resolve(
          new Collection({
            id: contextId,
            items: [item],
          }),
        ),
    };

    const items = await collect(context, note);

    strictEqual(items.length, 1);
    strictEqual(items[0].object, item);
    deepStrictEqual(items[0].id, item.id);
    strictEqual(items[0].strategy, "context-posts");
    strictEqual(items[0].origin, "collection");
  });

  test("embedded object without id is yielded without id", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const item = new Note({ content: "anonymous" });
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
    });
    const context: BackfillContext = {
      documentLoader: () =>
        Promise.resolve(
          new Collection({
            id: contextId,
            items: [item],
          }),
        ),
    };

    const items = await collect(context, note);

    strictEqual(items.length, 1);
    strictEqual(items[0].object, item);
    strictEqual(items[0].id, undefined);
  });

  test("activity objects in collection are skipped", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const activity = new Create({
      id: new URL("https://example.com/activities/1"),
      object: new Note({ id: new URL("https://example.com/notes/2") }),
    });
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
    });
    const context: BackfillContext = {
      documentLoader: () =>
        Promise.resolve(
          new Collection({
            id: contextId,
            items: [activity],
          }),
        ),
    };

    deepStrictEqual(await collect(context, note), []);
  });

  test("context collection with URL items loads and yields objects", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const itemId = new URL("https://example.com/notes/2");
    const item = new Note({
      id: itemId,
      content: "hello",
    });
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
    });
    const requests: URL[] = [];
    const context: BackfillContext = {
      documentLoader: (iri) => {
        requests.push(iri);
        if (iri.href === contextId.href) {
          return Promise.resolve(
            new Collection({
              id: contextId,
              items: [itemId],
            }),
          );
        }
        if (iri.href === itemId.href) return Promise.resolve(item);
        return Promise.resolve(null);
      },
    };

    const items = await collect(context, note);

    strictEqual(items.length, 1);
    ok(items[0].id instanceof URL);
    strictEqual(items[0].id.href, itemId.href);
    deepStrictEqual(requests.map((url) => url.href), [
      contextId.href,
      itemId.href,
    ]);
  });

  test("failed URL collection items are skipped", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const missingItemId = new URL("https://example.com/notes/missing");
    const failedItemId = new URL("https://example.com/notes/failed");
    const itemId = new URL("https://example.com/notes/2");
    const item = new Note({
      id: itemId,
      content: "hello",
    });
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
    });
    const context: BackfillContext = {
      documentLoader: (iri) => {
        if (iri.href === contextId.href) {
          return Promise.resolve(
            new Collection({
              id: contextId,
              items: [missingItemId, failedItemId, itemId],
            }),
          );
        }
        if (iri.href === missingItemId.href) return Promise.resolve(null);
        if (iri.href === failedItemId.href) {
          return Promise.reject(new Error("failed to load"));
        }
        if (iri.href === itemId.href) return Promise.resolve(item);
        return Promise.resolve(null);
      },
    };

    const items = await collect(context, note);

    strictEqual(items.length, 1);
    strictEqual(items[0].id?.href, itemId.href);
  });

  test("seed is not yielded again when present in collection", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
    });
    const other = new Note({
      id: new URL("https://example.com/notes/2"),
    });
    const context: BackfillContext = {
      documentLoader: () =>
        Promise.resolve(
          new Collection({
            id: contextId,
            items: [note, other],
          }),
        ),
    };

    const items = await collect(context, note);

    strictEqual(items.length, 1);
    strictEqual(items[0].object, other);
  });

  test("duplicate object IDs are skipped", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const duplicateId = new URL("https://example.com/notes/2");
    const first = new Note({ id: duplicateId, content: "first" });
    const second = new Note({ id: duplicateId, content: "second" });
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
    });
    const context: BackfillContext = {
      documentLoader: () =>
        Promise.resolve(
          new Collection({
            id: contextId,
            items: [first, second],
          }),
        ),
    };

    const items = await collect(context, note);

    strictEqual(items.length, 1);
    strictEqual(items[0].object, first);
  });

  test("maxItems limits yielded items", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
    });
    const context: BackfillContext = {
      documentLoader: () =>
        Promise.resolve(
          new Collection({
            id: contextId,
            items: [
              new Note({ id: new URL("https://example.com/notes/2") }),
              new Note({ id: new URL("https://example.com/notes/3") }),
            ],
          }),
        ),
    };

    const items = await collect(context, note, { maxItems: 1 });

    strictEqual(items.length, 1);
    strictEqual(items[0].id?.href, "https://example.com/notes/2");
  });

  test("maxRequests limits dereferencing", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const itemId = new URL("https://example.com/notes/2");
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
    });
    const context: BackfillContext = {
      documentLoader: (iri) => {
        if (iri.href === contextId.href) {
          return Promise.resolve(
            new Collection({
              id: contextId,
              items: [itemId],
            }),
          );
        }
        return Promise.resolve(new Note({ id: iri }));
      },
    };

    deepStrictEqual(await collect(context, note, { maxRequests: 1 }), []);
  });

  test("AbortSignal stops traversal", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
    });
    const controller = new AbortController();
    controller.abort();
    const context: BackfillContext = {
      documentLoader: () =>
        Promise.resolve(
          new Collection({
            id: contextId,
            items: [new Note({ id: new URL("https://example.com/notes/2") })],
          }),
        ),
    };

    await rejects(
      collect(context, note, { signal: controller.signal }),
      { name: "AbortError" },
    );
  });

  test("documentLoader receives AbortSignal", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
    });
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const context: BackfillContext = {
      documentLoader: (_iri, options) => {
        receivedSignal = options?.signal;
        return Promise.resolve(new Collection({ id: contextId, items: [] }));
      },
    };

    await collect(context, note, { signal: controller.signal });

    strictEqual(receivedSignal, controller.signal);
  });

  test("interval callback receives zero-based request index", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const itemId = new URL("https://example.com/notes/2");
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
    });
    const iterations: number[] = [];
    const context: BackfillContext = {
      documentLoader: (iri) => {
        if (iri.href === contextId.href) {
          return Promise.resolve(
            new Collection({
              id: contextId,
              items: [itemId],
            }),
          );
        }
        return Promise.resolve(new Note({ id: iri }));
      },
    };

    await collect(context, note, {
      interval: (iteration) => {
        iterations.push(iteration);
        return { milliseconds: 0 };
      },
    });

    deepStrictEqual(iterations, [0, 1]);
  });
});
