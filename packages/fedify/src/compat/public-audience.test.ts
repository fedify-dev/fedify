import { test } from "@fedify/fixture";
import { Create, Note, PUBLIC_COLLECTION } from "@fedify/vocab";
import { assertEquals } from "@std/assert/assert-equals";
import { assertNotEquals } from "@std/assert/assert-not-equals";
import { normalizePublicAudience } from "./public-audience.ts";

const PUBLIC_URI = PUBLIC_COLLECTION.href;
const AS_CONTEXT = "https://www.w3.org/ns/activitystreams";

test("normalizePublicAudience() rewrites as:Public in addressing fields", async () => {
  const input = {
    "@context": AS_CONTEXT,
    type: "Note",
    id: "https://example.com/notes/1",
    to: "as:Public",
    cc: ["as:Public", "https://example.com/bob"],
  };
  const output = await normalizePublicAudience(input) as Record<
    string,
    unknown
  >;
  assertEquals(output.to, PUBLIC_URI);
  assertEquals(output.cc, [PUBLIC_URI, "https://example.com/bob"]);
});

test("normalizePublicAudience() normalises activities serialized by @fedify/vocab", async () => {
  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/alice"),
    object: new Note({
      id: new URL("https://example.com/notes/1"),
      content: "Hello, world!",
      tos: [PUBLIC_COLLECTION],
    }),
    tos: [PUBLIC_COLLECTION],
    ccs: [new URL("https://example.com/followers")],
  });
  const compact = await activity.toJsonLd({ format: "compact" }) as Record<
    string,
    unknown
  >;
  assertEquals(compact.to, "as:Public");
  const normalized = await normalizePublicAudience(compact) as Record<
    string,
    unknown
  >;
  assertEquals(normalized.to, PUBLIC_URI);
  const nestedObject = normalized.object as Record<string, unknown>;
  assertEquals(nestedObject.to, PUBLIC_URI);
});

test("normalizePublicAudience() is a no-op without the CURIE", async () => {
  const input = {
    "@context": AS_CONTEXT,
    type: "Note",
    id: "https://example.com/notes/3",
    to: PUBLIC_URI,
  };
  const output = await normalizePublicAudience(input);
  assertEquals(output, input);
});

test("normalizePublicAudience() leaves non-addressing fields untouched", async () => {
  const input = {
    "@context": AS_CONTEXT,
    type: "Note",
    id: "https://example.com/notes/4",
    name: "as:Public",
    to: "as:Public",
  };
  const output = await normalizePublicAudience(input) as Record<
    string,
    unknown
  >;
  assertEquals(output.name, "as:Public");
  assertEquals(output.to, PUBLIC_URI);
});

test("normalizePublicAudience() rewrites without canonicalization for string-only contexts", async () => {
  // A contextLoader that always throws ensures the canonicalization path
  // is not taken: if the implementation hit URDNA2015, it would fail.
  const rejecting: Parameters<typeof normalizePublicAudience>[1] = () => {
    throw new Error(
      "contextLoader should not be called for a string-only @context",
    );
  };
  const singleString = await normalizePublicAudience({
    "@context": AS_CONTEXT,
    type: "Note",
    id: "https://example.com/notes/fast1",
    to: "as:Public",
  }, rejecting) as Record<string, unknown>;
  assertEquals(singleString.to, PUBLIC_URI);
  const arrayOfStrings = await normalizePublicAudience({
    "@context": [AS_CONTEXT, "https://w3id.org/security/data-integrity/v1"],
    type: "Note",
    id: "https://example.com/notes/fast2",
    to: "as:Public",
  }, rejecting) as Record<string, unknown>;
  assertEquals(arrayOfStrings.to, PUBLIC_URI);
});

test("normalizePublicAudience() does not traverse prototype-polluted keys", async () => {
  const polluted = Object.create({ to: "as:Public" });
  polluted["@context"] = AS_CONTEXT;
  polluted.type = "Note";
  polluted.id = "https://example.com/notes/proto";
  const output = await normalizePublicAudience(polluted) as Record<
    string,
    unknown
  >;
  // The inherited `to` is not copied into the normalized record, so `to`
  // stays inherited from the prototype with its original CURIE value and
  // is not a rewritten own property.
  assertEquals(Object.hasOwn(output, "to"), false);
});

test("normalizePublicAudience() bails out when the rewrite changes semantics", async () => {
  const input = {
    "@context": {
      "as": "https://not-activitystreams.example/",
      "to": {
        "@id": "https://www.w3.org/ns/activitystreams#to",
        "@type": "@id",
      },
      "type": "@type",
      "id": "@id",
    },
    type: "https://www.w3.org/ns/activitystreams#Note",
    id: "https://example.com/notes/5",
    to: "as:Public",
  };
  const output = await normalizePublicAudience(input) as Record<
    string,
    unknown
  >;
  assertEquals(output.to, "as:Public");
  assertNotEquals(output.to, PUBLIC_URI);
});
