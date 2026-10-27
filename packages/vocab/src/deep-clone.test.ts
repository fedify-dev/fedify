import {
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import { type DocumentLoader, LanguageString } from "@fedify/vocab-runtime";
import {
  deepStrictEqual,
  notStrictEqual,
  ok,
  strictEqual,
  throws,
} from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  Accept,
  Create,
  DataIntegrityProof,
  Endpoints,
  Link,
  Note,
  Object as VocabularyObject,
  Person,
  QuoteRequest,
  Reject,
  Source,
} from "./vocab.ts";

const options = { contextLoader: mockDocumentLoader };

function personLoader(name: string, fetched: string[] = []): DocumentLoader {
  // deno-lint-ignore require-await
  return async (url) => {
    fetched.push(url);
    return {
      contextUrl: null,
      documentUrl: url,
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: url,
        type: "Person",
        name,
      },
    };
  };
}

for (const hydrateOriginal of [false, true]) {
  test(`deepClone() isolates embedded quote hydration (${hydrateOriginal})`, async () => {
    const original = await QuoteRequest.fromJsonLd({
      "@context": ["https://www.w3.org/ns/activitystreams", {
        QuoteRequest: "https://w3id.org/fep/044f#QuoteRequest",
      }],
      id: "https://a.example/requests/1",
      type: "QuoteRequest",
      instrument: {
        id: "https://a.example/notes/1",
        type: "Note",
        attributedTo: "https://a.example/alice",
        content: "Quoted",
      },
    }, { ...options, documentLoader: personLoader("Alice") });
    const copy = original.deepClone();
    const sourceNote = await original.getInstrument();
    const copyNote = await copy.getInstrument();
    ok(sourceNote instanceof Note && copyNote instanceof Note);
    notStrictEqual(copyNote, sourceNote);
    const hydrated = hydrateOriginal ? sourceNote : copyNote;
    strictEqual((await hydrated.getAttribution())?.name, "Alice");
    for (const Wrapper of [Accept, Reject]) {
      const json = await new Wrapper({
        object: hydrateOriginal ? copy : original,
      }).toJsonLd(options) as {
        object: { instrument: { attributedTo: unknown } };
      };
      strictEqual(
        json.object.instrument.attributedTo,
        "https://a.example/alice",
      );
    }
    strictEqual(await original.getInstrument(), sourceNote);
    strictEqual(await copy.getInstrument(), copyNote);
  });
}

test("deepClone() copies replacements and preserves graph aliases", async () => {
  const id = new URL("https://example.com/notes/1");
  const child = new Note({ id, url: id, content: "Child" });
  const source = new Create({ object: child, attachments: [child] });
  const copy = source.deepClone({ objects: [child, child] });
  const objects = await Array.fromAsync(copy.getObjects());
  const attachment = (await Array.fromAsync(copy.getAttachments()))[0];
  strictEqual(objects[0], objects[1]);
  strictEqual(objects[0], attachment);
  notStrictEqual(objects[0], child);
  strictEqual(objects[0].id, objects[0].url);
  notStrictEqual(objects[0].id, id);
  objects[0].id!.pathname = "/changed";
  strictEqual(id.pathname, "/notes/1");
  strictEqual(await source.getObject(), child);

  const backReference = source.deepClone({ object: source });
  const snapshot = await backReference.getObject();
  ok(snapshot instanceof Create);
  notStrictEqual(snapshot, source);
  notStrictEqual(snapshot, backReference);
  ok(await snapshot.getObject() instanceof Note);
  await backReference.toJsonLd(options);
});

test("deepClone() copies non-entity vocabulary objects and standalone roots", () => {
  const endpoint = new URL("https://example.com/inbox");
  const endpoints = new Endpoints({ sharedInbox: endpoint });
  const source = new Source({ content: "Markdown" });
  const person = new Person({ endpoints, source });
  const copy = person.deepClone();
  notStrictEqual(copy.endpoints, endpoints);
  notStrictEqual(copy.source, source);
  notStrictEqual(copy.endpoints!.sharedInbox, endpoint);
  copy.endpoints!.sharedInbox!.pathname = "/copied";
  strictEqual(endpoint.pathname, "/inbox");
  const link = new Link({ href: endpoint }).deepClone();
  notStrictEqual(link.href, endpoint);
  strictEqual(link.href!.href, endpoint.href);
});

test("deepClone() copies byte arrays including Buffer storage", async () => {
  for (const bytes of [new Uint8Array([1, 2, 3]), Buffer.from([1, 2, 3])]) {
    const proof = new DataIntegrityProof({ proofValue: bytes });
    const original = new Note({ proof });
    const copy = original.deepClone();
    const copiedProof = await copy.getProof();
    ok(copiedProof instanceof DataIntegrityProof);
    notStrictEqual(copiedProof, proof);
    notStrictEqual(copiedProof.proofValue, bytes);
    copiedProof.proofValue![0] = 9;
    strictEqual(bytes[0], 1);
    bytes[1] = 8;
    strictEqual(copiedProof.proofValue![1], 2);
  }
});

test("deepClone() shares immutable scalars and preserves sparse arrays", () => {
  const content = new LanguageString("Hello", "en");
  const published = Temporal.Instant.from("2026-10-27T00:00:00Z");
  const names = new Array<string>(3);
  names[2] = "Kept";
  const source = new Note({ names, content, published });
  const copy = source.deepClone();
  strictEqual(copy.content, content);
  strictEqual(copy.published, published);
  deepStrictEqual(copy.names, source.names);
  strictEqual(0 in copy.names, false);
  copy.names.push("Copy only");
  strictEqual(source.names.length, 3);
});

test("deepClone() retains node defaults and overrides only the root", async () => {
  const fetched: string[] = [];
  const [rootTracer, rootSpans] = createTestTracerProvider();
  const [childTracer, childSpans] = createTestTracerProvider();
  const child = new Note({
    attribution: new URL("https://example.com/child-actor"),
  }, {
    ...options,
    documentLoader: personLoader("Child", fetched),
    tracerProvider: childTracer,
  });
  const source = new Create({
    actor: new URL("https://example.com/root-actor"),
    object: child,
  }, {
    ...options,
    documentLoader: personLoader("Root", fetched),
    tracerProvider: rootTracer,
  });
  const copy = source.deepClone({}, {
    documentLoader: personLoader("Override"),
  });
  strictEqual((await copy.getActor())?.name, "Override");
  const copiedChild = await copy.getObject();
  ok(copiedChild instanceof Note);
  strictEqual((await copiedChild.getAttribution())?.name, "Child");
  strictEqual((await source.getActor())?.name, "Root");
  deepStrictEqual(fetched, [
    "https://example.com/child-actor",
    "https://example.com/root-actor",
  ]);
  strictEqual(rootSpans.getSpans("activitypub.lookup_object").length, 2);
  strictEqual(childSpans.getSpans("activitypub.lookup_object").length, 1);
});

test("deepClone() preserves origin checks and isolates hydrated trust", async () => {
  let fetches = 0;
  const original = await Create.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://a.example/create",
    type: "Create",
    object: {
      id: "https://b.example/note",
      type: "Note",
      content: "Embedded",
    },
  }, {
    ...options,
    // deno-lint-ignore require-await
    documentLoader: async (url) => {
      fetches++;
      return {
        contextUrl: null,
        documentUrl: url,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: url,
          type: "Note",
          content: "Fetched",
        },
      };
    },
  });
  const copy = original.deepClone();
  strictEqual((await copy.getObject())?.content, "Fetched");
  strictEqual(fetches, 1);
  strictEqual(
    (await original.getObject({ crossOrigin: "trust" }))?.content,
    "Embedded",
  );
  strictEqual((await original.getObject())?.content, "Fetched");
  strictEqual(fetches, 2);
});

test("deepClone() keeps base URLs and discards cached JSON-LD", async () => {
  const source = await Note.fromJsonLd({
    "@context": ["https://www.w3.org/ns/activitystreams", {
      extension: "https://example.com/extension",
    }],
    type: "Note",
    id: "./note",
    attributedTo: "./alice",
    extension: "received only",
  }, {
    ...options,
    baseUrl: new URL("https://example.com/posts/"),
    documentLoader: personLoader("Alice"),
  });
  const copy = source.deepClone({ content: "Copy" });
  strictEqual(copy.id!.href, "https://example.com/posts/note");
  strictEqual(
    (await copy.getAttribution())?.id?.href,
    "https://example.com/posts/alice",
  );
  const json = await copy.toJsonLd(options) as Record<string, unknown>;
  strictEqual(json.content, "Copy");
  strictEqual(json.extension, undefined);
  strictEqual(
    (await source.toJsonLd() as Record<string, unknown>).extension,
    "received only",
  );
});

test("deepClone() validates replacements through clone() only", () => {
  const source = new Note({ content: "Source" });
  for (
    const values of [
      { id: 42 },
      { name: "one", names: ["two"] },
      { names: [42] },
    ]
  ) {
    throws(() => source.deepClone(values as never), TypeError);
  }
  function values(counter: { reads: number }) {
    return Object.create({
      get content() {
        counter.reads++;
        return "Inherited";
      },
    }) as { content: string };
  }
  const shallowReads = { reads: 0 };
  const deepReads = { reads: 0 };
  strictEqual(source.clone(values(shallowReads)).content, "Inherited");
  strictEqual(source.deepClone(values(deepReads)).content, "Inherited");
  strictEqual(deepReads.reads, shallowReads.reads);
});

test("deepClone() preserves user subclasses and handles deep graphs", async () => {
  class CustomNote extends Note {}
  const child = new CustomNote({ content: "Child" });
  const copiedChild = await new Create({ object: child }).deepClone()
    .getObject();
  ok(copiedChild instanceof CustomNote);
  notStrictEqual(copiedChild, child);
  let source = new Note({ content: "End" });
  for (let i = 0; i < 3000; i++) source = new Note({ replyTarget: source });
  let copy = source.deepClone();
  for (let i = 0; i < 3000; i++) {
    const next = await copy.getReplyTarget();
    ok(next instanceof Note);
    copy = next;
  }
  strictEqual(copy.content, "End");
});

test("deepClone() rejects broken subclass clone results", () => {
  class ReturnsSelf extends Note {
    override clone(): this {
      return this;
    }
  }
  const source = new ReturnsSelf({ id: new URL("https://example.com/note") });
  const id = source.id;
  throws(() => source.deepClone(), /fresh, compatible/);
  strictEqual(source.id, id);

  class Incompatible extends Note {
    override clone(): Note {
      return new VocabularyObject({}) as Note;
    }
  }
  throws(() => new Incompatible({}).deepClone(), /fresh, compatible/);

  class ReusesCopy extends Note {
    static copy: Note | undefined;
    override clone(): Note {
      return ReusesCopy.copy ??= super.clone();
    }
  }
  const first = new ReusesCopy({ content: "First" });
  const second = new ReusesCopy({ content: "Second" });
  throws(
    () => new Create({ objects: [first, second] }).deepClone(),
    /fresh, compatible/,
  );
  strictEqual(first.content, "First");
  strictEqual(second.content, "Second");

  class Throws extends Note {
    override clone(): never {
      throw new Error("Copy failed");
    }
  }
  const child = new Throws({ content: "Unchanged" });
  const parent = new Create({ object: child });
  throws(() => parent.deepClone(), /Copy failed/);
  strictEqual(child.content, "Unchanged");
});
