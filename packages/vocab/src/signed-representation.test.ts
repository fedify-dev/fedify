import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  isMarkerSafeContext,
  retainSignedRepresentation,
} from "@fedify/vocab-runtime/internal/signed-representation";
import { deepStrictEqual, ok } from "node:assert/strict";
import * as vocab from "./vocab.ts";
import {
  Announce,
  Create,
  Note,
  OrderedCollection,
  Question,
} from "./vocab.ts";

const securedNote = {
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/data-integrity/v1",
    { ex: "https://example.com/ns#" },
  ],
  id: "https://example.com/notes/1",
  type: "Note",
  content: "Hello",
  proof: {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      { ex: "https://example.com/ns#" },
    ],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: "2023-02-24T23:36:38Z",
    verificationMethod: "https://example.com/person#ed25519-key",
    proofPurpose: "assertionMethod",
    proofValue: "z3FXQ",
  },
};

const options = { contextLoader: mockDocumentLoader };

function retainedNote(): Note {
  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    content: "Hello",
  });
  retainSignedRepresentation(note, structuredClone(securedNote));
  return note;
}

test("nested serialization embeds a retained signed representation", async () => {
  const create = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/person"),
    object: retainedNote(),
  });
  const compact = await create.toJsonLd({
    format: "compact",
    ...options,
  }) as Record<string, unknown>;

  // `Create` is not compactable, so this goes through the expand-then-compact
  // path, which would otherwise dissolve the child's own contexts.
  deepStrictEqual(compact.object, securedNote);
});

test("nested serialization embeds a retained representation through a compactable parent", async () => {
  const wrapper = new Note({
    id: new URL("https://example.com/notes/wrapper"),
    attachments: [retainedNote()],
  });
  const compact = await wrapper.toJsonLd(options) as Record<string, unknown>;
  deepStrictEqual(compact.attachment, securedNote);

  // … and still when a non-compactable ancestor compacts the whole tree.
  const question = new Question({
    id: new URL("https://example.com/questions/1"),
    exclusiveOptions: [wrapper],
  });
  const compacted = await question.toJsonLd(options) as Record<string, unknown>;
  const embeddedWrapper = compacted.oneOf as Record<string, unknown>;
  deepStrictEqual(embeddedWrapper.attachment, securedNote);
});

test("nested serialization embeds one retained representation many times", async () => {
  const note = retainedNote();
  const create = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/person"),
    objects: [note, note],
    tags: [note],
  });
  const compact = await create.toJsonLd({
    format: "compact",
    ...options,
  }) as Record<string, unknown>;
  const objects = compact.object as Record<string, unknown>[];

  deepStrictEqual(objects.length, 2);
  deepStrictEqual(objects[0], securedNote);
  deepStrictEqual(objects[1], securedNote);
  deepStrictEqual(compact.tag, securedNote);
  // Each site gets its own copy rather than an alias of one object.
  ok(objects[0] !== objects[1]);
  ok(objects[0] !== compact.tag);
});

test("nested serialization embeds a retained representation at any depth", async () => {
  const announce = new Announce({
    id: new URL("https://example.com/activities/2"),
    actor: new URL("https://example.com/person"),
    object: new Create({
      id: new URL("https://example.com/activities/1"),
      actor: new URL("https://example.com/person"),
      object: retainedNote(),
    }),
  });
  const compact = await announce.toJsonLd({
    format: "compact",
    ...options,
  }) as Record<string, unknown>;
  const create = compact.object as Record<string, unknown>;

  deepStrictEqual(create.object, securedNote);
});

test("expanded serialization ignores a retained signed representation", async () => {
  const create = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/person"),
    object: retainedNote(),
  });
  const expanded = await create.toJsonLd({
    format: "expand",
    ...options,
  }) as Record<string, unknown>[];
  const objects = expanded[0][
    "https://www.w3.org/ns/activitystreams#object"
  ] as Record<string, unknown>[];

  // An expanded document has no compact representation to preserve, so the
  // child is expanded like any other object.
  deepStrictEqual(
    objects[0]["@id"],
    "https://example.com/notes/1",
  );
  deepStrictEqual(
    objects[0]["@type"],
    ["https://www.w3.org/ns/activitystreams#Note"],
  );
});

test("a context that could hide a placeholder turns retention off", async () => {
  const create = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/person"),
    object: retainedNote(),
  });
  const hostileContext = [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/data-integrity/v1",
    // An `@id` alias other than ActivityStreams' own `id` would make the
    // placeholder indistinguishable from an ordinary property value.
    { identifier: "@id" },
  ];
  const compact = await create.toJsonLd({
    format: "compact",
    context: hostileContext as unknown as (string | Record<string, string>)[],
    ...options,
  }) as Record<string, unknown>;
  const embedded = compact.object as Record<string, unknown>;

  // Rather than risk corrupting the document, Fedify falls back to ordinary
  // serialization, which reconstructs the child under the parent's context.
  deepStrictEqual(embedded["@context"], undefined);
  deepStrictEqual(embedded.proof, undefined);
});

test("a clone does not inherit a retained signed representation", async () => {
  const note = retainedNote();
  const create = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/person"),
    object: note.clone({ content: "Changed" }),
  });
  const compact = await create.toJsonLd({
    format: "compact",
    ...options,
  }) as Record<string, unknown>;
  const embedded = compact.object as Record<string, unknown>;

  deepStrictEqual(embedded["@context"], undefined);
  deepStrictEqual(embedded.content, "Changed");
});

test("every generated default context keeps placeholders recoverable", async () => {
  interface VocabClass {
    new (values: { id?: URL | null }): { toJsonLd(): Promise<unknown> };
    readonly typeId: URL;
  }
  const classes = Object.values(vocab).filter((value) =>
    typeof value === "function" &&
    (value as { typeId?: unknown }).typeId instanceof URL
  ) as unknown as VocabClass[];
  ok(classes.length > 0);
  for (const cls of classes) {
    const serialized = await new cls({
      id: new URL("https://example.com/objects/1"),
    }).toJsonLd() as Record<string, unknown>;
    ok(
      isMarkerSafeContext(serialized["@context"]),
      `${cls.typeId.href} has a default context that could hide a placeholder`,
    );
  }
});

test("a subtype that redefines an inherited property still embeds a retained representation", async () => {
  // `OrderedCollection` redefines `Collection.items` as `orderedItems`, so
  // the inherited encoder runs first and its output is then dropped and
  // re-encoded under the new key.
  const collection = new OrderedCollection({
    id: new URL("https://example.com/collections/1"),
    items: [retainedNote()],
  });
  const compact = await collection.toJsonLd(options) as Record<string, unknown>;

  deepStrictEqual(compact.items, undefined);
  deepStrictEqual(compact.orderedItems, [securedNote]);
});

test("a context that shadows the placeholder scheme turns retention off", async () => {
  const create = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/person"),
    object: retainedNote(),
  });
  const shadowingContext = [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/data-integrity/v1",
    // A term named `urn` makes a JSON-LD processor read the placeholder as a
    // compact IRI and reject it in safe mode.
    { urn: "https://example.com/ns#" },
  ];
  const compact = await create.toJsonLd({
    format: "compact",
    context: shadowingContext as unknown as (string | Record<string, string>)[],
    ...options,
  }) as Record<string, unknown>;
  const embedded = compact.object as Record<string, unknown>;

  deepStrictEqual(embedded["@context"], undefined);
  deepStrictEqual(embedded.proof, undefined);
});

test("a context that aliases `@id` indirectly turns retention off", async () => {
  const create = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/person"),
    object: retainedNote(),
  });
  const indirectContext = [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/data-integrity/v1",
    // `i` resolves through ActivityStreams' own `id`, so it aliases `@id`
    // without naming the keyword.
    { i: "id", object: "as:object" },
  ];
  const compact = await create.toJsonLd({
    format: "compact",
    context: indirectContext as unknown as (string | Record<string, string>)[],
    ...options,
  }) as Record<string, unknown>;
  const embedded = compact.object as Record<string, unknown>;

  deepStrictEqual(embedded["@context"], undefined);
  deepStrictEqual(embedded.proof, undefined);
});
