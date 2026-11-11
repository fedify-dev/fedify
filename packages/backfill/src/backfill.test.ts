import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import test, { describe } from "node:test";
import { backfill, type BackfillContext, MaxRequestsExceeded } from "./mod.ts";
import {
  Announce,
  Collection,
  CollectionPage,
  Create,
  Delete,
  Like,
  Note,
  OrderedCollection,
  OrderedCollectionPage,
  Update,
} from "@fedify/vocab";
import { parseIri, type PortableObjectVerifier } from "@fedify/vocab-runtime";

async function collect(
  context: BackfillContext,
  note: Note,
  options: Parameters<typeof backfill>[2] = {},
) {
  return await Array.fromAsync(backfill(context, note, options));
}

describe("interval configuration errors", () => {
  for (const source of [
    "ancestor discovery",
    "reply-tree",
    "context collection",
  ]) {
    const reference = new URL("https://example.com/referenced");
    const options: Parameters<typeof backfill>[2] =
      source === "ancestor discovery"
        ? { contextDiscovery: "ancestors" }
        : source === "reply-tree"
          ? { strategies: ["reply-tree"] }
          : {};
    const seed = () =>
      source === "context collection"
        ? new Note({ contexts: [reference] })
        : new Note({ replyTargets: [reference, new Note({})] });

    test(`${source} propagates the original interval callback error`, async () => {
      const error = new Error("invalid interval configuration");
      let requests = 0;
      await rejects(
        collect(
          {
            documentLoader: () => {
              requests++;
              return Promise.resolve(null);
            },
          },
          seed(),
          {
            ...options,
            interval: () => {
              throw error;
            },
          },
        ),
        (caught) => caught === error,
      );
      strictEqual(requests, 0);
    });

    test(`${source} propagates invalid interval strings`, async () => {
      let requests = 0;
      await rejects(
        collect(
          {
            documentLoader: () => {
              requests++;
              return Promise.resolve(null);
            },
          },
          seed(),
          { ...options, interval: "not-a-duration" },
        ),
        Error,
      );
      strictEqual(requests, 0);
    });
  }
});

test("reply-tree skips malformed targets without ancestor discovery", async () => {
  class MalformedNote extends Note {
    override toJsonLd() {
      return Promise.resolve({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Note",
        id: 42,
      });
    }
  }
  const parent = new Note({ id: new URL("https://example.com/parent") });
  const results = await collect(
    { documentLoader: () => Promise.resolve(new MalformedNote({})) },
    new Note({
      replyTargets: [new URL("https://example.com/malformed"), parent],
    }),
    { strategies: ["reply-tree"] },
  );
  deepStrictEqual(
    results.map(({ id }) => id),
    [parent.id],
  );
});

test("ancestor discovery budget exhaustion allows later reply-tree", async () => {
  const parent = new Note({
    id: new URL("https://example.com/parent"),
    replyTarget: new URL("https://example.com/root"),
  });
  let requests = 0;
  const results = await collect(
    {
      documentLoader: () => {
        requests++;
        return Promise.resolve(null);
      },
    },
    new Note({ replyTarget: parent }),
    {
      contextDiscovery: "ancestors",
      strategies: ["context-auto", "reply-tree"],
      maxRequests: 0,
    },
  );
  deepStrictEqual(
    results.map(({ id }) => id),
    [parent.id],
  );
  strictEqual(requests, 0);
});

describe("portable ancestor collection discovery", () => {
  for (const scheme of ["ap", "ap+ef61"]) {
    test(`discovers a collection through verified ${scheme} ancestors`, async () => {
      const prefix = `${scheme}://did:key:z6Mkabc`;
      const parentId = parseIri(`${prefix}/parent`);
      const rootId = parseIri(`${prefix}/root`);
      const contextId = new URL("https://example.com/context");
      const siblingId = new URL("https://example.com/sibling");
      let verifications = 0;
      const verifyPortableObject: PortableObjectVerifier = () => {
        verifications++;
        return Promise.resolve({ verified: true });
      };
      const seed = await Note.fromJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Note",
          id: `${prefix}/seed`,
          inReplyTo: `${prefix}/parent`,
        },
        { verifyPortableObject },
      );
      const documents = new Map<string, Note | Collection>([
        [
          parentId.href,
          new Note(
            { id: parentId, replyTarget: rootId },
            { verifyPortableObject },
          ),
        ],
        [
          rootId.href,
          new Note(
            { id: rootId, contexts: [contextId] },
            { verifyPortableObject },
          ),
        ],
        [contextId.href, new Collection({ items: [siblingId] })],
        [siblingId.href, new Note({ id: siblingId })],
      ]);
      const requests: string[] = [];
      const results = await collect(
        {
          documentLoader: (iri) => {
            requests.push(iri.href);
            return Promise.resolve(documents.get(iri.href) ?? null);
          },
        },
        seed,
        { contextDiscovery: "ancestors", maxDepth: 2, maxRequests: 4 },
      );
      deepStrictEqual(
        results.map(({ id }) => id),
        [siblingId],
      );
      strictEqual(results[0].origin, "collection");
      strictEqual(results[0].strategy, "context-auto");
      strictEqual(results[0].depth, 0);
      strictEqual(verifications, 2);
      deepStrictEqual(requests, [
        parentId.href,
        rootId.href,
        contextId.href,
        siblingId.href,
      ]);
    });
  }
});

describe("anonymous ancestor cycle discovery", () => {
  for (const cycleLength of [1, 2]) {
    test(`stops a ${cycleLength}-node cycle after one failed context lookup per ancestor`, async () => {
      const firstId = new URL("https://example.com/ancestor-a");
      const secondId = new URL("https://example.com/ancestor-b");
      const contextId = new URL("https://example.com/context");
      const seed = new Note({ replyTarget: firstId });
      const original = await seed.toJsonLd();
      const targets = new Map([
        [firstId.href, cycleLength === 1 ? firstId : secondId],
        [secondId.href, firstId],
      ]);
      const expectedRequests =
        cycleLength === 1
          ? [firstId.href, contextId.href]
          : [firstId.href, contextId.href, secondId.href, contextId.href];

      for (let call = 0; call < 2; call++) {
        const requests: string[] = [];
        const results = await collect(
          {
            documentLoader: (iri) => {
              requests.push(iri.href);
              const replyTarget = targets.get(iri.href);
              if (replyTarget != null) {
                return Promise.resolve(
                  new Note({
                    replyTarget,
                    contexts: [contextId],
                  }),
                );
              }
              strictEqual(iri.href, contextId.href);
              return Promise.reject(new Error("context unavailable"));
            },
          },
          seed,
          { contextDiscovery: "ancestors", maxDepth: 8 },
        );
        deepStrictEqual(results, []);
        deepStrictEqual(requests, expectedRequests);
        deepStrictEqual(await seed.toJsonLd(), original);
      }
    });
  }
});

describe("ancestor collection discovery", () => {
  const seedId = new URL("https://example.com/seed");
  const parentId = new URL("https://example.com/parent");
  const rootId = new URL("https://example.com/root");
  const contextId = new URL("https://example.com/context");
  const sibling = new Note({ id: new URL("https://example.com/sibling") });

  function loader(entries: [string, Note | Collection][] = []) {
    const documents = new Map(entries);
    const requests: string[] = [];
    return {
      requests,
      documentLoader: (iri: URL) => {
        requests.push(iri.href);
        return Promise.resolve(documents.get(iri.href) ?? null);
      },
    };
  }

  test("anonymous ancestor cycles retain identity during discovery", async () => {
    let reads = 0;
    class SelfReply extends Note {
      override async *getReplyTargets() {
        reads++;
        yield this;
      }
    }
    const context = loader();
    deepStrictEqual(
      await collect(context, new SelfReply({}), {
        contextDiscovery: "ancestors",
        maxDepth: 5,
      }),
      [],
    );
    strictEqual(reads, 1);
    deepStrictEqual(context.requests, []);
  });

  test("anonymous loaded ancestor cycles reuse the same traversal copy", async () => {
    let serializations = 0;
    class Parent extends Note {
      override toJsonLd(...args: Parameters<Note["toJsonLd"]>) {
        serializations++;
        return super.toJsonLd(...args);
      }
    }
    const context = loader([
      [parentId.href, new Parent({ replyTarget: parentId })],
    ]);
    deepStrictEqual(
      await collect(context, new Note({ replyTarget: parentId }), {
        contextDiscovery: "ancestors",
        maxDepth: 5,
      }),
      [],
    );
    strictEqual(serializations, 2);
    deepStrictEqual(context.requests, [parentId.href]);
  });

  test("discovery retains the source context loader", async () => {
    const contextUrl = "https://example.com/custom-context";
    const contextLoads: string[] = [];
    class Parent extends Note {
      override toJsonLd() {
        return Promise.resolve({
          "@context": contextUrl,
          type: "Note",
          id: parentId.href,
          conversation: contextId.href,
        });
      }
    }
    const context = loader([
      [parentId.href, new Parent({ id: parentId, contexts: [contextId] })],
      [contextId.href, new Collection({ items: [sibling] })],
    ]);
    const results = await collect(
      context,
      new Note(
        { replyTarget: parentId },
        {
          contextLoader: (url) => {
            contextLoads.push(url);
            strictEqual(url, contextUrl);
            return Promise.resolve({
              contextUrl: null,
              documentUrl: url,
              document: {
                "@context": {
                  id: "@id",
                  type: "@type",
                  Note: "https://www.w3.org/ns/activitystreams#Note",
                  conversation: {
                    "@id": "https://www.w3.org/ns/activitystreams#context",
                    "@type": "@id",
                  },
                },
              },
            });
          },
        },
      ),
      { contextDiscovery: "ancestors" },
    );
    deepStrictEqual(
      results.map(({ id }) => id),
      [sibling.id],
    );
    ok(contextLoads.includes(contextUrl));
    deepStrictEqual(context.requests, [parentId.href, contextId.href]);
  });

  for (const strategies of [
    ["context-auto", "reply-tree"],
    ["reply-tree", "context-auto"],
  ] as const) {
    test(`discovery cycle skips preserve reply-tree depths with ${strategies.join(" then ")}`, async () => {
      const context = loader([
        [parentId.href, new Note({ id: parentId, replyTarget: rootId })],
        [rootId.href, new Note({ id: rootId })],
      ]);
      const results = await collect(
        context,
        new Note({ replyTargets: [parentId, rootId] }),
        { contextDiscovery: "ancestors", strategies },
      );
      deepStrictEqual(
        results.map(({ id, depth }) => [id, depth]),
        [
          [parentId, 1],
          [rootId, 2],
        ],
      );
      deepStrictEqual(context.requests, [parentId.href, rootId.href]);
    });
  }

  for (const source of ["seed", "ancestor"] as const) {
    for (const contextSource of [undefined, "history-first"] as const) {
      test(`${source} defaults verify embedded portable ancestors with ${contextSource ?? "context"}`, async () => {
        const sourceId = source === "seed" ? seedId : parentId;
        const object = await Note.fromJsonLd(
          {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Note",
            id: sourceId.href,
            inReplyTo: {
              type: "Note",
              id: "ap://did:key:z6Mkabc/parent",
              context: contextId.href,
            },
          },
          { verifyPortableObject: () => Promise.resolve({ verified: false }) },
        );
        const original = await object.toJsonLd();
        const context = loader([
          [parentId.href, object],
          [contextId.href, new Collection({ items: [sibling] })],
        ]);
        const results = await collect(
          context,
          source === "seed" ? object : new Note({ replyTarget: parentId }),
          { contextDiscovery: "ancestors", contextSource },
        );
        deepStrictEqual(results, []);
        strictEqual(context.requests.includes(contextId.href), false);
        deepStrictEqual(await object.toJsonLd(), original);
      });
    }
  }

  for (const source of ["loaded", "alias", "anonymous", "embedded"] as const) {
    for (const strategies of [
      ["context-auto", "reply-tree"],
      ["reply-tree", "context-auto"],
    ] as const) {
      test(`${source} ancestor policy survives ${strategies.join(" then ")} and repeated calls`, async () => {
        const historyId = "ap+ef61://did%3Akey%3Az6Mkabc/history";
        const parent = await Note.fromJsonLd(
          {
            "@context": [
              "https://www.w3.org/ns/activitystreams",
              "https://w3id.org/fep/171b",
            ],
            type: "Note",
            ...(source === "anonymous" ? {} : { id: parentId.href }),
            contextHistory: {
              type: "OrderedCollection",
              id: historyId,
              orderedItems: [{ type: "Note", id: sibling.id!.href }],
            },
          },
          { verifyPortableObject: () => Promise.resolve({ verified: false }) },
        );
        const requestedId = source === "alias" ? rootId : parentId;
        const seed = new Note({
          replyTarget: source === "embedded" ? parent : requestedId,
        });
        const originalSeed = await seed.toJsonLd();
        const originalParent = await parent.toJsonLd();
        for (let call = 0; call < 2; call++) {
          const requests: string[] = [];
          const results = await collect(
            {
              documentLoader: (iri) => {
                requests.push(iri.href);
                return Promise.resolve(
                  iri.href === requestedId.href ? parent : null,
                );
              },
            },
            seed,
            {
              contextDiscovery: "ancestors",
              contextSource: "history-first",
              strategies,
            },
          );
          deepStrictEqual(
            results.map(({ strategy }) => strategy),
            ["reply-tree"],
          );
          deepStrictEqual(
            requests,
            source === "embedded" ? [historyId] : [requestedId.href, historyId],
          );
          deepStrictEqual(await seed.toJsonLd(), originalSeed);
          deepStrictEqual(await parent.toJsonLd(), originalParent);
        }
      });
    }
  }

  for (const source of [
    "seed",
    "embedded",
    "loaded",
    "alias",
    "anonymous",
  ] as const) {
    test(`${source} ancestors preserve their portable history policy`, async () => {
      const historyId = "ap+ef61://did%3Akey%3Az6Mkabc/history";
      const parent = await Note.fromJsonLd(
        {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/fep/171b",
          ],
          type: "Note",
          ...(source === "anonymous" ? {} : { id: parentId.href }),
          contextHistory: {
            type: "OrderedCollection",
            id: historyId,
            orderedItems: [{ type: "Note", id: sibling.id!.href }],
          },
        },
        { verifyPortableObject: () => Promise.resolve({ verified: false }) },
      );
      const requestedId = source === "alias" ? rootId : parentId;
      const requests: string[] = [];
      const results = await collect(
        {
          documentLoader: (iri) => {
            requests.push(iri.href);
            return Promise.resolve(
              iri.href === requestedId.href ? parent : null,
            );
          },
        },
        source === "seed"
          ? parent
          : new Note({
              replyTarget: source === "embedded" ? parent : requestedId,
            }),
        { contextDiscovery: "ancestors", contextSource: "history-first" },
      );
      deepStrictEqual(results, []);
      deepStrictEqual(
        requests,
        source === "seed" || source === "embedded"
          ? [historyId]
          : [requestedId.href, historyId],
      );
    });
  }

  test("a rejected loaded ancestor does not replace an embedded sibling", async () => {
    class InvalidAncestor extends Note {
      override toJsonLd() {
        return Promise.resolve({
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Note",
          id: 42,
        });
      }
    }
    const context = loader([
      [parentId.href, new InvalidAncestor({ contexts: [rootId] })],
      [contextId.href, new Collection({ items: [sibling] })],
    ]);
    const results = await collect(
      context,
      new Note({
        replyTargets: [parentId, new Note({ contexts: [contextId] })],
      }),
      { contextDiscovery: "ancestors", contextSource: "history-first" },
    );
    deepStrictEqual(
      results.map(({ id }) => id),
      [sibling.id],
    );
    deepStrictEqual(context.requests, [parentId.href, contextId.href]);
  });

  test("failed parses preserve an identical embedded target's verifier", async () => {
    const document = {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/fep/171b",
      ],
      type: "Note",
      id: parentId.href,
      contextHistory: {
        type: "OrderedCollection",
        id: "ap+ef61://did:key:z6Mkabc/history",
        orderedItems: [{ type: "Note", id: sibling.id!.href }],
      },
    };
    const embedded = await Note.fromJsonLd(document, {
      verifyPortableObject: () => Promise.resolve({ verified: false }),
    });
    const source = (await Note.fromJsonLd(document)).deepClone();
    let contextLoads = 0;
    const results = await collect(
      {
        documentLoader: (iri) =>
          Promise.resolve(iri.href === parentId.href ? source : null),
      },
      new Note(
        { replyTargets: [parentId, embedded] },
        {
          // Only the fetched document needs parsing; the embedded target
          // is already typed and must retain its own verifier.
          contextLoader: () => {
            contextLoads++;
            throw new Error("Context unavailable");
          },
        },
      ),
      { contextDiscovery: "ancestors", contextSource: "history-first" },
    );
    ok(contextLoads > 0);
    deepStrictEqual(results, []);
  });

  test("loaded ancestor history hydration stays local to each backfill call", async () => {
    const postId = new URL("https://example.com/post");
    const parent = new Note({
      id: parentId,
      contextHistory: new OrderedCollection({ items: [postId] }),
    });
    const seed = new Note({ replyTarget: parentId });
    const original = await parent.toJsonLd();
    for (const content of ["First load", "Second load"]) {
      const requests: string[] = [];
      const results = await collect(
        {
          documentLoader: (iri) => {
            requests.push(iri.href);
            return Promise.resolve(
              iri.href === parentId.href
                ? parent
                : new Note({ id: postId, content }),
            );
          },
        },
        seed,
        { contextDiscovery: "ancestors", contextSource: "history-first" },
      );
      strictEqual(results[0].object.content, content);
      deepStrictEqual(requests, [parentId.href, postId.href]);
      deepStrictEqual(await parent.toJsonLd(), original);
    }
  });

  test("loaded ancestor history clone errors propagate", async () => {
    const error = new Error("cannot clone history");
    class History extends OrderedCollection {
      override deepClone(): this {
        throw error;
      }
    }
    const context = loader([
      [
        parentId.href,
        new Note({
          id: parentId,
          contextHistory: new History({}),
          contexts: [contextId],
        }),
      ],
    ]);
    await rejects(
      collect(context, new Note({ replyTarget: parentId }), {
        contextDiscovery: "ancestors",
        contextSource: "history-first",
      }),
      (caught) => caught === error,
    );
    deepStrictEqual(context.requests, [parentId.href]);
  });

  test("discovers a root collection at maxDepth without yielding ancestors", async () => {
    const context = loader([
      [parentId.href, new Note({ id: parentId, replyTarget: rootId })],
      [rootId.href, new Note({ id: rootId, contexts: [contextId] })],
      [contextId.href, new Collection({ items: [sibling] })],
    ]);
    const results = await collect(
      context,
      new Note({ id: seedId, replyTarget: parentId }),
      { contextDiscovery: "ancestors", maxDepth: 2 },
    );
    deepStrictEqual(context.requests, [
      parentId.href,
      rootId.href,
      contextId.href,
    ]);
    deepStrictEqual(
      results.map(({ id }) => id),
      [sibling.id],
    );
    strictEqual(results[0].strategy, "context-auto");
    strictEqual(results[0].origin, "collection");
    strictEqual(results[0].depth, 0);
  });

  test("omitting discovery makes no ancestor requests", async () => {
    const context = loader();
    deepStrictEqual(
      await collect(context, new Note({ replyTarget: parentId })),
      [],
    );
    deepStrictEqual(context.requests, []);
  });

  test("a valid empty seed collection prevents discovery", async () => {
    const context = loader([[contextId.href, new Collection({})]]);
    deepStrictEqual(
      await collect(
        context,
        new Note({
          contexts: [contextId],
          replyTarget: parentId,
        }),
        { contextDiscovery: "ancestors" },
      ),
      [],
    );
    deepStrictEqual(context.requests, [contextId.href]);
  });

  test("a seed context that is not a collection triggers discovery", async () => {
    const invalidId = new URL("https://example.com/invalid");
    const context = loader([
      [invalidId.href, new Note({ id: invalidId })],
      [parentId.href, new Note({ id: parentId, contexts: [contextId] })],
      [contextId.href, new Collection({ items: [sibling] })],
    ]);
    const results = await collect(
      context,
      new Note({
        contexts: [invalidId],
        replyTarget: parentId,
      }),
      { contextDiscovery: "ancestors" },
    );
    deepStrictEqual(
      results.map(({ id }) => id),
      [sibling.id],
    );
    deepStrictEqual(context.requests, [
      invalidId.href,
      parentId.href,
      contextId.href,
    ]);
  });

  test("prefers a nearer collection over the first branch's farther collection", async () => {
    const fartherId = new URL("https://example.com/far");
    const context = loader([
      [parentId.href, new Note({ id: parentId, replyTarget: rootId })],
      [
        rootId.href,
        new Note({
          id: rootId,
          contexts: [fartherId],
        }),
      ],
      [fartherId.href, new Collection({ items: [new Note({ id: rootId })] })],
      [contextId.href, new Collection({ items: [sibling] })],
    ]);
    const nearer = new Note({ contexts: [contextId] });
    const results = await collect(
      context,
      new Note({ replyTargets: [parentId, nearer] }),
      {
        contextDiscovery: "ancestors",
      },
    );
    deepStrictEqual(
      results.map(({ id }) => id),
      [sibling.id],
    );
    deepStrictEqual(context.requests, [parentId.href, contextId.href]);
  });

  test("selects the first usable collection in property order at the same depth", async () => {
    const secondId = new URL("https://example.com/second-context");
    const context = loader([
      [contextId.href, new Collection({ items: [sibling] })],
      [secondId.href, new Collection({ items: [new Note({ id: rootId })] })],
    ]);
    const results = await collect(
      context,
      new Note({
        replyTargets: [
          new Note({ contexts: [contextId] }),
          new Note({ contexts: [secondId] }),
        ],
      }),
      { contextDiscovery: "ancestors" },
    );
    deepStrictEqual(
      results.map(({ id }) => id),
      [sibling.id],
    );
    deepStrictEqual(context.requests, [contextId.href]);
  });

  for (const maxDepth of [0, 1]) {
    test(`does not discover a collection beyond maxDepth ${maxDepth}`, async () => {
      const context = loader([
        [parentId.href, new Note({ id: parentId, replyTarget: rootId })],
        [rootId.href, new Note({ id: rootId, contexts: [contextId] })],
        [contextId.href, new Collection({ items: [sibling] })],
      ]);
      deepStrictEqual(
        await collect(context, new Note({ replyTarget: parentId }), {
          contextDiscovery: "ancestors",
          maxDepth,
        }),
        [],
      );
      deepStrictEqual(context.requests, maxDepth === 0 ? [] : [parentId.href]);
    });
  }

  test("applies history-first selection to ancestors", async () => {
    const historyId = new URL("https://example.com/history");
    const context = loader([
      [
        parentId.href,
        new Note({
          id: parentId,
          contextHistory: historyId,
          contexts: [contextId],
        }),
      ],
      [
        historyId.href,
        new OrderedCollection({ items: [new Create({ object: sibling })] }),
      ],
    ]);
    const results = await collect(
      context,
      new Note({ replyTarget: parentId }),
      {
        contextDiscovery: "ancestors",
        contextSource: "history-first",
      },
    );
    deepStrictEqual(
      results.map(({ id }) => id),
      [sibling.id],
    );
    deepStrictEqual(context.requests, [parentId.href, historyId.href]);
  });

  test("an empty ancestor collection stops discovery", async () => {
    const context = loader([
      [
        parentId.href,
        new Note({ id: parentId, contexts: [contextId], replyTarget: rootId }),
      ],
      [contextId.href, new Collection({})],
    ]);
    deepStrictEqual(
      await collect(context, new Note({ replyTarget: parentId }), {
        contextDiscovery: "ancestors",
      }),
      [],
    );
    deepStrictEqual(context.requests, [parentId.href, contextId.href]);
  });

  test("an ancestor loader error allows other reply targets", async () => {
    const context = loader([
      [contextId.href, new Collection({ items: [sibling] })],
    ]);
    const results = await collect(
      {
        documentLoader: async (iri) => {
          if (iri.href === parentId.href) {
            context.requests.push(iri.href);
            throw new Error("ancestor unavailable");
          }
          return await context.documentLoader(iri);
        },
      },
      new Note({
        replyTargets: [parentId, new Note({ contexts: [contextId] })],
      }),
      {
        contextDiscovery: "ancestors",
      },
    );
    deepStrictEqual(
      results.map(({ id }) => id),
      [sibling.id],
    );
    deepStrictEqual(context.requests, [parentId.href, contextId.href]);
  });

  test("a vocabulary lookup failure allows later reply targets", async () => {
    const context = loader([
      [contextId.href, new Collection({ items: [sibling] })],
    ]);
    const seed = await Note.fromJsonLd({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Note",
      inReplyTo: [
        "ap://did:key:z6Mkabc/post",
        { type: "Note", context: contextId.href },
      ],
    });
    const results = await collect(context, seed, {
      contextDiscovery: "ancestors",
    });
    deepStrictEqual(
      results.map(({ id }) => id),
      [sibling.id],
    );
    deepStrictEqual(context.requests, [contextId.href]);
  });

  test("request budget exhaustion stops discovery before embedded siblings", async () => {
    const context = loader();
    const results = await collect(
      context,
      new Note({
        replyTargets: [
          parentId,
          new Note({
            contextHistory: new OrderedCollection({ items: [sibling] }),
          }),
        ],
      }),
      {
        contextDiscovery: "ancestors",
        contextSource: "history-first",
        maxRequests: 0,
      },
    );
    deepStrictEqual(results, []);
    deepStrictEqual(context.requests, []);
  });

  test("cancellation during ancestor discovery propagates", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const requests: string[] = [];
    await rejects(
      collect(
        {
          documentLoader: (iri) => {
            requests.push(iri.href);
            controller.abort(reason);
            return Promise.resolve(null);
          },
        },
        new Note({ replyTarget: parentId }),
        {
          contextDiscovery: "ancestors",
          signal: controller.signal,
        },
      ),
      (error) => error === reason,
    );
    deepStrictEqual(requests, [parentId.href]);
  });

  for (const strategies of [
    ["context-auto", "reply-tree"],
    ["reply-tree", "context-auto"],
  ] as const) {
    test(`discovery shares cache, scheduling, and deduplication with ${strategies.join(" then ")}`, async () => {
      const reply = new Note({ id: rootId });
      const context = loader([
        [parentId.href, new Note({ id: parentId, contexts: [contextId] })],
        [
          contextId.href,
          new Collection({
            items: [seedId, parentId, sibling, new Note({ id: sibling.id })],
          }),
        ],
      ]);
      const intervals: number[] = [];
      const results = await collect(
        context,
        new Note({
          id: seedId,
          replyTarget: parentId,
          replies: new Collection({ items: [reply] }),
        }),
        {
          contextDiscovery: "ancestors",
          strategies,
          maxRequests: 2,
          interval: (iteration) => {
            intervals.push(iteration);
            return { milliseconds: 0 };
          },
        },
      );
      const contextFirst = strategies[0] === "context-auto";
      deepStrictEqual(
        results.map(({ id }) => id),
        contextFirst
          ? [parentId, sibling.id, reply.id]
          : [parentId, reply.id, sibling.id],
      );
      strictEqual(results[0].strategy, strategies[0]);
      strictEqual(
        results[0].origin,
        contextFirst ? "collection" : "in-reply-to",
      );
      strictEqual(results[0].depth, contextFirst ? 0 : 1);
      deepStrictEqual(context.requests, [parentId.href, contextId.href]);
      deepStrictEqual(intervals, [0, 1]);
    });
  }

  test("seed, ancestor, collection, and item loads share the request budget", async () => {
    const invalidId = new URL("https://example.com/invalid");
    const context = loader([
      [invalidId.href, new Note({ id: invalidId })],
      [parentId.href, new Note({ id: parentId, contexts: [contextId] })],
      [contextId.href, new Collection({ items: [sibling.id!] })],
      [sibling.id!.href, sibling],
    ]);
    const results = await collect(
      context,
      new Note({
        contexts: [invalidId],
        replyTarget: parentId,
      }),
      { contextDiscovery: "ancestors", maxRequests: 3 },
    );
    deepStrictEqual(results, []);
    deepStrictEqual(context.requests, [
      invalidId.href,
      parentId.href,
      contextId.href,
    ]);
  });

  test("discovery and reply-tree yields share the item budget", async () => {
    const context = loader([
      [
        parentId.href,
        new Note({ id: parentId, contexts: [contextId], replyTarget: rootId }),
      ],
      [
        contextId.href,
        new Collection({ items: [sibling, new Note({ id: sibling.id })] }),
      ],
      [rootId.href, new Note({ id: rootId })],
    ]);
    const results = await collect(
      context,
      new Note({ replyTarget: parentId }),
      {
        contextDiscovery: "ancestors",
        strategies: ["context-auto", "reply-tree"],
        maxItems: 2,
      },
    );
    deepStrictEqual(
      results.map(({ id }) => id),
      [sibling.id, parentId],
    );
    deepStrictEqual(
      results.map(({ strategy }) => strategy),
      ["context-auto", "reply-tree"],
    );
    deepStrictEqual(context.requests, [parentId.href, contextId.href]);
  });

  test("discovery stays selected across separated context strategies", async () => {
    const failedId = new URL("https://example.com/unavailable");
    const context = loader([
      [parentId.href, new Note({ id: parentId, contexts: [contextId] })],
      [
        contextId.href,
        new Collection({
          items: [sibling, new Create({ object: new Note({ id: rootId }) })],
        }),
      ],
    ]);
    const results = await collect(
      {
        documentLoader: (iri) => {
          if (iri.href === failedId.href) {
            context.requests.push(iri.href);
            return Promise.reject(new Error("unavailable ancestor"));
          }
          return context.documentLoader(iri);
        },
      },
      new Note({ replyTargets: [failedId, parentId] }),
      {
        contextDiscovery: "ancestors",
        strategies: ["context-objects", "reply-tree", "context-activities"],
      },
    );
    deepStrictEqual(
      results.map(({ id }) => id),
      [sibling.id, parentId, rootId],
    );
    deepStrictEqual(
      results.map(({ strategy }) => strategy),
      ["context-objects", "reply-tree", "context-activities"],
    );
    // The failed lookup is retried by reply-tree, but context discovery is
    // not repeated for the later context-activities strategy.
    deepStrictEqual(context.requests, [
      failedId.href,
      parentId.href,
      contextId.href,
      failedId.href,
    ]);
  });

  test("cancellation during the discovered collection load prevents all yields", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled collection load");
    const requests: string[] = [];
    const yielded: unknown[] = [];
    await rejects(
      async () => {
        for await (const item of backfill(
          {
            documentLoader: (iri, options) => {
              strictEqual(options?.signal, controller.signal);
              requests.push(iri.href);
              if (iri.href === parentId.href) {
                return Promise.resolve(
                  new Note({ id: parentId, contexts: [contextId] }),
                );
              }
              strictEqual(iri.href, contextId.href);
              controller.abort(reason);
              return Promise.resolve(new Collection({ items: [sibling] }));
            },
          },
          new Note({ replyTarget: parentId }),
          {
            contextDiscovery: "ancestors",
            strategies: ["context-auto", "reply-tree"],
            signal: controller.signal,
          },
        ))
          yielded.push(item);
      },
      (error) => error === reason,
    );
    deepStrictEqual(yielded, []);
    deepStrictEqual(requests, [parentId.href, contextId.href]);
  });

  test("ancestor cycles terminate without requesting the seed again", async () => {
    const context = loader([
      [parentId.href, new Note({ id: parentId, replyTarget: seedId })],
    ]);
    deepStrictEqual(
      await collect(context, new Note({ id: seedId, replyTarget: parentId }), {
        contextDiscovery: "ancestors",
      }),
      [],
    );
    deepStrictEqual(context.requests, [parentId.href]);
  });
});

describe("history-first source selection", () => {
  const historyId = new URL("https://example.com/history");
  const contextId = new URL("https://example.com/context");
  const item = new Note({ id: new URL("https://example.com/posts/2") });
  const contextItem = new Note({ id: new URL("https://example.com/posts/3") });

  for (const abort of [false, true]) {
    test(`history clone errors ${abort ? "preserve cancellation" : "propagate without fallback"}`, async () => {
      const controller = new AbortController();
      const cloneError = new Error("Clone failed");
      const abortError = new Error("Cancelled during cloning");
      class History extends OrderedCollection {
        override clone(): this {
          if (abort) controller.abort(abortError);
          throw cloneError;
        }
      }
      const requests: string[] = [];
      await rejects(
        collect(
          {
            documentLoader: (iri) => {
              requests.push(iri.href);
              return Promise.resolve(new Collection({ items: [contextItem] }));
            },
          },
          new Note({ contextHistory: new History({}), contexts: [contextId] }),
          { contextSource: "history-first", signal: controller.signal },
        ),
        (error) => error === (abort ? abortError : cloneError),
      );
      deepStrictEqual(requests, []);
    });
  }

  test("history accessor errors still fall back to context", async () => {
    class Seed extends Note {
      override getContextHistory(): Promise<Collection | null> {
        return Promise.reject(new Error("History accessor failed"));
      }
    }
    const requests: string[] = [];
    const results = await collect(
      {
        documentLoader: (iri) => {
          requests.push(iri.href);
          return Promise.resolve(new Collection({ items: [contextItem] }));
        },
      },
      new Seed({ contextHistory: historyId, contexts: [contextId] }),
      { contextSource: "history-first" },
    );
    deepStrictEqual(requests, [contextId.href]);
    deepStrictEqual(
      results.map(({ id }) => id),
      [contextItem.id],
    );
  });

  for (const scheme of ["ap", "ap+ef61"]) {
    test(`${scheme} history references reach the backfill loader without a vocabulary verifier`, async () => {
      const portableHistoryId = `${scheme}://did:key:z6Mkabc/history`;
      const seed = await Note.fromJsonLd({
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          "https://w3id.org/fep/171b",
        ],
        type: "Note",
        contextHistory: portableHistoryId,
      });
      const requests: string[] = [];
      const results = await collect(
        {
          documentLoader: (iri) => {
            requests.push(iri.href);
            return Promise.resolve(
              new OrderedCollection({
                items: [new Create({ object: item })],
              }),
            );
          },
        },
        seed,
        { contextSource: "history-first" },
      );
      deepStrictEqual(requests, [seed.contextHistoryId!.href]);
      deepStrictEqual(
        results.map(({ id }) => id),
        [item.id],
      );
    });

    test(`embedded ${scheme} history is not fetched or replaced by context`, async () => {
      const history = await OrderedCollection.fromJsonLd({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "OrderedCollection",
        id: `${scheme}://did:key:z6Mkabc/history`,
      });
      const requests: string[] = [];
      const results = await collect(
        {
          documentLoader: (iri) => {
            requests.push(iri.href);
            return Promise.resolve(new Collection({ items: [contextItem] }));
          },
        },
        new Note({ contextHistory: history, contexts: [contextId] }),
        { contextSource: "history-first" },
      );
      deepStrictEqual(requests, []);
      deepStrictEqual(results, []);
    });
  }

  test("history lookups stay local to each backfill call without hydrating the seed", async () => {
    const seed = new Note({ contextHistory: historyId });
    const original = await seed.toJsonLd();
    const requests: string[] = [];
    for (const post of [item, contextItem]) {
      const results = await collect(
        {
          documentLoader: (iri) => {
            requests.push(iri.href);
            return Promise.resolve(new OrderedCollection({ items: [post] }));
          },
        },
        seed,
        { contextSource: "history-first" },
      );
      strictEqual(results[0].object, post);
      deepStrictEqual(await seed.toJsonLd(), original);
    }
    deepStrictEqual(requests, [historyId.href, historyId.href]);
  });

  test("compatible HTTPS history references reach the backfill loader without a vocabulary verifier", async () => {
    const compatibleId = new URL(
      "https://gateway.example/.well-known/apgateway/did:key:z6Mkabc/history",
    );
    const seed = await Note.fromJsonLd({
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/fep/171b",
      ],
      type: "Note",
      id: "ap://did:key:z6Mkabc/posts/1",
      contextHistory: compatibleId.href,
      context: contextId.href,
    });
    const requests: string[] = [];
    const results = await collect(
      {
        documentLoader: (iri) => {
          requests.push(iri.href);
          return Promise.resolve(
            iri.href === compatibleId.href
              ? new OrderedCollection({ items: [new Create({ object: item })] })
              : new Collection({ items: [contextItem] }),
          );
        },
      },
      seed,
      { contextSource: "history-first" },
    );
    deepStrictEqual(requests, [compatibleId.href]);
    deepStrictEqual(
      results.map(({ id }) => id),
      [item.id],
    );
  });

  test("portable history keeps its original gateway hints when passed to the backfill loader", async () => {
    const seed = await Note.fromJsonLd(
      {
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          "https://w3id.org/fep/171b",
        ],
        type: "Note",
        id: "https://example.com/posts/1",
        contextHistory:
          "ap://did:key:z6Mkabc/history?@gateway=https%3A%2F%2Fhinted.example",
      },
      { verifyPortableObject: () => Promise.resolve({ verified: false }) },
    );
    const requests: string[] = [];
    const results = await collect(
      {
        documentLoader: (iri) => {
          requests.push(iri.href);
          return Promise.resolve(new OrderedCollection({ items: [item] }));
        },
      },
      seed,
      { contextSource: "history-first" },
    );
    deepStrictEqual(requests, [seed.contextHistoryId!.href]);
    deepStrictEqual(
      results.map(({ id }) => id),
      [item.id],
    );
  });

  test("malformed compatible history identifiers fall back without being loaded", async () => {
    const seed = new Note({
      id: new URL("ap+ef61://did%3Akey%3Az6Mkabc/posts/1"),
      contextHistory: new URL(
        "https://gateway.example/.well-known/apgateway/did:key:z6Mkabc/history?@gateway=https://other.example",
      ),
      contexts: [contextId],
    });
    const requests: string[] = [];
    const results = await collect(
      {
        documentLoader: (iri) => {
          requests.push(iri.href);
          return Promise.resolve(new Collection({ items: [contextItem] }));
        },
      },
      seed,
      { contextSource: "history-first" },
    );
    deepStrictEqual(requests, [contextId.href]);
    deepStrictEqual(
      results.map(({ id }) => id),
      [contextItem.id],
    );
  });

  test("embedded portable history preserves the seed's verifier policy", async () => {
    const seed = await Note.fromJsonLd(
      {
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          "https://w3id.org/fep/171b",
        ],
        type: "Note",
        id: "https://example.com/posts/1",
        contextHistory: {
          type: "OrderedCollection",
          id: "ap://did:key:z6Mkabc/history",
          orderedItems: [{ type: "Note", id: item.id!.href }],
        },
      },
      { verifyPortableObject: () => Promise.resolve({ verified: false }) },
    );
    const requests: string[] = [];
    const results = await collect(
      {
        documentLoader: (iri) => {
          requests.push(iri.href);
          return Promise.resolve(null);
        },
      },
      seed,
      { contextSource: "history-first" },
    );
    deepStrictEqual(requests, [seed.contextHistoryId!.href]);
    deepStrictEqual(results, []);
  });

  for (const activity of [false, true]) {
    test(`embedded history ${activity ? "Create object" : "item"} hydration stays local to each backfill call`, async () => {
      const postId = new URL("https://example.com/posts/referenced");
      const history = new OrderedCollection({
        items: activity ? [new Create({ object: postId })] : [postId],
      });
      const seed = new Note({ contextHistory: history });
      const requests: string[] = [];
      for (const content of ["First load", "Second load"]) {
        const results = await collect(
          {
            documentLoader: (iri) => {
              requests.push(iri.href);
              return Promise.resolve(new Note({ id: postId, content }));
            },
          },
          seed,
          { contextSource: "history-first" },
        );
        strictEqual(results.length, 1);
        strictEqual(results[0].object.content, content);
      }
      deepStrictEqual(requests, [postId.href, postId.href]);
    });
  }

  test("resolved history is traversed without serialization or context loading", async () => {
    let serializations = 0;
    let contextLoads = 0;
    class History extends OrderedCollection {
      override toJsonLd(...args: Parameters<OrderedCollection["toJsonLd"]>) {
        serializations++;
        return super.toJsonLd(...args);
      }
    }
    const history = new History({ items: [item] });
    const seed = new Note(
      { contextHistory: historyId },
      {
        contextLoader: () => {
          contextLoads++;
          throw new Error("Unexpected context lookup");
        },
      },
    );
    const results = await collect(
      { documentLoader: () => Promise.resolve(history) },
      seed,
      { contextSource: "history-first" },
    );
    strictEqual(results[0].object, item);
    strictEqual(serializations, 0);
    strictEqual(contextLoads, 0);
  });

  test("history-only seed reuses paginated Create extraction and metadata", async () => {
    const seed = new Note({
      id: new URL("https://example.com/posts/1"),
      contextHistory: historyId,
    });
    const pageId = new URL("https://example.com/history/page");
    const requests: string[] = [];
    const items = await collect(
      {
        documentLoader: (iri) => {
          requests.push(iri.href);
          if (iri.href === historyId.href) {
            return Promise.resolve(new OrderedCollection({ first: pageId }));
          }
          if (iri.href === pageId.href) {
            return Promise.resolve(
              new OrderedCollectionPage({
                items: [
                  new Create({ object: seed }),
                  new Update({ object: item }),
                  new Delete({ object: item }),
                  new Like({ object: item }),
                  new Create({ object: item.id }),
                  new Create({ object: item }),
                  new Create({ object: contextItem }),
                ],
              }),
            );
          }
          strictEqual(iri.href, item.id!.href);
          return Promise.resolve(item);
        },
      },
      seed,
      { contextSource: "history-first" },
    );
    deepStrictEqual(requests, [historyId.href, pageId.href, item.id!.href]);
    deepStrictEqual(
      items.map(({ id }) => id),
      [item.id, contextItem.id],
    );
    for (const result of items) {
      strictEqual(result.strategy, "context-auto");
      strictEqual(result.origin, "collection");
      strictEqual(result.depth, 0);
    }
  });

  for (const contextSource of [undefined, "history-first"] as const) {
    test(`source precedence with contextSource ${contextSource}`, async () => {
      const requested: string[] = [];
      const results = await collect(
        {
          documentLoader: (iri) => {
            requested.push(iri.href);
            return Promise.resolve(
              new OrderedCollection({
                items:
                  iri.href === historyId.href
                    ? [new Create({ object: item })]
                    : [contextItem],
              }),
            );
          },
        },
        new Note({
          contexts: [contextId],
          contextHistories: [
            historyId,
            new URL("https://example.com/other-history"),
          ],
        }),
        { contextSource },
      );
      deepStrictEqual(requested, [
        contextSource ? historyId.href : contextId.href,
      ]);
      deepStrictEqual(
        results.map(({ id }) => id),
        [contextSource ? item.id : contextItem.id],
      );
    });
  }

  for (const failure of [
    "absent",
    "null",
    "throw",
    "reject",
    "invalid",
    "empty",
  ] as const) {
    test(`${failure} history follows the fallback policy and allows reply-tree`, async () => {
      const parent = new Note({ id: new URL("https://example.com/parent") });
      const requests: string[] = [];
      const results = await collect(
        {
          documentLoader: (iri) => {
            requests.push(iri.href);
            if (iri.href === contextId.href) {
              return Promise.resolve(new Collection({ items: [contextItem] }));
            }
            strictEqual(iri.href, historyId.href);
            if (failure === "throw") throw new Error("Unavailable history");
            if (failure === "reject")
              return Promise.reject(new Error("Unavailable history"));
            return Promise.resolve(
              failure === "empty"
                ? new OrderedCollection({})
                : failure === "invalid"
                  ? new Note({})
                  : null,
            );
          },
        },
        new Note({
          contexts: [contextId],
          contextHistories:
            failure === "absent"
              ? []
              : [historyId, new URL("https://example.com/other-history")],
          replyTarget: parent,
        }),
        {
          contextSource: "history-first",
          strategies: ["context-auto", "reply-tree"],
        },
      );
      deepStrictEqual(
        requests,
        failure === "absent"
          ? [contextId.href]
          : failure === "empty"
            ? [historyId.href]
            : [historyId.href, contextId.href],
      );
      deepStrictEqual(
        results.map(({ id }) => id),
        failure === "empty" ? [parent.id] : [contextItem.id, parent.id],
      );
    });
  }

  for (const id of [undefined, historyId]) {
    test(`embedded history ${id ? "with" : "without"} an ID needs no requests`, async () => {
      const results = await collect(
        {
          documentLoader: () => {
            throw new Error("Unexpected request");
          },
        },
        new Note({
          contextHistories: [
            new OrderedCollection({
              id,
              items: [new Create({ object: item })],
            }),
            historyId,
          ],
        }),
        {
          contextSource: "history-first",
          maxRequests: 0,
          strategies: ["context-activities"],
        },
      );
      deepStrictEqual(
        results.map(({ id }) => id),
        [item.id],
      );
      strictEqual(results[0].strategy, "context-activities");
    });
  }

  for (const Type of [
    Collection,
    CollectionPage,
    OrderedCollection,
    OrderedCollectionPage,
  ]) {
    test(`embedded ${Type.name} history yields posts without requests`, async () => {
      const seed = await Note.fromJsonLd(
        await new Note({
          contextHistory: new Type({ items: [new Create({ object: item })] }),
          contexts: [contextId],
        }).toJsonLd(),
      );
      const results = await collect(
        {
          documentLoader: () => {
            throw new Error("Unexpected request");
          },
        },
        seed,
        { contextSource: "history-first", maxRequests: 0 },
      );
      deepStrictEqual(
        results.map(({ id }) => id),
        [item.id],
      );
    });

    test(`referenced history retains ${Type.name} traversal support`, async () => {
      const results = await collect(
        { documentLoader: () => Promise.resolve(new Type({ items: [item] })) },
        new Note({ contextHistory: historyId }),
        { contextSource: "history-first", strategies: ["context-objects"] },
      );
      deepStrictEqual(
        results.map(({ id }) => id),
        [item.id],
      );
      strictEqual(results[0].object, item);
    });
  }

  test("failed history consumes shared budget while embedded later strategies can run", async () => {
    const requests: string[] = [];
    const results = await collect(
      {
        documentLoader: (iri) => {
          requests.push(iri.href);
          return Promise.reject(new Error("Unavailable"));
        },
      },
      new Note({
        contextHistory: historyId,
        contexts: [contextId],
        replyTarget: item,
      }),
      {
        contextSource: "history-first",
        maxRequests: 1,
        strategies: ["context-auto", "reply-tree"],
      },
    );
    deepStrictEqual(requests, [historyId.href]);
    deepStrictEqual(
      results.map(({ id }) => id),
      [item.id],
    );
  });

  test("source selection stays fixed across separated context strategies", async () => {
    const requests: string[] = [];
    const results = await collect(
      {
        documentLoader: (iri) => {
          requests.push(iri.href);
          if (iri.href === historyId.href)
            return Promise.reject(new Error("Unavailable"));
          strictEqual(iri.href, contextId.href);
          return Promise.resolve(
            new Collection({
              items: [contextItem, new Create({ object: item })],
            }),
          );
        },
      },
      new Note({ contextHistory: historyId, contexts: [contextId] }),
      {
        contextSource: "history-first",
        strategies: ["context-objects", "reply-tree", "context-activities"],
      },
    );
    deepStrictEqual(requests, [historyId.href, contextId.href]);
    deepStrictEqual(
      results.map(({ id }) => id),
      [contextItem.id, item.id],
    );
    deepStrictEqual(
      results.map(({ strategy }) => strategy),
      ["context-objects", "context-activities"],
    );
  });

  test("interval configuration errors propagate without fallback", async () => {
    const reason = new Error("Invalid interval");
    await rejects(
      collect(
        {
          documentLoader: () => {
            throw new Error("Unexpected request");
          },
        },
        new Note({ contextHistory: historyId, contexts: [contextId] }),
        {
          contextSource: "history-first",
          interval: () => {
            throw reason;
          },
        },
      ),
      (error) => error === reason,
    );
  });

  test("cancellation during history loading prevents fallback and later strategies", async () => {
    const controller = new AbortController();
    const reason = new Error("Stop backfill");
    const requests: string[] = [];
    await rejects(
      collect(
        {
          documentLoader: (iri) => {
            requests.push(iri.href);
            controller.abort(reason);
            return Promise.reject(new Error("Unavailable"));
          },
        },
        new Note({
          contextHistory: historyId,
          contexts: [contextId],
          replyTarget: item,
        }),
        {
          contextSource: "history-first",
          signal: controller.signal,
          strategies: ["context-auto", "reply-tree"],
        },
      ),
      (error) => error === reason,
    );
    deepStrictEqual(requests, [historyId.href]);
  });
});

describe("backfill", () => {
  test("package exports backfill", () => {
    strictEqual(typeof backfill, "function");
    strictEqual(typeof MaxRequestsExceeded, "function");
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
    strictEqual(items[0].strategy, "context-auto");
    strictEqual(items[0].origin, "collection");
  });

  test("context object strategy yields embedded objects", async () => {
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

    const items = await collect(context, note, {
      strategies: ["context-objects"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object, item);
    strictEqual(items[0].strategy, "context-objects");
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

  test("context object strategy skips activity objects", async () => {
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

    deepStrictEqual(
      await collect(context, note, { strategies: ["context-objects"] }),
      [],
    );
  });

  test("context auto strategy yields object from embedded Create", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const item = new Note({
      id: new URL("https://example.com/notes/2"),
      content: "hello",
    });
    const activity = new Create({
      id: new URL("https://example.com/activities/1"),
      object: item,
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

    const items = await collect(context, note);

    strictEqual(items.length, 1);
    strictEqual(items[0].object, item);
    strictEqual(items[0].strategy, "context-auto");
  });

  test("empty strategies yield nothing without dereferencing context", async () => {
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [new URL("https://example.com/contexts/1")],
    });
    const context: BackfillContext = {
      documentLoader: () => {
        throw new Error("documentLoader should not be called");
      },
    };

    deepStrictEqual(await collect(context, note, { strategies: [] }), []);
  });

  test("reply tree strategy does not require context collection", async () => {
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [new URL("https://example.com/contexts/1")],
    });
    const context: BackfillContext = {
      documentLoader: () => {
        throw new Error("documentLoader should not be called");
      },
    };

    deepStrictEqual(
      await collect(context, note, { strategies: ["reply-tree"] }),
      [],
    );
  });

  test("reply tree yields embedded ancestor", async () => {
    const parent = new Note({
      id: new URL("https://example.com/notes/1"),
      content: "parent",
    });
    const note = new Note({
      id: new URL("https://example.com/notes/2"),
      replyTarget: parent,
    });
    const context: BackfillContext = {
      documentLoader: () => {
        throw new Error("documentLoader should not be called");
      },
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object, parent);
    deepStrictEqual(items[0].id, parent.id);
    strictEqual(items[0].strategy, "reply-tree");
    strictEqual(items[0].origin, "in-reply-to");
    strictEqual(items[0].depth, 1);
  });

  test("reply tree dereferences ancestor URL", async () => {
    const parentId = new URL("https://example.com/notes/1");
    const parent = new Note({
      id: parentId,
      content: "parent",
    });
    const note = new Note({
      id: new URL("https://example.com/notes/2"),
      replyTarget: parentId,
    });
    const context: BackfillContext = {
      documentLoader: (iri) =>
        Promise.resolve(iri.href === parentId.href ? parent : null),
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree"],
    });

    strictEqual(items.length, 1);
    deepStrictEqual(items[0].object.id, parent.id);
    strictEqual(items[0].origin, "in-reply-to");
    strictEqual(items[0].depth, 1);
  });

  test("reply tree maxDepth limits ancestors", async () => {
    const rootId = new URL("https://example.com/notes/1");
    const parentId = new URL("https://example.com/notes/2");
    const root = new Note({
      id: rootId,
      content: "root",
    });
    const parent = new Note({
      id: parentId,
      content: "parent",
      replyTarget: rootId,
    });
    const note = new Note({
      id: new URL("https://example.com/notes/3"),
      replyTarget: parentId,
    });
    const context: BackfillContext = {
      documentLoader: (iri) => {
        if (iri.href === parentId.href) return Promise.resolve(parent);
        if (iri.href === rootId.href) return Promise.resolve(root);
        return Promise.resolve(null);
      },
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree"],
      maxDepth: 1,
    });

    strictEqual(items.length, 1);
    deepStrictEqual(items[0].object.id, parent.id);
    strictEqual(items[0].depth, 1);
  });

  test("reply tree defaults maxDepth to 10 for ancestors", async () => {
    let note = new Note({
      id: new URL("https://example.com/notes/0"),
    });
    for (let i = 1; i <= 12; i++) {
      note = new Note({
        id: new URL(`https://example.com/notes/${i}`),
        replyTarget: note,
      });
    }
    const context: BackfillContext = {
      documentLoader: () => {
        throw new Error("documentLoader should not be called");
      },
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree"],
    });

    strictEqual(items.length, 10);
    strictEqual(items.at(-1)?.depth, 10);
  });

  test("maxRequests limits reply tree ancestor dereferencing", async () => {
    const parentId = new URL("https://example.com/notes/1");
    const note = new Note({
      id: new URL("https://example.com/notes/2"),
      replyTarget: parentId,
    });
    const context: BackfillContext = {
      documentLoader: () => {
        throw new Error("documentLoader should not be called");
      },
    };

    deepStrictEqual(
      await collect(context, note, {
        strategies: ["reply-tree"],
        maxRequests: 0,
      }),
      [],
    );
  });

  test("reply tree avoids ancestor cycles", async () => {
    const seedId = new URL("https://example.com/notes/1");
    const parentId = new URL("https://example.com/notes/2");
    const note = new Note({
      id: seedId,
      replyTarget: parentId,
    });
    const parent = new Note({
      id: parentId,
      replyTarget: seedId,
    });
    const context: BackfillContext = {
      documentLoader: (iri) => {
        if (iri.href === seedId.href) return Promise.resolve(note);
        if (iri.href === parentId.href) return Promise.resolve(parent);
        return Promise.resolve(null);
      },
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree"],
    });

    strictEqual(items.length, 1);
    deepStrictEqual(items[0].object.id, parent.id);
  });

  test("reply tree deduplicates ancestors from context collection", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const parentId = new URL("https://example.com/notes/1");
    const parent = new Note({
      id: parentId,
      content: "parent",
    });
    const note = new Note({
      id: new URL("https://example.com/notes/2"),
      contexts: [contextId],
      replyTarget: parentId,
    });
    const context: BackfillContext = {
      documentLoader: (iri) => {
        if (iri.href === contextId.href) {
          return Promise.resolve(
            new Collection({
              id: contextId,
              items: [parent],
            }),
          );
        }
        if (iri.href === parentId.href) return Promise.resolve(parent);
        return Promise.resolve(null);
      },
    };

    const items = await collect(context, note, {
      strategies: ["context-auto", "reply-tree"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object, parent);
    strictEqual(items[0].strategy, "context-auto");
  });

  test("document cache avoids duplicate dereferences across strategies", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const parentId = new URL("https://example.com/notes/1");
    const parent = new Note({
      id: parentId,
      content: "parent",
    });
    const note = new Note({
      id: new URL("https://example.com/notes/2"),
      contexts: [contextId],
      replyTarget: parentId,
    });
    const requests: URL[] = [];
    const context: BackfillContext = {
      documentLoader: (iri) => {
        requests.push(iri);
        if (iri.href === contextId.href) {
          return Promise.resolve(
            new Collection({
              id: contextId,
              items: [parentId],
            }),
          );
        }
        if (iri.href === parentId.href) return Promise.resolve(parent);
        return Promise.resolve(null);
      },
    };

    const items = await collect(context, note, {
      strategies: ["context-auto", "reply-tree"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object.id?.href, parentId.href);
    deepStrictEqual(
      requests.map((url) => url.href),
      [contextId.href, parentId.href],
    );
  });

  test("document cache does not keep failed dereferences", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const parentId = new URL("https://example.com/notes/1");
    const parent = new Note({
      id: parentId,
      content: "parent",
    });
    const note = new Note({
      id: new URL("https://example.com/notes/2"),
      contexts: [contextId],
      replyTarget: parentId,
    });
    const requests: URL[] = [];
    let parentRequests = 0;
    const context: BackfillContext = {
      documentLoader: (iri) => {
        requests.push(iri);
        if (iri.href === contextId.href) {
          return Promise.resolve(
            new Collection({
              id: contextId,
              items: [parentId],
            }),
          );
        }
        if (iri.href === parentId.href) {
          parentRequests++;
          if (parentRequests === 1) throw new Error("temporary failure");
          return Promise.resolve(parent);
        }
        return Promise.resolve(null);
      },
    };

    const items = await collect(context, note, {
      strategies: ["context-auto", "reply-tree"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object.id?.href, parentId.href);
    deepStrictEqual(
      requests.map((url) => url.href),
      [contextId.href, parentId.href, parentId.href],
    );
  });

  test("strategy order controls deduplicated item metadata", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const parentId = new URL("https://example.com/notes/1");
    const parent = new Note({
      id: parentId,
      content: "parent",
    });
    const note = new Note({
      id: new URL("https://example.com/notes/2"),
      contexts: [contextId],
      replyTarget: parentId,
    });
    const context: BackfillContext = {
      documentLoader: (iri) => {
        if (iri.href === parentId.href) return Promise.resolve(parent);
        if (iri.href === contextId.href) {
          return Promise.resolve(
            new Collection({
              id: contextId,
              items: [parent],
            }),
          );
        }
        return Promise.resolve(null);
      },
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree", "context-auto"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object.id?.href, parentId.href);
    strictEqual(items[0].strategy, "reply-tree");
    strictEqual(items[0].origin, "in-reply-to");
  });

  test("context auto preserves strategy order across reply tree", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const parentId = new URL("https://example.com/notes/1");
    const parent = new Note({
      id: parentId,
      content: "parent",
    });
    const note = new Note({
      id: new URL("https://example.com/notes/2"),
      contexts: [contextId],
      replyTarget: parentId,
    });
    const context: BackfillContext = {
      documentLoader: (iri) => {
        if (iri.href === contextId.href) {
          return Promise.resolve(
            new Collection({
              id: contextId,
              items: [parent],
            }),
          );
        }
        if (iri.href === parentId.href) return Promise.resolve(parent);
        return Promise.resolve(null);
      },
    };

    const items = await collect(context, note, {
      strategies: ["context-objects", "reply-tree", "context-auto"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object.id?.href, parentId.href);
    strictEqual(items[0].strategy, "context-objects");
    strictEqual(items[0].origin, "collection");
  });

  test("reply tree yields embedded descendants", async () => {
    const reply = new Note({
      id: new URL("https://example.com/notes/2"),
      content: "reply",
    });
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      replies: new Collection({
        id: new URL("https://example.com/notes/1/replies"),
        items: [reply],
      }),
    });
    const context: BackfillContext = {
      documentLoader: () => {
        throw new Error("documentLoader should not be called");
      },
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object, reply);
    deepStrictEqual(items[0].id, reply.id);
    strictEqual(items[0].strategy, "reply-tree");
    strictEqual(items[0].origin, "replies");
    strictEqual(items[0].depth, 1);
  });

  test("reply tree walks sibling descendants from discovered ancestor", async () => {
    const seedId = new URL("https://example.com/notes/2");
    const sibling = new Note({
      id: new URL("https://example.com/notes/3"),
      content: "sibling",
    });
    const parent = new Note({
      id: new URL("https://example.com/notes/1"),
      content: "parent",
      replies: new Collection({
        id: new URL("https://example.com/notes/1/replies"),
        items: [seedId, sibling],
      }),
    });
    const note = new Note({
      id: seedId,
      replyTarget: parent,
    });
    const context: BackfillContext = {
      documentLoader: () => {
        throw new Error("documentLoader should not be called");
      },
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree"],
    });

    strictEqual(items.length, 2);
    strictEqual(items[0].object, parent);
    strictEqual(items[0].origin, "in-reply-to");
    strictEqual(items[0].depth, 1);
    strictEqual(items[1].object, sibling);
    strictEqual(items[1].origin, "replies");
    strictEqual(items[1].depth, 2);
  });

  test("reply tree maxDepth applies from seed through ancestors", async () => {
    const seedId = new URL("https://example.com/notes/2");
    const sibling = new Note({
      id: new URL("https://example.com/notes/3"),
      content: "sibling",
    });
    const parent = new Note({
      id: new URL("https://example.com/notes/1"),
      content: "parent",
      replies: new Collection({
        id: new URL("https://example.com/notes/1/replies"),
        items: [seedId, sibling],
      }),
    });
    const note = new Note({
      id: seedId,
      replyTarget: parent,
    });
    const context: BackfillContext = {
      documentLoader: () => {
        throw new Error("documentLoader should not be called");
      },
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree"],
      maxDepth: 1,
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object, parent);
    strictEqual(items[0].depth, 1);
  });

  test("reply tree dereferences replies collection URL", async () => {
    const repliesId = new URL("https://example.com/notes/1/replies");
    const reply = new Note({
      id: new URL("https://example.com/notes/2"),
      content: "reply",
    });
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      replies: repliesId,
    });
    const context: BackfillContext = {
      documentLoader: (iri) =>
        Promise.resolve(
          iri.href === repliesId.href
            ? new Collection({
                id: repliesId,
                items: [reply],
              })
            : null,
        ),
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree"],
    });

    strictEqual(items.length, 1);
    deepStrictEqual(items[0].object.id, reply.id);
    strictEqual(items[0].origin, "replies");
    strictEqual(items[0].depth, 1);
  });

  test("reply tree maxDepth limits descendants", async () => {
    const grandchild = new Note({
      id: new URL("https://example.com/notes/3"),
      content: "grandchild",
    });
    const reply = new Note({
      id: new URL("https://example.com/notes/2"),
      content: "reply",
      replies: new Collection({
        id: new URL("https://example.com/notes/2/replies"),
        items: [grandchild],
      }),
    });
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      replies: new Collection({
        id: new URL("https://example.com/notes/1/replies"),
        items: [reply],
      }),
    });
    const context: BackfillContext = {
      documentLoader: () => {
        throw new Error("documentLoader should not be called");
      },
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree"],
      maxDepth: 1,
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object, reply);
    strictEqual(items[0].depth, 1);
  });

  test("reply tree defaults maxDepth to 10 for descendants", async () => {
    let note = new Note({
      id: new URL("https://example.com/notes/12"),
    });
    for (let i = 11; i >= 0; i--) {
      note = new Note({
        id: new URL(`https://example.com/notes/${i}`),
        replies: new Collection({
          id: new URL(`https://example.com/notes/${i}/replies`),
          items: [note],
        }),
      });
    }
    const context: BackfillContext = {
      documentLoader: () => {
        throw new Error("documentLoader should not be called");
      },
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree"],
    });

    strictEqual(items.length, 10);
    strictEqual(items.at(-1)?.depth, 10);
  });

  test("maxRequests limits reply tree replies dereferencing", async () => {
    const repliesId = new URL("https://example.com/notes/1/replies");
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      replies: repliesId,
    });
    const context: BackfillContext = {
      documentLoader: () => {
        throw new Error("documentLoader should not be called");
      },
    };

    deepStrictEqual(
      await collect(context, note, {
        strategies: ["reply-tree"],
        maxRequests: 0,
      }),
      [],
    );
  });

  test("reply tree does not reload visited replies collection URL", async () => {
    const repliesId = new URL("https://example.com/notes/1/replies");
    const reply = new Note({
      id: new URL("https://example.com/notes/2"),
      content: "reply",
      replies: repliesId,
    });
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      replies: repliesId,
    });
    let requests = 0;
    const context: BackfillContext = {
      documentLoader: (iri) => {
        requests++;
        strictEqual(iri.href, repliesId.href);
        return Promise.resolve(
          new Collection({
            id: repliesId,
            items: [reply],
          }),
        );
      },
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree"],
    });

    strictEqual(requests, 1);
    strictEqual(items.length, 1);
    strictEqual(items[0].object.id?.href, reply.id?.href);
  });

  test("reply tree retries a replies collection after load failure", async () => {
    const repliesId = new URL("https://example.com/replies/shared");
    const grandchild = new Note({
      id: new URL("https://example.com/notes/4"),
      content: "grandchild",
    });
    const first = new Note({
      id: new URL("https://example.com/notes/2"),
      replies: repliesId,
    });
    const second = new Note({
      id: new URL("https://example.com/notes/3"),
      replies: repliesId,
    });
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      replies: new Collection({
        id: new URL("https://example.com/notes/1/replies"),
        items: [first, second],
      }),
    });
    let requests = 0;
    const context: BackfillContext = {
      documentLoader: (iri) => {
        strictEqual(iri.href, repliesId.href);
        requests++;
        if (requests === 1) throw new Error("temporary failure");
        return Promise.resolve(
          new Collection({
            id: repliesId,
            items: [grandchild],
          }),
        );
      },
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree"],
    });

    strictEqual(requests, 2);
    deepStrictEqual(
      items.map((item) => item.object.id?.href),
      [first.id?.href, second.id?.href, grandchild.id?.href],
    );
    strictEqual(items[2].depth, 2);
  });

  test("reply tree skips visited reply IRIs before dereferencing", async () => {
    const seedId = new URL("https://example.com/notes/1");
    const siblingId = new URL("https://example.com/notes/2");
    const sibling = new Note({
      id: siblingId,
      content: "sibling",
    });
    const note = new Note({
      id: seedId,
      replies: new Collection({
        id: new URL("https://example.com/notes/1/replies"),
        items: [seedId, siblingId],
      }),
    });
    const requests: string[] = [];
    const context: BackfillContext = {
      documentLoader: (iri) => {
        requests.push(iri.href);
        if (iri.href === siblingId.href) return Promise.resolve(sibling);
        if (iri.href === seedId.href) {
          throw new Error("seed should have been skipped");
        }
        return Promise.resolve(null);
      },
    };

    const items = await collect(context, note, {
      strategies: ["reply-tree"],
      maxRequests: 1,
    });

    deepStrictEqual(requests, [siblingId.href]);
    strictEqual(items.length, 1);
    strictEqual(items[0].object.id?.href, siblingId.href);
  });

  test("reply tree avoids descendant cycles", async () => {
    const seedId = new URL("https://example.com/notes/1");
    const replyId = new URL("https://example.com/notes/2");
    const note = new Note({
      id: seedId,
    });
    const reply = new Note({
      id: replyId,
      replies: new Collection({
        id: new URL("https://example.com/notes/2/replies"),
        items: [note],
      }),
    });
    const seed = note.clone({
      replies: new Collection({
        id: new URL("https://example.com/notes/1/replies"),
        items: [reply],
      }),
    });
    const context: BackfillContext = {
      documentLoader: () => {
        throw new Error("documentLoader should not be called");
      },
    };

    const items = await collect(context, seed, {
      strategies: ["reply-tree"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object, reply);
  });

  test("context auto overrides overlapping context strategies", async () => {
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

    const items = await collect(context, note, {
      strategies: ["context-objects", "context-auto", "reply-tree"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object, item);
    strictEqual(items[0].strategy, "context-auto");
  });

  test("duplicate strategies are ignored", async () => {
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

    const items = await collect(context, note, {
      strategies: ["context-objects", "context-objects"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object, item);
    strictEqual(items[0].strategy, "context-objects");
  });

  test("context activity collection yields object from embedded Create", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const item = new Note({
      id: new URL("https://example.com/notes/2"),
      content: "hello",
    });
    const activity = new Create({
      id: new URL("https://example.com/activities/1"),
      object: item,
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

    const items = await collect(context, note, {
      strategies: ["context-activities"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object, item);
    strictEqual(items[0].id?.href, item.id?.href);
    strictEqual(items[0].strategy, "context-activities");
    strictEqual(items[0].origin, "collection");
  });

  test("combined context strategies yield posts and activity objects", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const post = new Note({
      id: new URL("https://example.com/notes/2"),
    });
    const activityObject = new Note({
      id: new URL("https://example.com/notes/3"),
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
            items: [
              post,
              new Create({
                id: new URL("https://example.com/activities/1"),
                object: activityObject,
              }),
            ],
          }),
        ),
    };

    const items = await collect(context, note, {
      strategies: ["context-objects", "context-activities"],
    });

    strictEqual(items.length, 2);
    strictEqual(items[0].object, post);
    strictEqual(items[0].strategy, "context-objects");
    strictEqual(items[1].object, activityObject);
    strictEqual(items[1].strategy, "context-activities");
  });

  test("combined context strategies share context collection loading", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const post = new Note({
      id: new URL("https://example.com/notes/2"),
      content: "hello",
    });
    const activityObject = new Note({
      id: new URL("https://example.com/notes/3"),
      content: "activity object",
    });
    const activity = new Create({
      id: new URL("https://example.com/activities/1"),
      object: activityObject,
    });
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
    });
    let requests = 0;
    const context: BackfillContext = {
      documentLoader: (iri) => {
        requests++;
        strictEqual(iri.href, contextId.href);
        return Promise.resolve(
          new Collection({
            id: contextId,
            items: [post, activity],
          }),
        );
      },
    };

    const items = await collect(context, note, {
      strategies: ["context-objects", "context-activities"],
    });

    strictEqual(requests, 1);
    strictEqual(items.length, 2);
    strictEqual(items[0].object, post);
    strictEqual(items[1].object, activityObject);
  });

  test("context activity collection dereferences activity object URL", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const itemId = new URL("https://example.com/notes/2");
    const item = new Note({ id: itemId, content: "hello" });
    const activity = new Create({
      id: new URL("https://example.com/activities/1"),
      object: itemId,
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
              items: [activity],
            }),
          );
        }
        if (iri.href === itemId.href) return Promise.resolve(item);
        return Promise.resolve(null);
      },
    };

    const items = await collect(context, note, {
      strategies: ["context-activities"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object.id?.href, item.id?.href);
    deepStrictEqual(
      requests.map((url) => url.href),
      [contextId.href, itemId.href],
    );
  });

  test("context activity collection dereferences activity URL", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const activityId = new URL("https://example.com/activities/1");
    const item = new Note({
      id: new URL("https://example.com/notes/2"),
      content: "hello",
    });
    const activity = new Create({ id: activityId, object: item });
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
              items: [activityId],
            }),
          );
        }
        if (iri.href === activityId.href) return Promise.resolve(activity);
        return Promise.resolve(null);
      },
    };

    const items = await collect(context, note, {
      strategies: ["context-activities"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object.id?.href, item.id?.href);
    deepStrictEqual(
      requests.map((url) => url.href),
      [contextId.href, activityId.href],
    );
  });

  test("context activity collection deduplicates by extracted object ID", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const itemId = new URL("https://example.com/notes/2");
    const first = new Create({
      id: new URL("https://example.com/activities/1"),
      object: new Note({ id: itemId, content: "first" }),
    });
    const second = new Create({
      id: new URL("https://example.com/activities/2"),
      object: new Note({ id: itemId, content: "second" }),
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
            items: [first, second],
          }),
        ),
    };

    const items = await collect(context, note, {
      strategies: ["context-activities"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].id?.href, itemId.href);
  });

  test("context activity collection skips missing object", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const activity = new Create({
      id: new URL("https://example.com/activities/1"),
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

    deepStrictEqual(
      await collect(context, note, { strategies: ["context-activities"] }),
      [],
    );
  });

  test("context activity collection skips unsupported activity type", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const item = new Note({ id: new URL("https://example.com/notes/2") });
    const activity = new Announce({
      id: new URL("https://example.com/activities/1"),
      object: item,
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

    deepStrictEqual(
      await collect(context, note, { strategies: ["context-activities"] }),
      [],
    );
  });

  test("maxRequests limits activity object dereferencing", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const activityId = new URL("https://example.com/activities/1");
    const itemId = new URL("https://example.com/notes/2");
    const activity = new Create({ id: activityId, object: itemId });
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
              items: [activityId],
            }),
          );
        }
        if (iri.href === activityId.href) return Promise.resolve(activity);
        if (iri.href === itemId.href) {
          return Promise.resolve(
            new Note({
              id: itemId,
            }),
          );
        }
        return Promise.resolve(null);
      },
    };

    const items = await collect(context, note, {
      maxRequests: 2,
      strategies: ["context-activities"],
    });

    deepStrictEqual(items, []);
    deepStrictEqual(
      requests.map((url) => url.href),
      [contextId.href, activityId.href],
    );
  });

  test("maxItems limits context activity items", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const first = new Note({ id: new URL("https://example.com/notes/2") });
    const second = new Note({ id: new URL("https://example.com/notes/3") });
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
              new Create({
                id: new URL("https://example.com/activities/1"),
                object: first,
              }),
              new Create({
                id: new URL("https://example.com/activities/2"),
                object: second,
              }),
            ],
          }),
        ),
    };

    const items = await collect(context, note, {
      maxItems: 1,
      strategies: ["context-activities"],
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].id?.href, first.id?.href);
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
    deepStrictEqual(
      requests.map((url) => url.href),
      [contextId.href, itemId.href],
    );
  });

  test("seen context collection URL items are not loaded", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const seedId = new URL("https://example.com/notes/1");
    const itemId = new URL("https://example.com/notes/2");
    const item = new Note({
      id: itemId,
      content: "hello",
    });
    const note = new Note({
      id: seedId,
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
              items: [seedId, itemId],
            }),
          );
        }
        if (iri.href === itemId.href) return Promise.resolve(item);
        throw new Error("seen collection item should not be loaded");
      },
    };

    const items = await collect(context, note);

    strictEqual(items.length, 1);
    strictEqual(items[0].id?.href, itemId.href);
    deepStrictEqual(
      requests.map((url) => url.href),
      [contextId.href, itemId.href],
    );
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

  test("maxItems is shared across context and reply tree", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const reply = new Note({
      id: new URL("https://example.com/notes/3"),
      content: "reply",
    });
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
      replies: new Collection({
        id: new URL("https://example.com/notes/1/replies"),
        items: [reply],
      }),
    });
    const contextItem = new Note({
      id: new URL("https://example.com/notes/2"),
      content: "context item",
    });
    const context: BackfillContext = {
      documentLoader: () =>
        Promise.resolve(
          new Collection({
            id: contextId,
            items: [contextItem],
          }),
        ),
    };

    const items = await collect(context, note, {
      strategies: ["context-auto", "reply-tree"],
      maxItems: 1,
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object, contextItem);
    strictEqual(items[0].strategy, "context-auto");
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

  test("maxRequests is shared across context and reply tree", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const parentId = new URL("https://example.com/notes/0");
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
      replyTarget: parentId,
    });
    const contextItem = new Note({
      id: new URL("https://example.com/notes/2"),
      content: "context item",
    });
    const context: BackfillContext = {
      documentLoader: (iri) => {
        if (iri.href === contextId.href) {
          return Promise.resolve(
            new Collection({
              id: contextId,
              items: [contextItem],
            }),
          );
        }
        throw new Error("reply-tree request should be budgeted out");
      },
    };

    const items = await collect(context, note, {
      strategies: ["context-auto", "reply-tree"],
      maxRequests: 1,
    });

    strictEqual(items.length, 1);
    strictEqual(items[0].object, contextItem);
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

    await rejects(collect(context, note, { signal: controller.signal }), {
      name: "AbortError",
    });
  });

  test("AbortSignal stops traversal across strategies", async () => {
    const contextId = new URL("https://example.com/contexts/1");
    const parentId = new URL("https://example.com/notes/0");
    const controller = new AbortController();
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      contexts: [contextId],
      replyTarget: parentId,
    });
    const contextItem = new Note({
      id: new URL("https://example.com/notes/2"),
      content: "context item",
    });
    let requests = 0;
    const context: BackfillContext = {
      documentLoader: (iri) => {
        requests++;
        if (iri.href === contextId.href) {
          return Promise.resolve(
            new Collection({
              id: contextId,
              items: [contextItem],
            }),
          );
        }
        throw new Error("reply-tree request should not be started");
      },
    };

    const items: Awaited<ReturnType<typeof collect>> = [];
    await rejects(
      async () => {
        for await (const item of backfill(context, note, {
          strategies: ["context-auto", "reply-tree"],
          signal: controller.signal,
        })) {
          items.push(item);
          controller.abort();
        }
      },
      { name: "AbortError" },
    );

    strictEqual(requests, 1);
    strictEqual(items.length, 1);
    strictEqual(items[0].object, contextItem);
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

describe("collection pagination", () => {
  const iri = (name: string) => new URL(`https://example.com/${name}`);

  for (const ordered of [false, true]) {
    for (const replies of [false, true]) {
      for (const embedded of [false, true]) {
        test(`${ordered ? "ordered" : "unordered"} ${replies ? "replies" : "context"} with ${embedded ? "embedded" : "linked"} pages`, async () => {
          const CollectionType = ordered ? OrderedCollection : Collection;
          const PageType = ordered ? OrderedCollectionPage : CollectionPage;
          const a = new Note({ id: iri("a") });
          const b = new Note({ id: iri("b") });
          const second = new PageType({ id: iri("page-2"), items: [b] });
          const first = new PageType({
            id: iri("page-1"),
            items: [a],
            next: embedded ? second : second.id,
          });
          const collection = new CollectionType({
            id: iri("thread"),
            first: embedded ? first : first.id,
          });
          const seed = new Note({
            id: iri("seed"),
            contexts: replies ? [] : [iri("thread")],
            replies: replies ? collection : null,
          });
          const documents = new Map<string, Collection>([
            [iri("thread").href, collection],
            [iri("page-1").href, first],
            [iri("page-2").href, second],
          ]);
          const calls: string[] = [];
          const context: BackfillContext = {
            documentLoader: (url) => {
              calls.push(url.href);
              return Promise.resolve(documents.get(url.href) ?? null);
            },
          };
          const items = await collect(context, seed, {
            strategies: replies ? ["reply-tree"] : ["context-auto"],
            maxDepth: 1,
            maxRequests: embedded ? (replies ? 0 : 1) : 3,
          });
          deepStrictEqual(
            items.map((item) => item.id?.href),
            [a.id?.href, b.id?.href],
          );
          deepStrictEqual(
            items.map((item) => item.depth),
            replies ? [1, 1] : [0, 0],
          );
          strictEqual(
            calls.length,
            embedded ? (replies ? 0 : 1) : replies ? 2 : 3,
          );
        });
      }
    }
  }

  test("starting page follows next and stops before loading a repeated page", async () => {
    const first = new OrderedCollectionPage({
      id: iri("page-1"),
      items: [new Note({ id: iri("a") })],
      next: iri("page-2"),
    });
    const second = new OrderedCollectionPage({
      id: iri("page-2"),
      items: [new Note({ id: iri("b") })],
      next: first.id,
    });
    const calls: string[] = [];
    const items = await collect(
      {
        documentLoader: (url) => {
          calls.push(url.href);
          return Promise.resolve(url.href === first.id?.href ? first : second);
        },
      },
      new Note({ contexts: [first.id!] }),
    );
    deepStrictEqual(
      items.map((item) => item.id?.href),
      [iri("a").href, iri("b").href],
    );
    deepStrictEqual(calls, [first.id?.href, second.id?.href]);
  });

  for (const limit of ["maxItems", "maxRequests"] as const) {
    test(`${limit} stops between pages`, async () => {
      const first = new CollectionPage({
        id: iri("page-1"),
        items: [new Note({ id: iri("a") })],
        next: iri("page-2"),
      });
      const calls: string[] = [];
      const items = await collect(
        {
          documentLoader: (url) => {
            calls.push(url.href);
            return Promise.resolve(first);
          },
        },
        new Note({
          contexts: [first.id!],
          replies: new Collection({
            items: [new Note({ id: iri("fallback") })],
          }),
        }),
        { [limit]: 1, strategies: ["context-auto", "reply-tree"] },
      );
      deepStrictEqual(
        items.map((item) => item.id?.href),
        [iri("a").href],
      );
      deepStrictEqual(calls, [first.id?.href]);
    });
  }

  for (const failure of ["missing", "throw", "invalid"] as const) {
    test(`${failure} page retains items and allows the next strategy`, async () => {
      const seed = new Note({
        contexts: [iri("thread")],
        replies: new Collection({ items: [new Note({ id: iri("reply") })] }),
      });
      const first = new CollectionPage({
        items: [new Note({ id: iri("a") })],
        next: iri("broken"),
      });
      const items = await collect(
        {
          documentLoader: (url) => {
            if (url.href === iri("thread").href) {
              return Promise.resolve(new Collection({ first }));
            }
            if (failure === "throw") throw new Error("page failed");
            return Promise.resolve(failure === "missing" ? null : new Note({}));
          },
        },
        seed,
        { strategies: ["context-auto", "reply-tree"] },
      );
      deepStrictEqual(
        items.map((item) => item.id?.href),
        [iri("a").href, iri("reply").href],
      );
    });
  }

  test("inline items precede page items", async () => {
    const items = await collect(
      {
        documentLoader: () =>
          Promise.resolve(
            new Collection({
              items: [new Note({ id: iri("inline") })],
              first: new CollectionPage({
                items: [new Note({ id: iri("paged") })],
              }),
            }),
          ),
      },
      new Note({ contexts: [iri("thread")] }),
    );
    deepStrictEqual(
      items.map((item) => item.id?.href),
      [iri("inline").href, iri("paged").href],
    );
  });

  test("cancellation during a page load prevents later strategies", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const seed = new Note({
      contexts: [iri("thread")],
      replies: new Collection({ items: [new Note({ id: iri("fallback") })] }),
    });
    await rejects(
      collect(
        {
          documentLoader: (url, options) => {
            strictEqual(options?.signal, controller.signal);
            if (url.href === iri("thread").href) {
              return Promise.resolve(new Collection({ first: iri("page") }));
            }
            controller.abort(reason);
            throw reason;
          },
        },
        seed,
        {
          signal: controller.signal,
          strategies: ["context-auto", "reply-tree"],
        },
      ),
      (error) => error === reason,
    );
  });
});

test("page loads share the cache and interval across strategies", async () => {
  const iri = (name: string) => new URL(`https://example.com/${name}`);
  const collection = new Collection({ first: iri("page") });
  const page = new CollectionPage({ items: [new Note({ id: iri("a") })] });
  const seed = new Note({
    contexts: [iri("thread")],
    replies: new Collection({ first: iri("page") }),
  });
  const calls: string[] = [];
  const intervals: number[] = [];
  const items = await collect(
    {
      documentLoader: (url) => {
        calls.push(url.href);
        return Promise.resolve(
          url.href === iri("thread").href ? collection : page,
        );
      },
    },
    seed,
    {
      strategies: ["context-auto", "reply-tree"],
      maxRequests: 2,
      interval: (count) => {
        intervals.push(count);
        return { milliseconds: 0 };
      },
    },
  );
  deepStrictEqual(
    items.map((item) => item.id?.href),
    [iri("a").href],
  );
  deepStrictEqual(calls, [iri("thread").href, iri("page").href]);
  deepStrictEqual(intervals, [0, 1]);
});

test("embedded pages without IDs follow next without loader calls", async () => {
  const a = new Note({ id: new URL("https://example.com/a") });
  const b = new Note({ id: new URL("https://example.com/b") });
  const seed = new Note({
    replies: new Collection({
      first: new CollectionPage({
        items: [a],
        next: new CollectionPage({ items: [b] }),
      }),
    }),
  });
  const items = await collect(
    {
      documentLoader: () => {
        throw new Error("embedded pages must not be fetched");
      },
    },
    seed,
    { strategies: ["reply-tree"], maxRequests: 0, maxDepth: 1 },
  );
  deepStrictEqual(
    items.map((item) => item.id?.href),
    [a.id?.href, b.id?.href],
  );
});

describe("context loader failures", () => {
  const contextId = new URL("https://example.com/thread");
  const parent = new Note({ id: new URL("https://example.com/parent") });

  for (const synchronous of [false, true]) {
    const failure = synchronous ? "synchronous throw" : "promise rejection";
    const fail = () => {
      const error = new Error("Context collection unavailable");
      if (synchronous) throw error;
      return Promise.reject(error);
    };

    test(`${failure} allows reply-tree to yield an embedded parent`, async () => {
      const seed = new Note({ contexts: [contextId], replyTarget: parent });
      let requests = 0;
      const items = await collect(
        {
          documentLoader: () => {
            requests++;
            return fail();
          },
        },
        seed,
        { strategies: ["context-auto", "reply-tree"], maxRequests: 1 },
      );
      deepStrictEqual(
        items.map((item) => item.object),
        [parent],
      );
      strictEqual(items[0].strategy, "reply-tree");
      strictEqual(requests, 1);
    });

    test(`${failure} finishes the default strategy without items`, async () => {
      const seed = new Note({ contexts: [contextId] });
      deepStrictEqual(await collect({ documentLoader: fail }, seed), []);
    });

    test(`${failure} consumes the request budget`, async () => {
      const seed = new Note({ contexts: [contextId], replyTarget: parent.id });
      const requests: string[] = [];
      const items = await collect(
        {
          documentLoader: (url) => {
            requests.push(url.href);
            if (url.href === contextId.href) return fail();
            return Promise.resolve(parent);
          },
        },
        seed,
        { strategies: ["context-auto", "reply-tree"], maxRequests: 1 },
      );
      deepStrictEqual(items, []);
      deepStrictEqual(requests, [contextId.href]);
    });

    test(`${failure} propagates the cancellation reason`, async () => {
      const controller = new AbortController();
      const reason = new Error("Stop backfill");
      const seed = new Note({ contexts: [contextId], replyTarget: parent });
      const yielded: unknown[] = [];
      await rejects(
        async () => {
          for await (const item of backfill(
            {
              documentLoader: (_url, options) => {
                strictEqual(options?.signal, controller.signal);
                controller.abort(reason);
                return fail();
              },
            },
            seed,
            {
              strategies: ["context-auto", "reply-tree"],
              signal: controller.signal,
            },
          ))
            yielded.push(item);
        },
        (error) => error === reason,
      );
      deepStrictEqual(yielded, []);
    });
  }

  test("a failed context load is not cached for later reply-tree loads", async () => {
    const seed = new Note({ contexts: [contextId], replyTarget: contextId });
    let requests = 0;
    const items = await collect(
      {
        documentLoader: (url) => {
          strictEqual(url.href, contextId.href);
          requests++;
          if (requests === 1) {
            return Promise.reject(new Error("Temporary failure"));
          }
          return Promise.resolve(parent);
        },
      },
      seed,
      { strategies: ["context-auto", "reply-tree"], maxRequests: 2 },
    );
    deepStrictEqual(
      items.map((item) => item.object.id?.href),
      [parent.id?.href],
    );
    strictEqual(requests, 2);
  });

  test("an exhausted budget still allows embedded reply-tree data", async () => {
    const seed = new Note({ contexts: [contextId], replyTarget: parent });
    const items = await collect(
      {
        documentLoader: () => {
          throw new Error("No requests allowed");
        },
      },
      seed,
      { strategies: ["context-auto", "reply-tree"], maxRequests: 0 },
    );
    deepStrictEqual(
      items.map((item) => item.object),
      [parent],
    );
  });

  test("interval callback errors propagate before the loader is called", async () => {
    const reason = new Error("Invalid interval configuration");
    let requests = 0;
    const seed = new Note({ contexts: [contextId], replyTarget: parent });
    await rejects(
      collect(
        {
          documentLoader: () => {
            requests++;
            return Promise.resolve(null);
          },
        },
        seed,
        {
          strategies: ["context-auto", "reply-tree"],
          interval: () => {
            throw reason;
          },
        },
      ),
      (error) => error === reason,
    );
    strictEqual(requests, 0);
  });

  test("invalid interval strings still propagate", async () => {
    let requests = 0;
    const seed = new Note({ contexts: [contextId], replyTarget: parent });
    await rejects(
      collect(
        {
          documentLoader: () => {
            requests++;
            return Promise.resolve(null);
          },
        },
        seed,
        {
          strategies: ["context-auto", "reply-tree"],
          interval: "not a duration",
        },
      ),
    );
    strictEqual(requests, 0);
  });
});
