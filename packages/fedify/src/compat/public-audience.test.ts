import { test } from "@fedify/fixture";
import { Create, Note, PUBLIC_COLLECTION } from "@fedify/vocab";
import { preloadedContexts } from "@fedify/vocab-runtime";
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

test("normalizePublicAudience() rewrites without canonicalization for known-safe contexts", async () => {
  // A contextLoader that always throws ensures the canonicalization path
  // is not taken: if the implementation hit URDNA2015, it would fail.
  const rejecting: Parameters<typeof normalizePublicAudience>[1] = () => {
    throw new Error(
      "contextLoader should not be called for a known-safe @context",
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

test("normalizePublicAudience() falls back to canonicalization for unknown-URL contexts", async () => {
  // A remote string context URL not in Fedify's preloaded set might in
  // theory redefine `as:` or `Public`, so the fast path must not apply.
  // We count contextLoader invocations and assert the slow path runs.
  let loaderCalls = 0;
  const loader: Parameters<typeof normalizePublicAudience>[1] = (
    url: string,
  ) => {
    loaderCalls++;
    // Resolve every URL to the bundled ActivityStreams context so that
    // the equivalence check succeeds and the rewrite goes through.  In a
    // real document the unknown URL might bring its own term definitions;
    // here we just need the two canonical forms to match.
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: preloadedContexts[AS_CONTEXT],
    });
  };
  const output = await normalizePublicAudience({
    "@context": [AS_CONTEXT, "https://custom.example/ctx"],
    type: "Note",
    id: "https://example.com/notes/unknown",
    to: "as:Public",
  }, loader) as Record<string, unknown>;
  assertEquals(output.to, PUBLIC_URI);
  // canonicalization on both sides of the equivalence check exercises the
  // loader at least once.
  assertEquals(loaderCalls > 0, true);
});

test("normalizePublicAudience() leaves @context subtrees untouched", async () => {
  // A user-supplied inline @context could happen to contain a string value
  // that looks like `as:Public`; the helper must not rewrite inside term
  // definitions because addressing fields do not live there, and the
  // rewrite would change term semantics rather than addressing semantics.
  const input = {
    "@context": [
      AS_CONTEXT,
      { "customTerm": "as:Public" },
    ],
    type: "Note",
    id: "https://example.com/notes/context",
    to: PUBLIC_URI,
  };
  const output = await normalizePublicAudience(input) as Record<
    string,
    unknown
  >;
  const ctx = output["@context"] as unknown[];
  const inlineCtx = ctx[1] as Record<string, unknown>;
  assertEquals(inlineCtx.customTerm, "as:Public");
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

test("normalizePublicAudience() bails out on nested @context that redefines as:", async () => {
  // The top-level @context is the standard ActivityStreams URL, so the
  // fast-path would previously have rewritten every `to` under the
  // document.  The nested object's inline @context, however, remaps the
  // `as:` prefix to a different namespace, which means `as:Public` inside
  // that subtree refers to a different IRI than the one we would expand
  // it to.  The rewrite must bail out rather than silently change the
  // nested value.
  const input = {
    "@context": AS_CONTEXT,
    type: "Create",
    id: "https://example.com/activities/nested",
    actor: "https://example.com/alice",
    to: "as:Public",
    object: {
      "@context": {
        "as": "https://not-activitystreams.example/",
      },
      type: "https://www.w3.org/ns/activitystreams#Note",
      id: "https://example.com/objects/nested",
      to: "as:Public",
    },
  };
  const output = await normalizePublicAudience(input) as Record<
    string,
    unknown
  >;
  assertEquals(output.to, "as:Public");
  const nested = output.object as Record<string, unknown>;
  assertEquals(nested.to, "as:Public");
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
