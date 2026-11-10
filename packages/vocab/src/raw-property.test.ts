import jsonld from "@fedify/vocab-runtime/jsonld";
import { mockDocumentLoader, test } from "@fedify/fixture";
import { LanguageString } from "@fedify/vocab-runtime";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import {
  deepStrictEqual,
  notDeepStrictEqual,
  ok,
  rejects,
  strictEqual,
} from "node:assert/strict";
import {
  Activity,
  Create,
  DataIntegrityProof,
  getRawPropertyValue,
  getRawPropertyValues,
  Image,
  Note,
  Object as ASObject,
  OrderedCollection,
  OrderedCollectionPage,
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
  deepStrictEqual(await getRawPropertyValues(note, new URL(STRUCTURED_URL)), [
    { "@id": "https://example.com/data/1?token=abc" },
  ]);
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
  // context, so it is decoded with the whole document's context:
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
  // have their own contexts, so they have to be decoded with the whole
  // document:
  const create = await Create.fromJsonLd({
    "@context": [
      AS,
      {
        Doc: `${AS}#Document`,
        Poll: `${AS}#Question`,
        choices: `${AS}#oneOf`,
        quant: QUANT,
      },
    ],
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
      o.name?.toString(),
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
    "@context": [
      AS,
      {
        Alias: `${AS}#Note`,
        Doc: `${AS}#Document`,
        quant: QUANT,
      },
    ],
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
  const jsonLd = (await note.toJsonLd()) as Record<string, unknown>;
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
  const create = await Create.fromJsonLd(
    {
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
    },
    { contextLoader },
  );
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
  for (const context of [
    [AS, { object: { "@id": `${AS}#object`, "@context": {} } }],
    [{ "@propagate": false, body: `${AS}#content` }, AS],
  ]) {
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
  const note = await Note.fromJsonLd(
    {
      "@context": [AS, context],
      id: "https://example.com/notes/1",
      type: "Note",
      attachment: Array.from({ length: 50 }, (_, i) => ({
        "@context": AS,
        type: "Document",
        name: `Attachment ${i}`,
      })),
    },
    { contextLoader },
  );
  loads = 0;
  const attachments = await Array.fromAsync(
    note.getAttachments({ contextLoader }),
  );
  strictEqual(attachments.length, 50);
  ok(loads <= 5, `Loaded the context ${loads} times.`);
});

test("embedded objects keep values under type-scoped contexts", async () => {
  const create = await Create.fromJsonLd({
    "@context": [
      AS,
      {
        body: `${AS}#content`,
        Create: {
          "@id": `${AS}#Create`,
          "@context": { "@propagate": true, body: null },
        },
      },
    ],
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
    "@context": [
      AS,
      {
        object: null,
        // Only this type-scoped context maps the term to the property:
        Create: {
          "@id": `${AS}#Create`,
          "@context": { object: `${AS}#object` },
        },
      },
    ],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object,
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  deepStrictEqual(await note.toJsonLd(), object);
});

test("embedded objects keep their received JSON-LD under @type-scoped terms", async () => {
  const object = {
    "@context": AS,
    id: "https://example.com/notes/1",
    type: "Note",
    content: "Hello",
    [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
  };
  const create = await Create.fromJsonLd({
    "@context": [
      AS,
      {
        object: null,
        // Only this type-scoped context maps the term to the property:
        Create: {
          "@id": `${AS}#Create`,
          "@context": { object: `${AS}#object` },
        },
      },
    ],
    id: "https://example.com/activities/1",
    "@type": "Create",
    actor: "https://example.com/users/alice",
    object,
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  deepStrictEqual(await note.toJsonLd(), object);
});

test("received documents use the contexts loaded while decoding", async () => {
  const context = "https://example.com/contexts/scoped";
  const object = {
    "@context": AS,
    id: "https://example.com/notes/1",
    type: "Note",
    [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
  };
  const contextLoader = (url: string) =>
    url === context
      ? Promise.resolve({
          contextUrl: null,
          documentUrl: url,
          document: { "@context": { ext: "https://example.com/ns#" } },
        })
      : mockDocumentLoader(url);
  const create = await Create.fromJsonLd(
    {
      "@context": [
        AS,
        {
          // Only the type brings in this remote context:
          Create: { "@id": `${AS}#Create`, "@context": context },
        },
      ],
      id: "https://example.com/activities/1",
      type: "Create",
      actor: "https://example.com/users/alice",
      object,
    },
    { contextLoader },
  );
  const failingLoader = (url: string) =>
    url === context
      ? Promise.reject(new Error("Temporary failure"))
      : mockDocumentLoader(url);
  // The type-scoped context was loaded while decoding, so a loader that fails
  // later does not change which key is which property:
  const note = await create.getObject({ contextLoader: failingLoader });
  ok(note instanceof Note);
  deepStrictEqual(await note.toJsonLd(), object);
});

test("received documents of nested objects skip non-propagating contexts", async () => {
  const attachment = {
    "@context": AS,
    type: "Document",
    [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
  };
  const create = await Create.fromJsonLd({
    "@context": [{ "@propagate": false, extra: `${AS}#attachment` }, AS],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": AS,
      id: "https://example.com/notes/1",
      type: "Note",
      // The term is out of scope here, so this is not an attachment:
      extra: "Not an attachment",
      attachment,
    },
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  const [nested] = await Array.fromAsync(note.getAttachments());
  ok(nested instanceof ASObject);
  deepStrictEqual(await nested.toJsonLd(), attachment);
});

test("accessors keep values whatever the loader passed to them", async () => {
  const context = "https://example.com/contexts/extension";
  const contextLoader = (url: string) =>
    url === context
      ? Promise.resolve({
          contextUrl: null,
          documentUrl: url,
          document: { "@context": { ext: "https://example.com/ns#" } },
        })
      : mockDocumentLoader(url);
  const note = await Note.fromJsonLd(
    {
      "@context": [AS, context],
      id: "https://example.com/notes/1",
      type: "Note",
      attachment: Array.from({ length: 50 }, (_, i) => ({
        "@context": AS,
        type: "Document",
        name: `Attachment ${i}`,
      })),
    },
    { contextLoader },
  );
  let loads = 0;
  const failingLoader = (url: string) => {
    if (url !== context) return mockDocumentLoader(url);
    loads++;
    return Promise.reject(new Error("Temporary failure"));
  };
  // Matching the cached documents reuses the contexts loaded while decoding,
  // so a failing loader neither costs the values nor gets called:
  for (const suppressError of [false, true]) {
    const attachments = await Array.fromAsync(
      note.getAttachments({ contextLoader: failingLoader, suppressError }),
    );
    strictEqual(attachments.length, 50);
  }
  strictEqual(loads, 0);
});
test("embedded objects under graph containers keep their received JSON-LD", async () => {
  const proof = {
    "@context": [
      "https://w3id.org/security/data-integrity/v1",
      { extra: "https://example.com/ns#extra" },
    ],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: "https://example.com/users/alice#key",
    proofPurpose: "assertionMethod",
    proofValue: "zAbc",
    created: "2026-01-01T00:00:00Z",
    extra: "Covered by the signature",
  };
  const create = await Create.fromJsonLd({
    "@context": [AS, "https://w3id.org/security/data-integrity/v1"],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    proof,
  });
  const [received] = await Array.fromAsync(create.getProofs());
  ok(received != null);
  deepStrictEqual(await received.toJsonLd(), proof);
});

test("nested objects use the property-scoped contexts they were reached through", async () => {
  const right = { "@context": AS, type: "Document", name: "Right" };
  const create = await Create.fromJsonLd({
    "@context": [
      AS,
      {
        object: {
          "@id": `${AS}#object`,
          "@context": {
            attachment: "https://example.com/other",
            payload: `${AS}#attachment`,
          },
        },
      },
    ],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": {},
      id: "https://example.com/notes/1",
      type: "Note",
      attachment: { "@context": AS, type: "Document", name: "Wrong" },
      payload: right,
    },
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  const attachments = await Array.fromAsync(note.getAttachments());
  deepStrictEqual(
    attachments.map((a) => a?.name?.toString()),
    ["Right"],
  );
  ok(attachments[0] != null);
  const jsonLd = (await attachments[0].toJsonLd()) as Record<string, unknown>;
  notDeepStrictEqual(jsonLd.name, "Wrong");
});

test("nested received documents drop scoped contexts that a null context reset", async () => {
  const attachment = {
    "@context": AS,
    type: "Document",
    name: "Correct",
    [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
  };
  const create = await Create.fromJsonLd({
    "@context": [
      {
        object: {
          "@id": `${AS}#object`,
          "@context": {
            wrongTerm: `${AS}#attachment`,
            attachment: "https://example.com/unrelated",
          },
        },
      },
      null,
      AS,
    ],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": {},
      id: "https://example.com/notes/1",
      type: "Note",
      attachment,
    },
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  const [nested] = await Array.fromAsync(note.getAttachments());
  ok(nested != null);
  deepStrictEqual(await nested.toJsonLd(), attachment);
});

test("embedded objects do not get received JSON-LD after hydration", async () => {
  const create = await Create.fromJsonLd(
    {
      "@context": AS,
      id: "https://example.com/activities/1",
      type: "Create",
      actor: "https://example.com/users/alice",
      object: {
        "@context": AS,
        id: "https://example.com/notes/1",
        type: "Note",
        attributedTo: "https://example.com/person",
      },
    },
    { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader },
  );
  // A clone shares the embedded object, which gets hydrated through it first:
  const shared = await create.clone().getObject();
  ok(shared instanceof Note);
  ok((await shared.getAttribution()) != null);
  const note = await create.getObject();
  strictEqual(note, shared);
  const jsonLd = (await note!.toJsonLd()) as Record<string, unknown>;
  ok(
    jsonLd.attributedTo != null && typeof jsonLd.attributedTo === "object",
    "The hydrated value is kept rather than the received IRI.",
  );
});

test("embedded objects get received JSON-LD only from aligned arrays", async () => {
  const documents = ["A", "B"].map((name) => ({
    "@context": AS,
    type: "Document",
    name,
    [STRUCTURED_URL]: { "@id": `https://example.com/data/${name}` },
  }));
  const note = await Note.fromJsonLd({
    "@context": AS,
    id: "https://example.com/notes/1",
    type: "Note",
    // Expansion drops the null, so positions no longer correspond:
    attachment: [null, ...documents],
  });
  const attachments = await Array.fromAsync(note.getAttachments());
  deepStrictEqual(attachments.length, 2);
  for (const [i, attachment] of attachments.entries()) {
    ok(attachment != null);
    const jsonLd = (await attachment.toJsonLd()) as Record<string, unknown>;
    strictEqual(jsonLd.name, documents[i].name);
  }
  const create = await Create.fromJsonLd({
    "@context": AS,
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    // Decoding skips the blank node reference:
    object: [{ "@context": AS, id: "_:b0" }, documents[0]],
  });
  const object = await create.getObject();
  ok(object != null);
  const jsonLd = (await object.toJsonLd()) as Record<string, unknown>;
  strictEqual(jsonLd.name, "A");
});

test("received documents map keys as decoding did, whatever the loader", async () => {
  const context = "https://example.com/contexts/remap";
  const remapping = (url: string) =>
    url === context
      ? Promise.resolve({
          contextUrl: null,
          documentUrl: url,
          document: {
            "@context": { extra: `${AS}#attachment`, attachment: null },
          },
        })
      : mockDocumentLoader(url);
  const plain = (url: string) =>
    url === context
      ? Promise.resolve({
          contextUrl: null,
          documentUrl: url,
          document: { "@context": {} },
        })
      : mockDocumentLoader(url);
  const note = await Note.fromJsonLd(
    {
      "@context": [AS, context],
      id: "https://example.com/notes/1",
      type: "Note",
      attachment: { "@context": AS, type: "Document", name: "Ignored" },
      extra: { "@context": AS, type: "Document", name: "Real" },
    },
    { contextLoader: remapping },
  );
  const [attachment] = await Array.fromAsync(
    note.getAttachments({ contextLoader: plain }),
  );
  ok(attachment != null);
  const jsonLd = (await attachment.toJsonLd()) as Record<string, unknown>;
  strictEqual(jsonLd.name, "Real");
});

test("values that preprocessors made do not get received JSON-LD", async () => {
  const note = await Note.fromJsonLd({
    "@context": AS,
    id: "https://example.com/notes/1",
    type: "Note",
    // Normalized into an Image, which this document does not describe:
    icon: {
      "@context": AS,
      type: "Link",
      href: "https://example.com/icon.png",
    },
  });
  const icon = await note.getIcon();
  ok(icon instanceof Image);
  const jsonLd = (await icon.toJsonLd()) as Record<string, unknown>;
  strictEqual(jsonLd.type, "Image");
  ok((await Image.fromJsonLd(jsonLd)) instanceof Image);
});

test("embedded objects get their own documents from @set objects", async () => {
  const doc = (name: string) => ({
    "@context": AS,
    type: "Document",
    name,
    [STRUCTURED_URL]: { "@id": `https://example.com/data/${name}` },
  });
  const note = await Note.fromJsonLd({
    "@context": AS,
    id: "https://example.com/notes/1",
    type: "Note",
    // As many entries as values, but in another arrangement:
    attachment: [
      { "@set": [doc("X"), doc("Y")] },
      doc("C"),
      { "@context": AS, id: "_:b0" },
    ],
  });
  const attachments = await Array.fromAsync(note.getAttachments());
  ok(attachments.length >= 3);
  for (const attachment of attachments) {
    ok(attachment != null);
    const jsonLd = (await attachment.toJsonLd()) as Record<string, unknown>;
    if (jsonLd.name == null) continue;
    strictEqual(jsonLd.name, attachment.name?.toString());
  }
});

test("embedded objects keep their documents under remote type-scoped contexts", async () => {
  const context = "https://example.com/contexts/scoped";
  const contextLoader = (url: string) =>
    url === context
      ? Promise.resolve({
          contextUrl: null,
          documentUrl: url,
          document: {
            "@context": {
              attachment: null,
              Note: {
                "@id": `${AS}#Note`,
                "@context": { attachment: `${AS}#attachment` },
              },
            },
          },
        })
      : mockDocumentLoader(url);
  const attachment = {
    "@context": AS,
    type: "Document",
    name: "Real",
    [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
  };
  const note = await Note.fromJsonLd(
    {
      "@context": [AS, context],
      id: "https://example.com/notes/1",
      type: "Note",
      attachment,
    },
    { contextLoader },
  );
  const [received] = await Array.fromAsync(
    note.getAttachments({ contextLoader }),
  );
  ok(received != null);
  deepStrictEqual(await received.toJsonLd(), attachment);
});

test("value objects and wrappers with contexts do not disturb markers", async () => {
  const attachment = {
    "@context": AS,
    type: "Document",
    name: "Real",
    [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
  };
  for (const extra of [
    // A value object with a context, under an unrelated property:
    { "https://example.com/value": { "@context": {}, "@value": "literal" } },
    // A node object that uses an alias of @index:
    {
      "https://example.com/aliased": {
        "@context": [AS, { slot: "@index" }],
        slot: "original",
        name: "Aliased",
      },
    },
    // An indexed node object, whose index has to stay as it was:
    {
      "https://example.com/node": {
        "@context": AS,
        "@index": "original",
        name: "Indexed",
      },
    },
    // A value object with a context and a node object that uses an alias
    // of @index together, which cannot share one kind of marker:
    {
      "https://example.com/value": { "@context": {}, "@value": "literal" },
      "https://example.com/aliased": {
        "@context": [AS, { slot: "@index" }],
        slot: "original",
        name: "Aliased",
      },
    },
    // A @set object with a context, around another attachment:
    {
      attachment: [
        attachment,
        {
          "@context": AS,
          "@set": [{ "@context": AS, type: "Document", name: "Wrapped" }],
        },
      ],
    },
  ]) {
    const note = await Note.fromJsonLd({
      "@context": AS,
      id: "https://example.com/notes/1",
      type: "Note",
      attachment,
      ...extra,
    });
    const attachments = await Array.fromAsync(note.getAttachments());
    const real = attachments.find((a) => a?.name?.toString() === "Real");
    ok(real != null);
    deepStrictEqual(await real.toJsonLd(), attachment);
  }
});

test("received documents keep own __proto__ members of JSON values", async () => {
  // JSON.parse() makes an own __proto__ member, which a signed document can
  // have inside a JSON literal:
  const object = JSON.parse(`{
    "@context": [
      "${AS}",
      { "payload": { "@id": "https://example.com/ns#payload", "@type": "@json" } }
    ],
    "id": "https://example.com/notes/1",
    "type": "Note",
    "payload": { "__proto__": { "x": 1 }, "y": 2 }
  }`);
  const create = await Create.fromJsonLd({
    "@context": AS,
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object,
  });
  const note = await create.getObject();
  ok(note != null);
  strictEqual(JSON.stringify(await note.toJsonLd()), JSON.stringify(object));
});

test("embedded objects keep received JSON-LD beside long arrays", async () => {
  const object = { ...structuredNote, "@context": structuredNote["@context"] };
  const create = await Create.fromJsonLd({
    "@context": [AS, { ignored: null }],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    // A field the context maps to nothing, which expansion drops, but which
    // the received document keeps:
    ignored: Array.from({ length: 200_000 }, (_, i) => i),
    object,
  });
  const note = await create.getObject();
  ok(note != null);
  deepStrictEqual(await note.toJsonLd(), object);
});

test("equal values without their own contexts keep their own documents", async () => {
  const context = [AS, { extra: null }];
  const second = {
    "@context": context,
    type: "Document",
    name: "Same",
    extra: "second",
  };
  const note = await Note.fromJsonLd({
    "@context": context,
    id: "https://example.com/notes/1",
    type: "Note",
    // Both expand to the same node, but only the second has its own context:
    attachment: [{ type: "Document", name: "Same" }, second],
  });
  const [first, other] = await Array.fromAsync(note.getAttachments());
  ok(first != null && other != null);
  deepStrictEqual(await other.toJsonLd(), second);
  const firstJsonLd = (await first.toJsonLd()) as Record<string, unknown>;
  strictEqual(firstJsonLd.extra, undefined);
});

test("markers leave nodes and JSON literals as they expand", async () => {
  const PAYLOAD = "https://example.com/ns#payload";
  const literal = { "@context": AS, type: "Note", name: "Literal" };
  const note = await Note.fromJsonLd({
    "@context": [AS, { payload: { "@id": PAYLOAD, "@type": "@json" } }],
    id: "https://example.com/notes/1",
    type: "Note",
    // A document with its own context in a JSON literal stays as it is:
    payload: { nested: literal },
    // A document that expands to an empty node, which it stays:
    attachment: [
      { "@context": { unknown: null }, unknown: 1 },
      {
        "@context": AS,
        type: "Document",
        name: "Kept",
      },
    ],
  });
  deepStrictEqual(await getRawPropertyValues(note, PAYLOAD), [
    { "@type": "@json", "@value": { nested: literal } },
  ]);
  // The same values without contexts of their own, which get no markers:
  const unmarked = await Note.fromJsonLd({
    "@context": AS,
    id: "https://example.com/notes/1",
    type: "Note",
    attachment: [{}, { type: "Document", name: "Kept" }],
  });
  deepStrictEqual(
    (await Array.fromAsync(note.getAttachments())).map((a) =>
      a?.name?.toString(),
    ),
    (await Array.fromAsync(unmarked.getAttachments())).map((a) =>
      a?.name?.toString(),
    ),
  );
});

test("contexts that fail to load fail decoding despite markers", async () => {
  let failures = 1;
  await rejects(() =>
    Note.fromJsonLd(
      {
        "@context": AS,
        id: "https://example.com/notes/1",
        type: "Note",
        attachment: {
          "@context": [AS, "https://example.com/contexts/flaky"],
          type: "Document",
        },
      },
      {
        contextLoader: (url) => {
          if (url === "https://example.com/contexts/flaky" && failures-- > 0) {
            return Promise.reject(new Error("Temporarily failed"));
          }
          return url === "https://example.com/contexts/flaky"
            ? Promise.resolve({
                contextUrl: null,
                documentUrl: url,
                document: { "@context": {} },
              })
            : mockDocumentLoader(url);
        },
      },
    ),
  );
});

test("typed embedded nodes with @graph keep their received JSON-LD", async () => {
  const object = {
    "@context": AS,
    id: "https://example.com/notes/1",
    type: "Note",
    name: "Graph",
    "@graph": [{ id: "https://example.com/things/1", name: "Thing" }],
    [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
  };
  const create = await Create.fromJsonLd({
    "@context": AS,
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object,
  });
  const note = await create.getObject();
  ok(note != null);
  deepStrictEqual(await note.toJsonLd(), object);
});

test("graph objects with a key that is no type keep their expansion", async () => {
  const GRAPHS = "https://example.com/ns#graphs";
  // No ActivityStreams context, which would make type an alias of @type:
  const json = {
    "@context": {
      graphs: { "@id": GRAPHS, "@container": ["@graph", "@index"] },
    },
    "@id": "https://example.com/notes/1",
    "@type": `${AS}#Note`,
    graphs: {
      k: {
        "@context": { label: "https://example.com/ns#label" },
        "@graph": [{ "@id": "https://example.com/things/1", label: "Thing" }],
        // Not an alias of @type in this context, so this is a graph object:
        type: "whatever",
      },
    },
  };
  const note = await Note.fromJsonLd(json);
  const [expanded] = (await jsonld.expand(json, {
    documentLoader: mockDocumentLoader,
  })) as Record<string, unknown>[];
  deepStrictEqual(await getRawPropertyValues(note, GRAPHS), expanded[GRAPHS]);
});

test("objects with only a language stay dropped despite markers", async () => {
  const P = "https://example.com/p";
  for (const object of [
    { "@context": {}, "@language": "en" },
    { "@context": { lang: "@language" }, lang: "en" },
  ]) {
    const json = { "@type": `${AS}#Note`, [P]: object };
    const note = await Note.fromJsonLd(json);
    const [expanded] = (await jsonld.expand(json, {
      documentLoader: mockDocumentLoader,
    })) as Record<string, unknown>[];
    deepStrictEqual(
      await getRawPropertyValues(note, P),
      (expanded[P] ?? []) as unknown[],
    );
  }
});

test("documents under aliases of @nest are not taken for other objects", async () => {
  const create = await Create.fromJsonLd({
    "@context": [AS, { nested: "@nest" }],
    type: "Create",
    id: "https://example.com/activities/1",
    actor: "https://example.com/users/alice",
    object: {
      type: "Note",
      id: "https://example.com/notes/1",
      content: "Real",
      nested: {
        "@context": { extra: "https://example.com/extra" },
        extra: "x",
      },
    },
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  const jsonLd = (await note.toJsonLd()) as Record<string, unknown>;
  strictEqual(jsonLd.id, "https://example.com/notes/1");
  strictEqual(jsonLd.content, "Real");
});

test("documents under aliases of @nest in remote string contexts", async () => {
  const NEST = "https://example.com/contexts/nest";
  const create = await Create.fromJsonLd(
    {
      "@context": [AS, NEST],
      type: "Create",
      id: "https://example.com/activities/1",
      actor: "https://example.com/users/alice",
      object: {
        type: "Note",
        id: "https://example.com/notes/1",
        content: "Real",
        nested: {
          "@context": { extra: "https://example.com/extra" },
          extra: "x",
        },
      },
    },
    {
      contextLoader: (url) =>
        url === NEST
          ? Promise.resolve({
              contextUrl: null,
              documentUrl: url,
              // A loader can return the document as a JSON string:
              document: JSON.stringify({ "@context": { nested: "@nest" } }),
            })
          : mockDocumentLoader(url),
    },
  );
  const note = await create.getObject();
  ok(note instanceof Note);
  const jsonLd = (await note.toJsonLd()) as Record<string, unknown>;
  strictEqual(jsonLd.id, "https://example.com/notes/1");
  strictEqual(jsonLd.content, "Real");
});

test("embedded values that are graph objects decode their nodes", async () => {
  // Activity declares object, which Create inherits from it, so Create
  // decodes it in a superclass:
  for (const type of ["Activity", "Create"]) {
    for (const context of [{}, { "@context": AS }]) {
      const activity = await Activity.fromJsonLd({
        "@context": AS,
        type,
        id: "https://example.com/activities/1",
        actor: "https://example.com/users/alice",
        object: {
          ...context,
          "@graph": [
            {
              type: "Note",
              id: "https://example.com/notes/1",
              content: "Hello",
            },
          ],
        },
      });
      const object = await activity.getObject();
      ok(object instanceof Note, `${type} ${JSON.stringify(context)}`);
      strictEqual(object.content?.toString(), "Hello");
    }
  }
});

test("nodes in embedded graph objects keep their received JSON-LD", async () => {
  const note = {
    "@context": AS,
    type: "Note",
    id: "https://example.com/notes/1",
    content: "Hello",
    [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
  };
  const create = await Create.fromJsonLd({
    "@context": AS,
    type: "Create",
    id: "https://example.com/activities/1",
    actor: "https://example.com/users/alice",
    object: { "@context": AS, "@graph": [note] },
  });
  const object = await create.getObject();
  ok(object instanceof Note);
  deepStrictEqual(await object.toJsonLd(), note);
});

test("typed embedded nodes with only @graph are not taken for graphs", async () => {
  // Create takes @type out before its superclass decodes the rest, which then
  // has nothing but @graph:
  const activity = await Activity.fromJsonLd({
    "@context": AS,
    type: "Activity",
    id: "https://example.com/activities/1",
    actor: "https://example.com/users/alice",
    object: {
      type: "Create",
      "@graph": [
        {
          type: "Note",
          id: "https://example.com/notes/1",
          content: "Hi",
        },
      ],
    },
  });
  ok((await activity.getObject()) instanceof Create);
});

test("cyclic documents fail to decode instead of hanging", async () => {
  const json: Record<string, unknown> = {
    "@context": AS,
    type: "Note",
    id: "https://example.com/notes/1",
  };
  json.attachment = { "@context": AS, type: "Document", self: json };
  await rejects(() => Note.fromJsonLd(json));
});

test("documents with deeply nested ignored values decode", async () => {
  // A recursive scan of the document overflows the stack sooner than jsonld.js
  // does, at depths that differ by runtime, so decoding has to succeed at
  // every depth where plain expansion does:
  for (const depth of [3_000, 4_000, 4_500, 5_000, 5_500, 6_000]) {
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < depth; i++) deep = { deeper: deep };
    const json = {
      "@context": [AS, { ignored: null }],
      type: "Create",
      id: "https://example.com/activities/1",
      actor: "https://example.com/users/alice",
      ignored: deep,
      object: {
        "@context": AS,
        type: "Note",
        id: "https://example.com/notes/1",
        content: "Hello",
      },
    };
    try {
      await jsonld.expand(json, { documentLoader: mockDocumentLoader });
    } catch {
      continue;
    }
    const create = await Create.fromJsonLd(json);
    const note = await create.getObject();
    ok(note instanceof Note, `${depth}`);
    strictEqual(note.content?.toString(), "Hello");
  }
});

test("index maps with a key that reads @context keep their expansion", async () => {
  const P = "https://example.com/p";
  const json = {
    "@context": [AS, { p: { "@id": P, "@container": "@index" } }],
    type: "Note",
    id: "https://example.com/notes/1",
    // The key of an index map is no context, whatever it reads:
    p: { "@context": { "@id": "https://example.com/a" } },
    attachment: {
      "@context": AS,
      type: "Document",
      name: "Real",
      [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
    },
  };
  const note = await Note.fromJsonLd(json);
  const [expanded] = (await jsonld.expand(json, {
    documentLoader: mockDocumentLoader,
  })) as Record<string, unknown>[];
  deepStrictEqual(await getRawPropertyValues(note, P), expanded[P]);
});

test("received documents relying on their parents are re-encoded when embedded", async () => {
  const attachment = {
    "@context": AS,
    type: "Note",
    id: "https://example.com/notes/2",
    // Only the parent's context defines this term:
    mime: "text/plain",
  };
  const json = {
    "@context": [AS, { mime: `${AS}#mediaType` }],
    type: "Note",
    id: "https://example.com/notes/1",
    attachment,
  };
  const note = await Note.fromJsonLd(json);
  const [child] = await Array.fromAsync(note.getAttachments());
  ok(child instanceof Note);
  strictEqual(child.mediaType, "text/plain");
  // The received documents stay as they were, as proofs can cover them:
  deepStrictEqual(await child.toJsonLd(), attachment);
  deepStrictEqual(await note.toJsonLd(), json);
  // A clone has no received document, and embeds the attachment with what
  // it means rather than with a term its own context does not define:
  const cloned = await Note.fromJsonLd(await note.clone().toJsonLd());
  const [clonedChild] = await Array.fromAsync(cloned.getAttachments());
  ok(clonedChild instanceof Note);
  strictEqual(clonedChild.mediaType, "text/plain");
});

test("received documents gaining terms from a new parent are re-encoded", async () => {
  const context = {
    id: "@id",
    type: "@type",
    Note: `${AS}#Note`,
    attachment: { "@id": `${AS}#attachment`, "@type": "@id" },
  };
  for (const extra of [
    // A term that nothing defines, which a new parent's context would:
    { content: "resurrected" },
    // A term that would redefine a protected term of a new parent's context:
    { proof: "x" },
  ]) {
    const note = await Note.fromJsonLd({
      "@context": context,
      type: "Note",
      id: "https://example.com/notes/1",
      attachment: {
        "@context": {
          ...context,
          proof: "https://example.com/mine",
        },
        type: "Note",
        id: "https://example.com/notes/2",
        ...extra,
      },
    });
    const [child] = await Array.fromAsync(note.getAttachments());
    ok(child instanceof Note);
    strictEqual(child.content, null);
    const cloned = await Note.fromJsonLd(await note.clone().toJsonLd());
    const [clonedChild] = await Array.fromAsync(cloned.getAttachments());
    ok(clonedChild instanceof Note, JSON.stringify(extra));
    strictEqual(clonedChild.content, null);
  }
  // The same, nested in an object that has no received document itself, so
  // that its own context is not the only one the document lands under:
  const note = await Note.fromJsonLd({
    "@context": [AS, { mine: "https://example.com/mine" }],
    type: "Note",
    id: "https://example.com/notes/1",
    attachment: {
      type: "Link",
      href: "https://example.com/",
      preview: {
        "@context": { ...context, proof: "https://example.com/mine" },
        type: "Note",
        id: "https://example.com/notes/2",
        proof: "x",
      },
    },
  });
  // Decoding the clone's JSON-LD throws if the protected proof term got
  // redefined:
  await Note.fromJsonLd(await note.clone().toJsonLd());
});

test("received documents relying on their parents are re-encoded on their own", async () => {
  // Person has a name, so it is encoded without the compact path, which
  // expands its values on their own:
  const person = await Person.fromJsonLd({
    "@context": [AS, "https://w3id.org/security/v1"],
    type: "Person",
    id: "https://example.com/users/alice",
    name: "Alice",
    publicKey: {
      // Only the parent's context defines the other terms:
      "@context": { x: "https://example.com/x" },
      id: "https://example.com/users/alice#main-key",
      type: "Key",
      owner: "https://example.com/users/alice",
      publicKeyPem:
        "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyIB9rotX8G6r6/6toT+x\n24BUiQ/HaPH1Em9dOt4c94s+OPFoEdH7DY7Iym9A8LlH4JaGF8KD38bLHWe1S4x0\njV3gHJKhK7veJfGZCKUENcQecBZ+YWUs5HWvUIX1vVB//0luHrg6BQKGOrSOE+WI\nAxyr0qsWCFfZzQrvSnUD2yvg1arJX2xhms14uxoRd5Kg9efKSCmmQaNEapicARUm\nFWrIEpGFa/nUUnqimssAGw1eZFqf3wA4TjhsuARBhGaJtv/3KEa016eMZxy3kDlO\njZnXZTaTgWkXdodwUvy8563fes3Al6BlcS2iJ9qbtha8rSm0FHqoUKH73JsLPKQI\nwQIDAQAB\n-----END PUBLIC KEY-----",
    },
  });
  const key = await person.getPublicKey();
  ok(key != null);
  strictEqual(key.id?.href, "https://example.com/users/alice#main-key");
  const cloned = await Person.fromJsonLd(await person.clone().toJsonLd());
  const jsonLd = (await cloned.toJsonLd({ format: "expand" })) as Record<
    string,
    unknown
  >[];
  ok(
    JSON.stringify(jsonLd).includes("https://example.com/users/alice#main-key"),
    JSON.stringify(jsonLd),
  );
});

test("parents encoded anew keep the IRIs their embedded objects resolved", async () => {
  const note = await Note.fromJsonLd({
    "@context": AS,
    type: "Note",
    id: "https://example.com/a/root",
    // A relative IRI, resolved against the parent while decoding:
    attachment: { "@context": AS, type: "Note", id: "child" },
  });
  const [child] = await Array.fromAsync(note.getAttachments());
  strictEqual(child?.id?.href, "https://example.com/a/child");
  const cloned = await Note.fromJsonLd(
    await note.clone({ id: new URL("https://example.com/b/root") }).toJsonLd(),
  );
  const [clonedChild] = await Array.fromAsync(cloned.getAttachments());
  strictEqual(clonedChild?.id?.href, "https://example.com/a/child");
});

test("nested embedded objects share one copy of the received document", async () => {
  let document: Record<string, unknown> = {
    "@context": [AS, { ignored: null }],
    type: "Note",
    id: "https://example.com/notes/leaf",
    ignored: Array.from({ length: 1000 }, (_, i) => i),
  };
  for (let i = 0; i < 3; i++) {
    document = {
      "@context": AS,
      type: "Note",
      id: `https://example.com/notes/${i}`,
      attachment: document,
    };
  }
  const root = await Create.fromJsonLd({
    "@context": AS,
    type: "Create",
    id: "https://example.com/activities/1",
    actor: "https://example.com/users/alice",
    object: document,
  });
  const object = await root.getObject();
  ok(object instanceof Note);
  let parent: Note = object;
  // Each embedded object's received document is the one in its parent's:
  for (let i = 0; i < 3; i++) {
    const [child]: unknown[] = await Array.fromAsync(parent.getAttachments());
    ok(child instanceof Note);
    const parentJsonLd = (await parent.toJsonLd()) as Record<string, unknown>;
    strictEqual(await child.toJsonLd(), parentJsonLd.attachment);
    parent = child;
  }
});

test("content that reads @nest does not disable received documents", async () => {
  const object = {
    "@context": AS,
    type: "Note",
    id: "https://example.com/notes/1",
    content: "Hi",
    [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
  };
  const create = await Create.fromJsonLd({
    "@context": AS,
    type: "Create",
    id: "https://example.com/activities/1",
    actor: "https://example.com/users/alice",
    content: "@nest",
    object,
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  deepStrictEqual(await note.toJsonLd(), object);
});

test("contexts shared with ignored values still disable markers for @nest", async () => {
  const shared = { nested: "@nest" };
  const create = await Create.fromJsonLd({
    "@context": [AS, { junk: null }, shared],
    type: "Create",
    id: "https://example.com/activities/1",
    actor: "https://example.com/users/alice",
    // The same object as the last context, which is reached first here:
    junk: shared,
    object: {
      type: "Note",
      id: "https://example.com/notes/1",
      content: "Real",
      nested: {
        "@context": { extra: "https://example.com/extra" },
        extra: "x",
      },
    },
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  const jsonLd = (await note.toJsonLd()) as Record<string, unknown>;
  strictEqual(jsonLd.id, "https://example.com/notes/1");
});

test("decoding loads each context once despite the second expansion", async () => {
  const CTX = "https://example.com/contexts/parent";
  let loads = 0;
  const contextLoader = (url: string) => {
    if (url === CTX) {
      loads++;
      return Promise.resolve({
        contextUrl: null,
        documentUrl: url,
        document: { "@context": { mime: `${AS}#mediaType` } },
      });
    }
    return mockDocumentLoader(url);
  };
  await Note.fromJsonLd(
    {
      "@context": [AS, CTX],
      type: "Note",
      id: "https://example.com/notes/1",
      attachment: {
        "@context": AS,
        type: "Note",
        id: "https://example.com/notes/2",
      },
    },
    { contextLoader },
  );
  strictEqual(loads, 1);
});

test("copied received documents are re-encoded when embedded", async () => {
  const note = await Note.fromJsonLd({
    "@context": [AS, { mime: `${AS}#mediaType` }],
    type: "Note",
    id: "https://example.com/notes/1",
    attachment: {
      "@context": AS,
      type: "Note",
      id: "https://example.com/notes/2",
      // Only the parent's context defines this term:
      mime: "text/plain",
    },
  });
  const [child] = await Array.fromAsync(note.getAttachments());
  ok(child instanceof Note);
  // @fedify/testing copies the cache to a clone like this:
  type Cached = { _cachedJsonLd: unknown };
  const copy = child.clone();
  (copy as unknown as Cached)._cachedJsonLd = (
    child as unknown as Cached
  )._cachedJsonLd;
  const parent = new Note({
    id: new URL("https://example.com/notes/3"),
    attachments: [copy],
  });
  const decoded = await Note.fromJsonLd(await parent.toJsonLd());
  const [embedded] = await Array.fromAsync(decoded.getAttachments());
  ok(embedded instanceof Note);
  strictEqual(embedded.mediaType, "text/plain");
});

test("parents encoded anew encode embedded objects from their values", async () => {
  const attachment = {
    "@context": AS,
    type: "Note",
    id: "https://example.com/notes/2",
    content: "Hello",
    [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
  };
  const note = await Note.fromJsonLd({
    "@context": AS,
    type: "Note",
    id: "https://example.com/notes/1",
    attachment,
  });
  const [child] = await Array.fromAsync(note.getAttachments());
  ok(child != null);
  // The embedded object's own JSON-LD is still the document it was received
  // as, as a proof can cover it:
  deepStrictEqual(await child.toJsonLd(), attachment);
  // A clone is encoded anew, and so is the object in it, which has no unknown
  // properties to write, like the clone itself:
  const jsonLd = (await note.clone().toJsonLd()) as Record<string, unknown>;
  const embedded = jsonLd.attachment as Record<string, unknown>;
  strictEqual(embedded.content, "Hello");
  ok(!(STRUCTURED_URL in embedded));
  // Also under a list container:
  const collection = await OrderedCollection.fromJsonLd({
    "@context": AS,
    type: "OrderedCollection",
    id: "https://example.com/collections/1",
    orderedItems: [attachment],
  });
  const collectionJsonLd = (await collection.clone().toJsonLd()) as Record<
    string,
    unknown
  >;
  ok(!JSON.stringify(collectionJsonLd).includes(STRUCTURED_URL));
});

test("graph nodes typed through an alias keep their received JSON-LD", async () => {
  const object = {
    "@context": [AS, { kind: "@type" }],
    id: "https://example.com/notes/1",
    kind: "Note",
    name: "Graph",
    "@graph": [{ id: "https://example.com/things/1", name: "Thing" }],
    [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
  };
  const create = await Create.fromJsonLd({
    "@context": AS,
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object,
  });
  const note = await create.getObject();
  ok(note instanceof Note);
  deepStrictEqual(await note.toJsonLd(), object);
});

test("embedded objects with malformed values keep them dropped", async () => {
  const create = await Create.fromJsonLd({
    "@context": AS,
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      "@context": AS,
      id: "https://example.com/notes/1",
      type: "Note",
      contentMap: { invalid_tag: "Malformed", en: "Hello" },
    },
  });
  const note = await create.getObject();
  ok(note != null);
  const jsonLd = (await note.toJsonLd()) as Record<string, unknown>;
  ok(!JSON.stringify(jsonLd).includes("invalid_tag"), JSON.stringify(jsonLd));
});

test("documents that cannot take markers only lose received JSON-LD", async () => {
  const attachment = {
    "@context": AS,
    type: "Document",
    name: "Real",
    [STRUCTURED_URL]: { "@id": "https://example.com/data/1" },
  };
  const note = await Note.fromJsonLd({
    "@context": AS,
    id: "https://example.com/notes/1",
    type: "Note",
    attachment,
    // A value object under an alias of @value cannot have a property, so no
    // document of this note gets a marker:
    "https://example.com/value": {
      "@context": { value: "@value" },
      value: "literal",
    },
  });
  const [real] = await Array.fromAsync(note.getAttachments());
  ok(real != null);
  strictEqual(real.name?.toString(), "Real");
  deepStrictEqual(await getRawPropertyValues(real, STRUCTURED_URL), [
    { "@id": "https://example.com/data/1" },
  ]);
  deepStrictEqual(
    await getRawPropertyValues(note, "https://example.com/value"),
    [{ "@value": "literal" }],
  );
});

test("embedded objects get received JSON-LD through a copied cache", async () => {
  const object = { ...structuredNote, "@context": structuredNote["@context"] };
  const create = await Create.fromJsonLd({
    "@context": AS,
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/users/alice",
    object,
  });
  // @fedify/testing copies the cache to a clone of a received activity:
  const clone = create.clone({}, {});
  type Cached = { _cachedJsonLd: unknown };
  (clone as unknown as Cached)._cachedJsonLd = (
    create as unknown as Cached
  )._cachedJsonLd;
  const note = await clone.getObject();
  ok(note != null);
  deepStrictEqual(await note.toJsonLd(), object);
});

test("embedded objects in collection items get their own received documents", async () => {
  const page = await OrderedCollectionPage.fromJsonLd(
    {
      "@context": [AS, "https://example.com/contexts/unknown-page"],
      id: "https://example.com/pages/1",
      type: "OrderedCollectionPage",
      orderedItems: Array.from({ length: 30 }, (_, i) => ({
        "@context": AS,
        id: `https://example.com/notes/${i}`,
        type: "Note",
        attachment: { "@context": AS, type: "Document", name: `${i}` },
      })),
    },
    {
      contextLoader: (url) =>
        url === "https://example.com/contexts/unknown-page"
          ? Promise.resolve({
              contextUrl: null,
              documentUrl: url,
              document: { "@context": {} },
            })
          : mockDocumentLoader(url),
    },
  );
  const notes = await Array.fromAsync(page.getItems());
  strictEqual(notes.length, 30);
  for (const note of notes) {
    ok(note instanceof Note);
    const [attachment] = await Array.fromAsync(note.getAttachments());
    ok(attachment != null);
    const jsonLd = (await attachment.toJsonLd()) as Record<string, unknown>;
    strictEqual(jsonLd.name, note.id?.pathname.split("/").at(-1));
  }
});

test("getRawPropertyValues() encodes list containers as lists", async () => {
  const items = [
    new URL("https://example.com/notes/1"),
    new URL("https://example.com/notes/2"),
  ];
  const expected = [
    {
      "@list": [
        { "@id": "https://example.com/notes/1" },
        { "@id": "https://example.com/notes/2" },
      ],
    },
  ];
  const constructed = new OrderedCollectionPage({ items });
  deepStrictEqual(
    await getRawPropertyValues(constructed, `${AS}#items`),
    expected,
  );
  const decoded = await OrderedCollectionPage.fromJsonLd(
    await constructed.toJsonLd(),
  );
  deepStrictEqual(await getRawPropertyValues(decoded, `${AS}#items`), expected);
});

test("getRawPropertyValues() encodes graph containers as graphs", async () => {
  const PROOF = "https://w3id.org/security#proof";
  const proof = (value: string) =>
    new DataIntegrityProof({
      cryptosuite: "eddsa-jcs-2022",
      verificationMethod: new URL("https://example.com/users/alice#key"),
      proofPurpose: "assertionMethod",
      proofValue: new TextEncoder().encode(value),
      created: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    });
  for (const proofs of [[proof("a")], [proof("a"), proof("b")]]) {
    const constructed = new Create({
      id: new URL("https://example.com/activities/1"),
      actor: new URL("https://example.com/users/alice"),
      proofs,
    });
    const decoded = await Create.fromJsonLd(await constructed.toJsonLd());
    for (const object of [constructed, decoded]) {
      const values = await getRawPropertyValues(object, PROOF);
      strictEqual(values.length, proofs.length);
      for (const value of values) {
        ok("@graph" in value, JSON.stringify(value));
        const graph = (value as { "@graph": unknown[] })["@graph"];
        strictEqual(graph.length, 1);
      }
    }
  }
});

test("values that preprocessors made keep unknown properties", async () => {
  const note = await Note.fromJsonLd({
    "@context": [AS, { quant: QUANT }],
    id: "https://example.com/notes/1",
    type: "Note",
    icon: {
      type: "Link",
      href: "https://example.com/icon.png",
      rel: "icon",
      "quant:structuredUrl": { "@id": "https://example.com/data/1" },
    },
  });
  const icon = await note.getIcon();
  ok(icon instanceof Image);
  deepStrictEqual(await getRawPropertyValues(icon, STRUCTURED_URL), [
    { "@id": "https://example.com/data/1" },
  ]);
  deepStrictEqual(await getRawPropertyValues(icon, `${AS}#rel`), [
    { "@value": "icon" },
  ]);
});

test("embedded objects keep values under property-scoped contexts", async () => {
  const create = await Create.fromJsonLd({
    "@context": [
      AS,
      {
        body: `${AS}#content`,
        object: { "@id": `${AS}#object`, "@context": { body: null } },
      },
    ],
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
  deepStrictEqual(
    attachments.map((a) => a?.name?.toString()),
    ["First", "Second"],
  );
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
  const note = await Note.fromJsonLd(
    {
      "@context": [AS, { quant: QUANT }],
      type: "Note",
      "quant:structuredUrl": { "@id": "data/1" },
    },
    { baseUrl: new URL("https://example.com/notes/") },
  );
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
  for (const iri of [
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
  ]) {
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
