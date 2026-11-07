import { mockDocumentLoader, test } from "@fedify/fixture";
import { LanguageString } from "@fedify/vocab-runtime";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import {
  Create,
  getRawPropertyValue,
  getRawPropertyValues,
  Note,
  Object as ASObject,
  Person,
  Question,
} from "./mod.ts";

const AS = "https://www.w3.org/ns/activitystreams";
const QUANT = "https://w3id.org/quantpub#";
const STRUCTURED_URL = `${QUANT}structuredUrl`;

const structuredNote = {
  "@context": [AS, { quant: QUANT }],
  id: "https://example.com/notes/1",
  type: "Note",
  content: "Hello",
  "quant:structuredUrl": { "@id": "https://example.com/data/1?token=abc" },
};

test("getRawPropertyValues() reads an unknown property", async () => {
  const note = await Note.fromJsonLd(structuredNote);
  deepStrictEqual(await getRawPropertyValues(note, STRUCTURED_URL), [
    { "@id": "https://example.com/data/1?token=abc" },
  ]);
  deepStrictEqual(
    await getRawPropertyValues(note, new URL(STRUCTURED_URL)),
    [{ "@id": "https://example.com/data/1?token=abc" }],
  );
  deepStrictEqual(await getRawPropertyValues(note, `${QUANT}missing`), []);
  deepStrictEqual(await getRawPropertyValue(note, STRUCTURED_URL), {
    "@id": "https://example.com/data/1?token=abc",
  });
  strictEqual(await getRawPropertyValue(note, `${QUANT}missing`), null);
});

test("getRawPropertyValues() is independent of prefixes", async () => {
  const note = await Note.fromJsonLd({
    "@context": [AS, { q: QUANT, url2: `${QUANT}structuredUrl` }],
    type: "Note",
    "q:structuredUrl": { "@id": "https://example.com/a" },
    url2: { "@id": "https://example.com/b" },
  });
  deepStrictEqual(await getRawPropertyValues(note, STRUCTURED_URL), [
    { "@id": "https://example.com/a" },
    { "@id": "https://example.com/b" },
  ]);
});

test("getRawPropertyValues() reads literals, lists, and JSON", async () => {
  const note = await Note.fromJsonLd({
    "@context": [
      AS,
      {
        quant: QUANT,
        "quant:series": { "@container": "@list" },
        "quant:payload": { "@type": "@json" },
      },
    ],
    type: "Note",
    "quant:label": [{ "@value": "One", "@language": "en" }, "Two", 3],
    "quant:series": [1, 2],
    "quant:payload": { nested: { value: [true, null] } },
  });
  deepStrictEqual(await getRawPropertyValues(note, `${QUANT}label`), [
    { "@value": "One", "@language": "en" },
    { "@value": "Two" },
    { "@value": 3 },
  ]);
  deepStrictEqual(await getRawPropertyValues(note, `${QUANT}series`), [
    { "@list": [{ "@value": 1 }, { "@value": 2 }] },
  ]);
  deepStrictEqual(await getRawPropertyValue(note, `${QUANT}series`), {
    "@list": [{ "@value": 1 }, { "@value": 2 }],
  });
  deepStrictEqual(await getRawPropertyValues(note, `${QUANT}payload`), [
    { "@type": "@json", "@value": { nested: { value: [true, null] } } },
  ]);
});

test("getRawPropertyValues() returns deep copies", async () => {
  const note = await Note.fromJsonLd({
    "@context": [AS, { quant: QUANT, "quant:payload": { "@type": "@json" } }],
    type: "Note",
    "quant:payload": { list: [1] },
  });
  const values = await getRawPropertyValues(note, `${QUANT}payload`);
  (values[0] as { "@value": { list: number[] } })["@value"].list.push(2);
  values.push({ "@value": "extra" });
  deepStrictEqual(await getRawPropertyValues(note, `${QUANT}payload`), [
    { "@type": "@json", "@value": { list: [1] } },
  ]);
});

test("getRawPropertyValues() reads embedded objects", async () => {
  // The embedded note relies on the parent's context only:
  const create = await Create.fromJsonLd({
    "@context": [AS, { quant: QUANT }],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      id: "https://example.com/notes/1",
      type: "Note",
      "quant:structuredUrl": { "@id": "https://example.com/data/1" },
    },
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  deepStrictEqual(await getRawPropertyValues(note, STRUCTURED_URL), [
    { "@id": "https://example.com/data/1" },
  ]);
  const notes = await Array.fromAsync(create.getObjects());
  deepStrictEqual(await getRawPropertyValues(notes[0], STRUCTURED_URL), [
    { "@id": "https://example.com/data/1" },
  ]);
});

test("getRawPropertyValues() reads embedded objects with their own contexts", async () => {
  // The prefix comes from the parent, while the embedded note has its own
  // context, so the accessors find it in the cached JSON-LD:
  const create = await Create.fromJsonLd({
    "@context": [AS, { quant: QUANT }],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": AS,
      id: "https://example.com/notes/1",
      type: "Note",
      "quant:structuredUrl": { "@id": "https://example.com/data/1" },
    },
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  deepStrictEqual(await getRawPropertyValues(note, STRUCTURED_URL), [
    { "@id": "https://example.com/data/1" },
  ]);
  const notes = await Array.fromAsync(create.getObjects());
  deepStrictEqual(await getRawPropertyValues(notes[0], STRUCTURED_URL), [
    { "@id": "https://example.com/data/1" },
  ]);
});

test("getRawPropertyValues() reads objects nested in cached embedded objects", async () => {
  const create = await Create.fromJsonLd({
    "@context": [AS, { quant: QUANT }],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": AS,
      id: "https://example.com/notes/1",
      type: "Note",
      attachment: {
        type: "Document",
        "quant:structuredUrl": { "@id": "https://example.com/data/2" },
      },
    },
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  const [attachment] = await Array.fromAsync(note.getAttachments());
  ok(attachment != null);
  deepStrictEqual(await getRawPropertyValues(attachment, STRUCTURED_URL), [
    { "@id": "https://example.com/data/2" },
  ]);
});

test("getRawPropertyValues() reads embedded objects that rely on the parent's context", async () => {
  // Only the outer context defines these terms, and the embedded objects
  // have their own contexts, so accessors decode them from the cache again:
  const create = await Create.fromJsonLd({
    "@context": [AS, {
      Doc: `${AS}#Document`,
      Poll: `${AS}#Question`,
      choices: `${AS}#oneOf`,
      quant: QUANT,
    }],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": AS,
      id: "https://example.com/questions/1",
      type: ["Poll", "Object"],
      choices: [{ type: "Note", name: "Yes" }],
      "quant:structuredUrl": { "@id": "https://example.com/data/1" },
      attachment: [
        {
          type: "Doc",
          "quant:structuredUrl": { "@id": "https://example.com/data/a" },
        },
        {
          type: "Document",
          "quant:structuredUrl": { "@id": "https://example.com/data/b" },
        },
      ],
    },
  });
  const question = await create.getObject();
  ok(question instanceof Question);
  deepStrictEqual(
    (await Array.fromAsync(question.getExclusiveOptions())).map((o) =>
      o.name?.toString()
    ),
    ["Yes"],
  );
  deepStrictEqual(await getRawPropertyValues(question, STRUCTURED_URL), [
    { "@id": "https://example.com/data/1" },
  ]);
  const attachments = await Array.fromAsync(question.getAttachments());
  deepStrictEqual(attachments.length, 2);
  for (const [i, attachment] of attachments.entries()) {
    ok(attachment != null);
    deepStrictEqual(await getRawPropertyValues(attachment, STRUCTURED_URL), [
      { "@id": `https://example.com/data/${"ab"[i]}` },
    ]);
  }
});

test("embedded objects keep the order of the parent's context", async () => {
  const create = await Create.fromJsonLd({
    // The second entry refers to a term the first one defines:
    "@context": [AS, { Alias: "Note", quant: QUANT }],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": AS,
      id: "https://example.com/notes/1",
      type: "Alias",
      content: "Hello",
      "quant:structuredUrl": { "@id": "https://example.com/data/1" },
    },
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  deepStrictEqual(await getRawPropertyValues(note, STRUCTURED_URL), [
    { "@id": "https://example.com/data/1" },
  ]);
});

test("embedded objects do not inherit non-propagating contexts", async () => {
  const create = await Create.fromJsonLd({
    // Only the first entry of a context can declare this:
    "@context": [{ "@propagate": false, body: `${AS}#content` }, AS],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": AS,
      id: "https://example.com/notes/1",
      type: "Note",
      // The term is out of scope here, so this is not the content:
      body: "Not the content",
      content: "Hello",
    },
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  deepStrictEqual(note.contents, ["Hello"]);
});

test("embedded objects keep their own non-propagating contexts", async () => {
  const create = await Create.fromJsonLd({
    "@context": AS,
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": [{ "@propagate": false, body: `${AS}#content` }, AS],
      id: "https://example.com/notes/1",
      type: "Note",
      attachment: {
        "@context": AS,
        type: "Document",
        // The term is out of scope here, so this is not the content:
        body: "Not the content",
        content: "Hello",
      },
    },
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  const [attachment] = await Array.fromAsync(note.getAttachments());
  ok(attachment instanceof ASObject);
  deepStrictEqual(attachment.contents, ["Hello"]);
});

test("embedded objects keep their cached JSON-LD as received", async () => {
  const context = [AS, "https://w3id.org/security/data-integrity/v1"];
  const object = {
    "@context": context,
    id: "https://example.com/notes/1",
    type: "Alias",
    content: "Hello",
    attachment: {
      "@context": AS,
      type: "Doc",
      "quant:structuredUrl": { "@id": "https://example.com/data/1" },
    },
  };
  const create = await Create.fromJsonLd({
    "@context": [AS, {
      Alias: `${AS}#Note`,
      Doc: `${AS}#Document`,
      quant: QUANT,
    }],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object,
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  // A proof can cover the context, so it has to stay as it was received:
  deepStrictEqual(await note.toJsonLd(), object);
  // Objects nested in it still get the context of the outermost document:
  const [attachment] = await Array.fromAsync(note.getAttachments());
  ok(attachment != null);
  deepStrictEqual(await getRawPropertyValues(attachment, STRUCTURED_URL), [
    { "@id": "https://example.com/data/1" },
  ]);
});

test("embedded portable objects keep their own contexts in the cache", async () => {
  const did = "did:key:z6Mkpbx26hCxv3hr2gEz8iCm6SykyBU7wXPa3tTceF2fiFVr";
  const create = await Create.fromJsonLd({
    "@context": [AS, { Alias: `${AS}#Note` }],
    id: `ap://${did}/activities/1`,
    type: "Create",
    actor: `ap://${did}/actor`,
    object: {
      "@context": AS,
      id: `ap://${did}/objects/1`,
      type: "Alias",
      attributedTo: `ap://${did}/actor`,
      content: "Hello",
    },
  });
  const note = await create.getObject({
    verifyPortableObject: () => Promise.resolve({ verified: true }),
  });
  ok(note instanceof Note);
  const jsonLd = await note.toJsonLd() as Record<string, unknown>;
  deepStrictEqual(jsonLd["@context"], AS);
  strictEqual(jsonLd.content, "Hello");
});

test("accessors do not load contexts once per field of a cached document", async () => {
  const context = "https://example.com/contexts/extension";
  let loads = 0;
  const contextLoader = (url: string) => {
    if (url !== context) return mockDocumentLoader(url);
    loads++;
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: { "@context": { ext: "https://example.com/ns#" } },
    });
  };
  const create = await Create.fromJsonLd({
    "@context": [AS, context],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    ...Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`ext:field${i}`, i]),
    ),
    object: {
      "@context": AS,
      id: "https://example.com/notes/1",
      type: "Note",
      content: "Hello",
    },
  }, { contextLoader });
  loads = 0;
  const note = await create.getObject({ contextLoader });
  ok(note instanceof Note);
  ok(loads <= 5, `Loaded the context ${loads} times.`);
});

test("embedded objects keep their received JSON-LD on the fallback path", async () => {
  const object = {
    "@context": AS,
    id: "https://example.com/notes/1",
    type: "Note",
    content: "Hello",
    // A signature can cover a property that typed values cannot rebuild:
    [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
  };
  for (
    const context of [
      [AS, { object: { "@id": `${AS}#object`, "@context": {} } }],
      [{ "@propagate": false, body: `${AS}#content` }, AS],
    ]
  ) {
    const create = await Create.fromJsonLd({
      "@context": context,
      id: "https://example.com/activities/1",
      type: "Create",
      actor: "https://example.com/users/alice",
      object,
    });
    const note = await create.getObject();
    ok(note instanceof Note);
    deepStrictEqual(await note.toJsonLd(), object);
  }
});

test("accessors do not load contexts once per embedded object", async () => {
  const context = "https://example.com/contexts/extension";
  let loads = 0;
  const contextLoader = (url: string) => {
    if (url !== context) return mockDocumentLoader(url);
    loads++;
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: { "@context": { ext: "https://example.com/ns#" } },
    });
  };
  const note = await Note.fromJsonLd({
    "@context": [AS, context],
    id: "https://example.com/notes/1",
    type: "Note",
    attachment: Array.from({ length: 50 }, (_, i) => ({
      "@context": AS,
      type: "Document",
      name: `Attachment ${i}`,
    })),
  }, { contextLoader });
  loads = 0;
  const attachments = await Array.fromAsync(
    note.getAttachments({ contextLoader }),
  );
  strictEqual(attachments.length, 50);
  ok(loads <= 5, `Loaded the context ${loads} times.`);
});

test("embedded objects keep values under type-scoped contexts", async () => {
  const create = await Create.fromJsonLd({
    "@context": [AS, {
      body: `${AS}#content`,
      Create: {
        "@id": `${AS}#Create`,
        "@context": { "@propagate": true, body: null },
      },
    }],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": AS,
      id: "https://example.com/notes/1",
      type: "Note",
      // The type-scoped context of the parent removes this term:
      body: "Not the content",
      content: "Hello",
    },
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  deepStrictEqual(note.contents, ["Hello"]);
});

test("embedded objects keep their received JSON-LD under type-scoped terms", async () => {
  const object = {
    "@context": AS,
    id: "https://example.com/notes/1",
    type: "Note",
    content: "Hello",
    [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
  };
  const create = await Create.fromJsonLd({
    "@context": [AS, {
      object: null,
      // Only this type-scoped context maps the term to the property:
      Create: {
        "@id": `${AS}#Create`,
        "@context": { object: `${AS}#object` },
      },
    }],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object,
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  deepStrictEqual(await note.toJsonLd(), object);
});

test("embedded objects keep values under property-scoped contexts", async () => {
  const create = await Create.fromJsonLd({
    "@context": [AS, {
      body: `${AS}#content`,
      object: { "@id": `${AS}#object`, "@context": { body: null } },
    }],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": AS,
      id: "https://example.com/notes/1",
      type: "Note",
      // The property-scoped context of the parent removes this term:
      body: "Not the content",
      content: "Hello",
    },
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  deepStrictEqual(note.contents, ["Hello"]);
});

test("getRawPropertyValues() reads embedded objects under terms of the parent's context", async () => {
  const note = await Note.fromJsonLd({
    "@context": [AS, { extra: `${AS}#attachment`, attachment: null }],
    id: "https://example.com/notes/1",
    type: "Note",
    // The outer context ignores this term and maps another to as:attachment,
    // so the cached documents under the default term are not the values:
    attachment: [
      {
        "@context": AS,
        type: "Document",
        name: "Ignored",
        [STRUCTURED_URL]: { "@id": "https://example.com/data/0" },
      },
    ],
    extra: [
      {
        "@context": AS,
        type: "Document",
        name: "First",
        [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
      },
      {
        "@context": AS,
        type: "Document",
        name: "Second",
        [STRUCTURED_URL]: { "@id": "https://example.com/data/2" },
      },
    ],
  });
  const attachments = await Array.fromAsync(note.getAttachments());
  deepStrictEqual(attachments.map((a) => a?.name?.toString()), [
    "First",
    "Second",
  ]);
  for (const [i, attachment] of attachments.entries()) {
    ok(attachment != null);
    deepStrictEqual(await getRawPropertyValues(attachment, STRUCTURED_URL), [
      { "@id": `https://example.com/data/${i + 1}` },
    ]);
  }
});

test("getRawPropertyValues() keeps unknown properties across copies", async () => {
  const note = await Note.fromJsonLd(structuredNote);
  const expected = [{ "@id": "https://example.com/data/1?token=abc" }];
  const clone = note.clone({ content: "Edited" });
  deepStrictEqual(await getRawPropertyValues(clone, STRUCTURED_URL), expected);
  deepStrictEqual(
    await getRawPropertyValues(note.deepClone(), STRUCTURED_URL),
    expected,
  );
  const reparsed = await Note.fromJsonLd(await note.toJsonLd());
  deepStrictEqual(
    await getRawPropertyValues(reparsed, STRUCTURED_URL),
    expected,
  );
  const expanded = await Note.fromJsonLd(
    await clone.toJsonLd({ format: "expand" }),
  );
  // Serializing from typed values does not emit unknown properties:
  deepStrictEqual(await getRawPropertyValues(expanded, STRUCTURED_URL), []);
  deepStrictEqual(
    await getRawPropertyValues(new Note({ content: "Hi" }), STRUCTURED_URL),
    [],
  );
});

test("getRawPropertyValues() keeps unknown properties of partly invalid objects", async () => {
  const note = await Note.fromJsonLd({
    ...structuredNote,
    // Neither an Image nor a Link, so it is skipped:
    icon: 123,
  });
  deepStrictEqual(await getRawPropertyValues(note, STRUCTURED_URL), [
    { "@id": "https://example.com/data/1?token=abc" },
  ]);
});

test("getRawPropertyValues() encodes known properties", async () => {
  const note = await Note.fromJsonLd(structuredNote);
  deepStrictEqual(await getRawPropertyValues(note, `${AS}#content`), [
    { "@value": "Hello" },
  ]);
  const clone = note.clone({
    contents: ["Edited", new LanguageString("Modifié", "fr")],
    attribution: new URL("https://example.com/users/alice"),
  });
  deepStrictEqual(await getRawPropertyValues(clone, `${AS}#content`), [
    { "@value": "Edited" },
    { "@value": "Modifié", "@language": "fr" },
  ]);
  deepStrictEqual(await getRawPropertyValues(clone, `${AS}#attributedTo`), [
    { "@id": "https://example.com/users/alice" },
  ]);
  deepStrictEqual(await getRawPropertyValues(clone, `${AS}#name`), []);
});

test("getRawPropertyValues() encodes known object properties", async () => {
  const create = new Create({
    id: new URL("https://example.com/activities/1"),
    object: new Note({
      id: new URL("https://example.com/notes/1"),
      content: "Hello",
    }),
  });
  deepStrictEqual(await getRawPropertyValues(create, `${AS}#object`), [
    {
      "@id": "https://example.com/notes/1",
      "@type": [`${AS}#Note`],
      [`${AS}#content`]: [{ "@value": "Hello" }],
    },
  ]);
  const question = new Question({
    exclusiveOptions: [new Note({ name: "A" }), new Note({ name: "B" })],
  });
  deepStrictEqual(await getRawPropertyValues(question, `${AS}#oneOf`), [
    { "@type": [`${AS}#Note`], [`${AS}#name`]: [{ "@value": "A" }] },
    { "@type": [`${AS}#Note`], [`${AS}#name`]: [{ "@value": "B" }] },
  ]);
});

test("getRawPropertyValues() maps redundant aliases to canonical properties", async () => {
  // dcterms:license is written canonically, so the alias is never emitted:
  const note = await Note.fromJsonLd({
    "@context": [AS, { schema: "https://schema.org/" }],
    type: "Note",
    "schema:license": { "@id": "https://creativecommons.org/licenses/by/4.0/" },
  });
  const expected = [{ "@id": "https://creativecommons.org/licenses/by/4.0/" }];
  deepStrictEqual(
    await getRawPropertyValues(note, "https://schema.org/license"),
    expected,
  );
  deepStrictEqual(
    await getRawPropertyValues(note, "http://purl.org/dc/terms/license"),
    expected,
  );
});

test("getRawPropertyValues() classifies properties by the concrete class", async () => {
  // A Person does not have Question's oneOf property, so it is retained:
  const person = await Person.fromJsonLd({
    "@context": AS,
    type: "Person",
    oneOf: { type: "Note", name: "A" },
  });
  deepStrictEqual(await getRawPropertyValues(person, `${AS}#oneOf`), [
    { "@type": [`${AS}#Note`], [`${AS}#name`]: [{ "@value": "A" }] },
  ]);
  const object = await ASObject.fromJsonLd({
    "@context": [AS, { quant: QUANT }],
    type: "Note",
    "quant:structuredUrl": { "@id": "https://example.com/data/1" },
  });
  ok(object instanceof Note);
  deepStrictEqual(await getRawPropertyValues(object, STRUCTURED_URL), [
    { "@id": "https://example.com/data/1" },
  ]);
});

test("getRawPropertyValues() does not resolve relative IRIs of unknown properties", async () => {
  // Expansion cannot tell which properties hold IRIs that may be resolved,
  // e.g., fedify:absoluteIri values are never resolved, so it gets no base:
  const note = await Note.fromJsonLd({
    "@context": [AS, { quant: QUANT }],
    type: "Note",
    "quant:structuredUrl": { "@id": "data/1" },
  }, { baseUrl: new URL("https://example.com/notes/") });
  deepStrictEqual(await getRawPropertyValues(note, STRUCTURED_URL), [
    { "@id": "data/1" },
  ]);
});

test("getRawPropertyValues() matches normalized IRIs", async () => {
  const note = await Note.fromJsonLd(structuredNote);
  deepStrictEqual(
    await getRawPropertyValues(note, "HTTPS://W3ID.org/quantpub#structuredUrl"),
    [{ "@id": "https://example.com/data/1?token=abc" }],
  );
  deepStrictEqual(
    await getRawPropertyValues(
      note,
      "HTTPS://www.w3.org/ns/activitystreams#content",
    ),
    [{ "@value": "Hello" }],
  );
});

test("getRawPropertyValues() rejects invalid property IRIs", async () => {
  const note = await Note.fromJsonLd(structuredNote);
  for (
    const iri of [
      "",
      "@id",
      "@type",
      "_:b0",
      "content",
      "/content",
      "#content",
      "https://example.com/a b",
      "https://example.com/%zz",
      "https://example.com/#a#b",
    ]
  ) {
    await rejects(() => getRawPropertyValues(note, iri), TypeError, iri);
  }
  await rejects(
    () => getRawPropertyValues(note, 123 as unknown as string),
    TypeError,
  );
  await rejects(
    () =>
      getRawPropertyValues(
        {
          "~fedify.vocab": true,
          id: null,
          toJsonLd: () => Promise.resolve({}),
        },
        STRUCTURED_URL,
      ),
    TypeError,
  );
});

test("getRawPropertyValues() warns about compact IRIs", async () => {
  const records: LogRecord[] = [];
  await configure({
    sinks: { buffer: (record: LogRecord) => records.push(record) },
    loggers: [
      { category: ["fedify", "vocab"], sinks: ["buffer"] },
      { category: ["logtape", "meta"], sinks: [] },
    ],
    reset: true,
  });
  try {
    const note = await Note.fromJsonLd(structuredNote);
    deepStrictEqual(await getRawPropertyValues(note, "as:summary"), []);
    deepStrictEqual(await getRawPropertyValues(note, "as:summary"), []);
    deepStrictEqual(
      await getRawPropertyValues(note, "urn:example:property"),
      [],
    );
    deepStrictEqual(
      await getRawPropertyValues(note, "https://example.com/property"),
      [],
    );
    strictEqual(records.length, 2);
    strictEqual(records[0].level, "warning");
    deepStrictEqual(records[0].properties, {
      iri: "as:summary",
      scheme: "as",
      function: "getRawPropertyValues",
      suggestion: `${AS}#summary`,
    });
    deepStrictEqual(records[1].properties, {
      iri: "urn:example:property",
      scheme: "urn",
      function: "getRawPropertyValues",
    });
  } finally {
    await reset();
  }
});
