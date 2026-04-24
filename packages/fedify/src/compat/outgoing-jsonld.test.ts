import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create, Document, Note, PUBLIC_COLLECTION } from "@fedify/vocab";
import { assertEquals } from "@std/assert/assert-equals";
import { assertStrictEquals } from "@std/assert/assert-strict-equals";
import {
  normalizeAttachmentArrays,
  normalizeOutgoingActivityJsonLd,
} from "./outgoing-jsonld.ts";

test("normalizeAttachmentArrays() wraps scalar attachments", async () => {
  const input = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    object: {
      type: "Note",
      attachment: {
        type: "Document",
        mediaType: "image/png",
        url: "https://example.com/image.png",
      },
    },
  };
  const output = await normalizeAttachmentArrays(input) as Record<
    string,
    unknown
  >;
  const object = output.object as Record<string, unknown>;
  assertEquals(object.attachment, [
    {
      type: "Document",
      mediaType: "image/png",
      url: "https://example.com/image.png",
    },
  ]);
});

test("normalizeAttachmentArrays() skips canonicalization for known-safe contexts", async () => {
  const input = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
    type: "Note",
    attachment: {
      type: "Document",
      mediaType: "image/png",
      url: "https://example.com/image.png",
    },
  };
  const output = await normalizeAttachmentArrays(input, () => {
    throw new Error("context loader should not be called");
  }) as Record<string, unknown>;
  assertEquals(output.attachment, [
    {
      type: "Document",
      mediaType: "image/png",
      url: "https://example.com/image.png",
    },
  ]);
});

test("normalizeAttachmentArrays() does not wrap JSON-LD list objects", async () => {
  const attachment = {
    "@list": [
      { type: "Document", url: "https://example.com/image.png" },
    ],
  };
  const input = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    attachment,
  };
  const output = await normalizeAttachmentArrays(input, () => {
    throw new Error("context loader should not be called");
  }) as Record<string, unknown>;
  assertEquals(output.attachment, attachment);
});

test("normalizeAttachmentArrays() does not traverse JSON-LD value payloads", async () => {
  const input = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    attachment: { type: "Document" },
    content: {
      "@type": "@json",
      "@value": {
        "@context": {
          attachment: "https://example.com/custom-attachment",
        },
        attachment: "https://example.com/metadata",
      },
    },
  };
  const output = await normalizeAttachmentArrays(input, () => {
    throw new Error("context loader should not be called");
  }) as Record<string, unknown>;
  assertEquals(output.attachment, [{ type: "Document" }]);
  assertEquals(output.content, {
    "@type": "@json",
    "@value": {
      "@context": {
        attachment: "https://example.com/custom-attachment",
      },
      attachment: "https://example.com/metadata",
    },
  });
});

test("normalizeAttachmentArrays() leaves attachment arrays unchanged", async () => {
  const attachment = [
    {
      type: "Document",
      mediaType: "image/png",
      url: "https://example.com/image.png",
    },
  ];
  const input = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    attachment,
  };
  const output = await normalizeAttachmentArrays(input) as Record<
    string,
    unknown
  >;
  assertEquals(output.attachment, attachment);
});

test("normalizeAttachmentArrays() leaves documents without attachments unchanged", async () => {
  const input = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    content: "Hello",
  };
  assertEquals(await normalizeAttachmentArrays(input), input);
});

test("normalizeAttachmentArrays() leaves @context subtrees untouched", async () => {
  const input = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      { attachment: "https://example.com/custom-attachment" },
    ],
    type: "Note",
    attachment: "https://example.com/attachment",
  };
  const output = await normalizeAttachmentArrays(input) as Record<
    string,
    unknown
  >;
  const context = output["@context"] as unknown[];
  assertEquals(context[1], {
    attachment: "https://example.com/custom-attachment",
  });
  assertEquals(output.attachment, ["https://example.com/attachment"]);
});

test("normalizeAttachmentArrays() bails out when wrapping changes semantics", async () => {
  const input = {
    "@context": {
      attachment: {
        "@id": "https://example.com/custom-attachment",
        "@type": "@json",
      },
    },
    attachment: {
      custom: true,
    },
  };
  const output = await normalizeAttachmentArrays(input) as Record<
    string,
    unknown
  >;
  assertEquals(output.attachment, { custom: true });
});

test("normalizeAttachmentArrays() does not poison the global prototype via a __proto__ key", async () => {
  const input = JSON.parse(`{
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Note",
    "attachment": { "type": "Document" },
    "__proto__": { "polluted": true }
  }`);
  await normalizeAttachmentArrays(input);
  assertEquals(
    (Object.prototype as Record<string, unknown>).polluted,
    undefined,
  );
});

test("normalizeAttachmentArrays() stops before blowing the stack on pathological nesting", async () => {
  let deep: Record<string, unknown> = { attachment: { type: "Document" } };
  for (let i = 0; i < 256; i++) deep = { object: deep };
  const input = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    object: deep,
  };
  const output = await normalizeAttachmentArrays(input);
  assertStrictEquals(output, input);
});

test("normalizeAttachmentArrays() skips canonicalization for pathological nesting", async () => {
  let deep: Record<string, unknown> = { type: "Note" };
  for (let i = 0; i < 256; i++) deep = { object: deep };
  const input = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://example.com/context",
    ],
    type: "Note",
    attachment: { type: "Document" },
    object: deep,
  };
  const output = await normalizeAttachmentArrays(input, () => {
    throw new Error("context loader should not be called");
  }) as Record<string, unknown>;
  assertEquals(output.attachment, { type: "Document" });
});

test("normalizeOutgoingActivityJsonLd() applies outgoing JSON-LD workarounds", async () => {
  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/alice"),
    object: new Note({
      id: new URL("https://example.com/notes/1"),
      tos: [PUBLIC_COLLECTION],
      attachments: [
        new Document({
          mediaType: "image/png",
          url: new URL("https://example.com/image.png"),
        }),
      ],
    }),
    tos: [PUBLIC_COLLECTION],
  });
  const compact = await activity.toJsonLd({ format: "compact" }) as Record<
    string,
    unknown
  >;
  assertEquals(compact.to, "as:Public");
  const compactObject = compact.object as Record<string, unknown>;
  assertEquals(Array.isArray(compactObject.attachment), false);

  const normalized = await normalizeOutgoingActivityJsonLd(
    compact,
    mockDocumentLoader,
  ) as Record<string, unknown>;
  assertEquals(normalized.to, PUBLIC_COLLECTION.href);
  const normalizedObject = normalized.object as Record<string, unknown>;
  assertEquals(Array.isArray(normalizedObject.attachment), true);
});
