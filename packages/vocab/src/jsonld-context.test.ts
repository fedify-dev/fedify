import { mockDocumentLoader, test } from "@fedify/fixture";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import {
  Collection,
  Image,
  Like,
  Link,
  Note,
  Object as VocabularyObject,
  OrderedCollectionPage,
  Person,
  Source,
} from "./vocab.ts";

const AS = "https://www.w3.org/ns/activitystreams";
const AS_ITEMS = `${AS}#items`;
const PROOF = "https://example.org/proof";
type JsonLdOptions = NonNullable<Parameters<Note["toJsonLd"]>[0]>;

// Like DrFed's saved-document wrappers, this supplies its own JSON-LD.
class DocumentObject extends VocabularyObject {
  constructor(readonly document: unknown) {
    super({});
  }

  override toJsonLd(): Promise<unknown> {
    return Promise.resolve(this.document);
  }
}

async function expand(document: unknown, loader = mockDocumentLoader) {
  return await jsonld.expand(document, { documentLoader: loader });
}

function freezeJson(value: unknown): void {
  if (value == null || typeof value !== "object") return;
  for (const child of Object.values(value)) freezeJson(child);
  Object.freeze(value);
}

test("default collection serialization preserves independent item contexts", async () => {
  for (const proof of [undefined, "an extension value"]) {
    const source = {
      "@context": [AS, { proof: "https://example.org/proof" }],
      id: "https://example.com/likes/1",
      type: "Like",
      object: "https://example.net/notes/1",
      ...(proof == null ? {} : { proof }),
    };
    const like = await Like.fromJsonLd(source, {
      contextLoader: mockDocumentLoader,
    });
    const sibling = new Like({ id: new URL("https://example.com/likes/2") });
    const page = new OrderedCollectionPage({
      id: new URL("https://example.com/outbox?page=1"),
      items: [like, sibling],
    });
    const json = await page.toJsonLd({ contextLoader: mockDocumentLoader }) as {
      orderedItems: unknown[];
    };
    const restored = await OrderedCollectionPage.fromJsonLd(json, {
      contextLoader: mockDocumentLoader,
    });
    const items = await Array.fromAsync(restored.getItems({
      contextLoader: mockDocumentLoader,
    }));
    deepStrictEqual(items.map((item) => item.id?.href), [
      source.id,
      sibling.id?.href,
    ]);
    deepStrictEqual(json.orderedItems[0], source);
    deepStrictEqual(await like.toJsonLd(), source);
    deepStrictEqual(
      await page.toJsonLd({ contextLoader: mockDocumentLoader }),
      json,
    );
    const expanded = await jsonld.expand(json, {
      documentLoader: mockDocumentLoader,
    });
    const standalone = await jsonld.expand(source, {
      documentLoader: mockDocumentLoader,
    });
    deepStrictEqual(expanded[0][AS_ITEMS][0]["@list"][0], standalone[0]);
    strictEqual(items.length, 2);
  }
});

test("default collection serialization preserves mixed sibling meanings", async () => {
  const source = {
    "@context": [AS, { proof: PROOF }],
    id: "https://example.com/likes/1",
    type: "Like",
    proof: "extension",
  };
  const contextual = await Like.fromJsonLd(source, {
    contextLoader: mockDocumentLoader,
  });
  const expandedNode = {
    "@id": "https://example.com/notes/expanded",
    "@type": [`${AS}#Note`],
    [`${AS}#content`]: [{ "@value": "expanded" }],
  };
  const compactNode = {
    id: "https://example.com/notes/compact",
    type: "Note",
    content: "inherits the parent context",
    sensitive: true,
  };
  freezeJson(expandedNode);
  const reference = "https://example.com/notes/reference";
  const page = new OrderedCollectionPage({
    items: [
      contextual,
      new Note({ id: new URL("https://example.com/notes/generated") }),
      new URL(reference),
      new DocumentObject({ "@id": "https://example.com/notes/id-only" }),
      new DocumentObject(expandedNode),
      new DocumentObject(compactNode),
    ],
  });
  const json = await page.toJsonLd({ contextLoader: mockDocumentLoader }) as {
    "@context": unknown[];
    orderedItems: unknown[];
  };
  const expanded = (await expand(json))[0][AS_ITEMS][0]["@list"];
  deepStrictEqual(expanded.map((node: { "@id": string }) => node["@id"]), [
    source.id,
    "https://example.com/notes/generated",
    reference,
    "https://example.com/notes/id-only",
    expandedNode["@id"],
    compactNode.id,
  ]);
  deepStrictEqual(json.orderedItems[0], source);
  deepStrictEqual(json.orderedItems[2], {
    "@context": { id: "@id" },
    id: reference,
  });
  deepStrictEqual(json.orderedItems[4], expandedNode);
  const inherited = await expand({
    "@context": json["@context"].slice(0, -1),
    orderedItems: [compactNode],
  });
  deepStrictEqual(expanded[5], inherited[0][AS_ITEMS][0]["@list"][0]);
  deepStrictEqual(compactNode, {
    id: "https://example.com/notes/compact",
    type: "Note",
    content: "inherits the parent context",
    sensitive: true,
  });
  const restored = await OrderedCollectionPage.fromJsonLd(json, {
    contextLoader: mockDocumentLoader,
  });
  // Referenced items remain references rather than locally decoded objects.
  deepStrictEqual(
    restored.itemIds.map((id) => id.href),
    expanded.map((node: { "@id": string }) => node["@id"]),
  );
});

test("default serialization does not leak enclosing terms into a child", async () => {
  const source = {
    "@context": {
      id: "@id",
      type: "@type",
      Note: `${AS}#Note`,
      proof: PROOF,
    },
    id: "https://example.com/notes/1",
    type: "Note",
    proof: "extension",
    orderedItems: "https://example.com/ignored",
  };
  const parsed = await Note.fromJsonLd(source, {
    contextLoader: mockDocumentLoader,
  });
  const page = await new OrderedCollectionPage({
    items: [parsed, new URL("https://example.com/reference")],
  }).toJsonLd({ contextLoader: mockDocumentLoader });
  deepStrictEqual(
    (await expand(page))[0][AS_ITEMS][0]["@list"][0],
    (await expand(source))[0],
  );
});

test("isolated URL references retain their original compact IRI expansion", async () => {
  const child = await Like.fromJsonLd({
    "@context": [AS, { proof: PROOF }],
    type: "Like",
  }, { contextLoader: mockDocumentLoader });
  const json = await new OrderedCollectionPage({
    items: [child, new URL("as:Note")],
  }).toJsonLd({ contextLoader: mockDocumentLoader }) as {
    orderedItems: unknown[];
  };
  deepStrictEqual(json.orderedItems[1], {
    "@context": { id: "@id" },
    id: `${AS}#Note`,
  });
  deepStrictEqual((await expand(json))[0][AS_ITEMS][0]["@list"][1], {
    "@id": `${AS}#Note`,
  });
});

test("default serialization isolates cached array documents without flattening them", async () => {
  const source = {
    "@context": [AS, { proof: PROOF }],
    type: "Like",
    proof: "extension",
  };
  const child = await Like.fromJsonLd([source], {
    contextLoader: mockDocumentLoader,
  });
  const json = await new OrderedCollectionPage({ items: [child] }).toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as { orderedItems: unknown[] };
  deepStrictEqual(json.orderedItems, [[source]]);
  const nested = (await expand(json))[0][AS_ITEMS][0]["@list"][0];
  deepStrictEqual(nested, (await expand(source))[0]);
  deepStrictEqual(await child.toJsonLd(), [source]);
});

test("moving a contextual document preserves its standalone interpretation", async () => {
  const source = {
    "@context": { extension: "https://example.org/extension" },
    extension: "value",
    name: "not defined here",
  };
  const child = await VocabularyObject.fromJsonLd(source, {
    contextLoader: mockDocumentLoader,
  });
  const json = await new OrderedCollectionPage({ items: [child] }).toJsonLd({
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(
    (await expand(json))[0][AS_ITEMS][0]["@list"][0],
    (await expand(source))[0],
  );
});

for (const context of [null, {}, []]) {
  test(`default serialization preserves explicit context ${JSON.stringify(context)}`, async () => {
    const source = {
      "@context": context,
      "@type": [`${AS}#Note`],
      [`${AS}#content`]: [{ "@value": "anonymous" }],
    };
    const note = await Note.fromJsonLd(source, {
      contextLoader: mockDocumentLoader,
    });
    const json = await new OrderedCollectionPage({ items: [note] }).toJsonLd({
      contextLoader: mockDocumentLoader,
    });
    deepStrictEqual(
      (await expand(json))[0][AS_ITEMS][0]["@list"][0],
      (await expand(source))[0],
    );
    deepStrictEqual(await note.toJsonLd(), source);
    await OrderedCollectionPage.fromJsonLd(json, {
      contextLoader: mockDocumentLoader,
    });
  });
}

test("default serialization isolates inherited and nested object properties", async () => {
  const source = {
    "@context": [AS, { proof: PROOF }],
    type: "Note",
    content: "a cached attachment",
    proof: "extension",
  };
  const child = await Note.fromJsonLd(source, {
    contextLoader: mockDocumentLoader,
  });
  const cached = await child.toJsonLd();
  freezeJson(cached);
  const note = new Note({ attachments: [child] });
  const page = new OrderedCollectionPage({ items: [note] });
  for (const parent of [note, page, new Collection({ items: [note] })]) {
    const json = await parent.toJsonLd({ contextLoader: mockDocumentLoader });
    await VocabularyObject.fromJsonLd(json, {
      contextLoader: mockDocumentLoader,
    });
    deepStrictEqual(
      await parent.toJsonLd({ contextLoader: mockDocumentLoader }),
      json,
    );
  }
  const json = await note.toJsonLd({ contextLoader: mockDocumentLoader }) as {
    attachment: unknown;
  };
  deepStrictEqual(json.attachment, source);
  deepStrictEqual(await child.toJsonLd(), cached);
  const attachment = (await expand(json))[0][`${AS}#attachment`][0];
  deepStrictEqual(attachment, (await expand(source))[0]);
});

test("default serialization includes nonentity Source and Link properties", async () => {
  const sourceJson = {
    "@context": [AS, { proof: PROOF }],
    type: "as:Source",
    content: "source text",
    proof: "extension",
  };
  const linkJson = {
    "@context": [AS, { proof: PROOF }],
    type: "Link",
    href: "https://example.com/page",
    proof: "extension",
  };
  const source = await Source.fromJsonLd(sourceJson, {
    contextLoader: mockDocumentLoader,
  });
  const link = await Link.fromJsonLd(linkJson, {
    contextLoader: mockDocumentLoader,
  });
  const note = new Note({
    source,
    urls: [link, new URL("https://example.com/other")],
  });
  const json = await note.toJsonLd({ contextLoader: mockDocumentLoader }) as {
    source: unknown;
    url: unknown[];
  };
  deepStrictEqual(json.source, sourceJson);
  deepStrictEqual(json.url[0], linkJson);
  const expanded = (await expand(json))[0];
  deepStrictEqual(expanded[`${AS}#source`][0], (await expand(sourceJson))[0]);
  deepStrictEqual(expanded[`${AS}#url`][0], (await expand(linkJson))[0]);
  const restored = await Note.fromJsonLd(json, {
    contextLoader: mockDocumentLoader,
  });
  strictEqual(restored.source?.content, source.content);
});

test("default serialization inspects completed custom overrides", async () => {
  class CustomNote extends Note {
    override async toJsonLd(options: JsonLdOptions = {}): Promise<unknown> {
      const json = await super.toJsonLd(options) as Record<string, unknown>;
      json["@context"] = [AS, { proof: PROOF }];
      json.proof = "extension";
      return json;
    }
  }
  class InheritedPage extends OrderedCollectionPage {}
  const child = new CustomNote({ content: "custom" });
  const page = await new InheritedPage({ items: [child] }).toJsonLd({
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(
    (await expand(page))[0][AS_ITEMS][0]["@list"][0],
    (await expand(await child.toJsonLd({ contextLoader: mockDocumentLoader })))[
      0
    ],
  );
});

test("default serialization supports remote and aliased child contexts", async () => {
  const contextUrl = "https://example.com/context";
  const loader: DocumentLoader = async (url) =>
    url === contextUrl
      ? {
        contextUrl: null,
        documentUrl: url,
        document: { "@context": [AS, { proof: PROOF, identifier: "@id" }] },
      }
      : await mockDocumentLoader(url);
  const source = {
    "@context": contextUrl,
    identifier: "https://example.com/likes/1",
    type: "Like",
    proof: "extension",
  };
  const child = await Like.fromJsonLd(source, { contextLoader: loader });
  const json = await new OrderedCollectionPage({ items: [child] }).toJsonLd({
    contextLoader: loader,
  });
  deepStrictEqual(
    (await expand(json, loader))[0][AS_ITEMS][0]["@list"][0],
    (await expand(source, loader))[0],
  );
  await OrderedCollectionPage.fromJsonLd(json, { contextLoader: loader });
});

test("default serialization does not guess that built-in contexts are safe", async () => {
  const source = {
    "@context": AS,
    type: "Note",
    sensitive: true,
  };
  const note = await Note.fromJsonLd(source, {
    contextLoader: mockDocumentLoader,
  });
  const json = await new OrderedCollectionPage({ items: [note] }).toJsonLd({
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(
    (await expand(json))[0][AS_ITEMS][0]["@list"][0],
    (await expand(source))[0],
  );
});

test("default serialization leaves unsupported scalar mixtures wholly unchanged", async () => {
  const source = { "@context": [AS, { proof: PROOF }], type: "Like" };
  const child = new DocumentObject(source);
  const reference = "https://example.com/reference";
  const page = await new OrderedCollectionPage({
    items: [child, new URL(reference), new DocumentObject(true)],
  }).toJsonLd({ contextLoader: mockDocumentLoader }) as {
    "@context": unknown[];
    orderedItems: unknown[];
  };
  deepStrictEqual(page.orderedItems, [source, reference, true]);
  ok(
    !page["@context"].some((context) =>
      typeof context === "object" && context != null &&
      "orderedItems" in context
    ),
  );
});

test("default serialization loads parent contexts only when isolation is needed", async () => {
  let calls = 0;
  const loader: DocumentLoader = () => {
    calls++;
    return Promise.reject(new Error("context unavailable"));
  };
  await new Note({}).toJsonLd({ contextLoader: loader });
  strictEqual(calls, 0);
  await rejects(() =>
    new Note({ attachments: [new Note({})] }).toJsonLd({
      contextLoader: loader,
    })
  );
  ok(calls > 0);
});

test("default actor serialization preserves generated sibling meanings", async () => {
  const actor = new Person({
    id: new URL("https://example.com/actor"),
    icons: [new Image({ url: new URL("https://example.com/icon.png") })],
  });
  const json = await actor.toJsonLd({ contextLoader: mockDocumentLoader });
  await Person.fromJsonLd(json, { contextLoader: mockDocumentLoader });
  deepStrictEqual(
    await expand(json),
    await expand(
      await actor.toJsonLd({
        format: "expand",
        contextLoader: mockDocumentLoader,
      }),
    ),
  );
});
