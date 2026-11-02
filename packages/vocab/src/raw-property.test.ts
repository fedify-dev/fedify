import { test } from "@fedify/fixture";
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
  Service,
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
  // context, so the accessors reparse it from the cached JSON-LD:
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

test("getRawPropertyValues() reads objects nested in reparsed embedded objects", async () => {
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

test("getRawPropertyValues() does not mix up objects dropped by a reparse", async () => {
  const create = await Create.fromJsonLd({
    "@context": [AS, { quant: QUANT, Doc: `${AS}#Document` }],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": AS,
      id: "https://example.com/notes/1",
      type: "Note",
      attachment: [
        {
          // Only the outer context defines this type alias:
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
  const note = await create.getObject();
  ok(note instanceof Note);
  const attachments = await Array.fromAsync(note.getAttachments());
  // Reparsed without the outer context, the first attachment is dropped:
  strictEqual(attachments.length, 1);
  ok(attachments[0] != null);
  // Without an id to match, the remaining attachment cannot be paired with
  // its original, so it must not receive the dropped attachment's values:
  deepStrictEqual(
    await getRawPropertyValues(attachments[0], STRUCTURED_URL),
    [],
  );
});

test("getRawPropertyValues() keeps unknown properties when a reparse changes the class", async () => {
  const create = await Create.fromJsonLd({
    "@context": [AS, { Poll: `${AS}#Question`, quant: QUANT }],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": AS,
      id: "https://example.com/questions/1",
      // Only the outer context defines this type alias and prefix:
      type: ["Poll", "Object"],
      oneOf: [{ type: "Note", name: "Yes" }],
      "quant:structuredUrl": { "@id": "https://example.com/data/1" },
      attachment: {
        type: "Document",
        "quant:structuredUrl": { "@id": "https://example.com/data/2" },
      },
    },
  });
  const object = await create.getObject();
  ok(object != null);
  ok(!(object instanceof Question));
  // Retained only by the reparse, as the original class knew it:
  deepStrictEqual(
    (await getRawPropertyValues(object, `${AS}#oneOf`)).length,
    1,
  );
  // Retained only by the original decode, which had the outer context:
  deepStrictEqual(await getRawPropertyValues(object, STRUCTURED_URL), [
    { "@id": "https://example.com/data/1" },
  ]);
  const [attachment] = await Array.fromAsync(object.getAttachments());
  ok(attachment != null);
  deepStrictEqual(await getRawPropertyValues(attachment, STRUCTURED_URL), [
    { "@id": "https://example.com/data/2" },
  ]);
});

test("getRawPropertyValues() follows properties shared by sibling classes", async () => {
  const create = await Create.fromJsonLd({
    "@context": [AS, { Human: `${AS}#Person`, quant: QUANT }],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": AS,
      id: "https://example.com/users/bot",
      // Only the outer context defines this type alias and prefix:
      type: ["Human", "Service"],
      endpoints: {
        sharedInbox: "https://example.com/inbox",
        "quant:structuredUrl": { "@id": "https://example.com/data/1" },
      },
    },
  });
  const actor = await create.getObject();
  ok(actor instanceof Service);
  const endpoints = actor.endpoints;
  ok(endpoints != null);
  deepStrictEqual(await getRawPropertyValues(endpoints, STRUCTURED_URL), [
    { "@id": "https://example.com/data/1" },
  ]);
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
