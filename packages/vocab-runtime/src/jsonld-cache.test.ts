import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";
import {
  compactJsonLdCache,
  getJsonLdContext,
  isTrustedIriOrigin,
  normalizeJsonLdIris,
} from "./internal/jsonld-cache.ts";
import jsonld from "./jsonld.ts";
import { parseIri } from "./url.ts";

test("isTrustedIriOrigin() trusts same portable IRI origins", () => {
  ok(isTrustedIriOrigin(
    {},
    parseIri("ap://did:key:z6Mkabc/actor"),
    parseIri("ap+ef61://did:key:z6Mkabc/outbox"),
  ));
  ok(
    !isTrustedIriOrigin(
      {},
      parseIri("ap://did:key:z6Mkabc/actor"),
      parseIri("ap://did:key:z6Mkdef/outbox"),
    ),
  );
  ok(isTrustedIriOrigin(
    { crossOrigin: "trust" },
    parseIri("ap://did:key:z6Mkabc/actor"),
    parseIri("ap://did:key:z6Mkdef/outbox"),
  ));
});

test("normalizeJsonLdIris() normalizes selected JSON-LD IRI positions", () => {
  const iriKeys = new Set(["@id", "https://example.com/ns#ref"]);
  const value = {
    "@id": "ap://did:key:z6Mkabc/object",
    "https://example.com/ns#ref": [
      { "@value": "ap://did:key:z6Mkabc/ref" },
    ],
    "https://example.com/ns#text": [
      { "@value": "ap://did:key:z6Mkabc/not-an-iri-position" },
    ],
  };

  deepStrictEqual(normalizeJsonLdIris(value, iriKeys), {
    "@id": "ap+ef61://did:key:z6Mkabc/object",
    "https://example.com/ns#ref": [
      { "@value": "ap+ef61://did:key:z6Mkabc/ref" },
    ],
    "https://example.com/ns#text": [
      { "@value": "ap://did:key:z6Mkabc/not-an-iri-position" },
    ],
  });
});

test("normalizeJsonLdIris() defines prototype-like keys safely", () => {
  const iriKeys = new Set(["__proto__"]);
  const value: Record<string, unknown> = {};
  globalThis.Object.defineProperty(value, "__proto__", {
    value: "ap://did:key:z6Mkabc/object",
    enumerable: true,
    configurable: true,
    writable: true,
  });

  const normalized = normalizeJsonLdIris(value, iriKeys) as Record<
    string,
    unknown
  >;

  strictEqual(
    globalThis.Object.getOwnPropertyDescriptor(normalized, "__proto__")?.value,
    "ap+ef61://did:key:z6Mkabc/object",
  );
  strictEqual(globalThis.Object.getPrototypeOf(normalized), Object.prototype);
});

test("getJsonLdContext() finds nested contexts", () => {
  const context = { name: "https://example.com/ns#name" };
  deepStrictEqual(
    getJsonLdContext([{ type: "Note" }, { "@context": context }]),
    context,
  );
});

test("compactJsonLdCache() preserves no-context object shape", async () => {
  const original = {
    "@id": "ap://did:key:z6Mkabc/objects/1",
    "@type": ["https://www.w3.org/ns/activitystreams#Note"],
    "https://www.w3.org/ns/activitystreams#attributedTo": [
      { "@id": "ap://did:key:z6Mkabc/actor" },
    ],
    "https://www.w3.org/ns/activitystreams#content": [
      { "@value": "No-context object shape should stay cached." },
    ],
  };
  const expanded = await jsonld.expand(original);
  const normalized = normalizeJsonLdIris(
    expanded,
    new Set([
      "@id",
      "https://www.w3.org/ns/activitystreams#attributedTo",
    ]),
  );

  deepStrictEqual(await compactJsonLdCache(normalized, original), {
    "@id": "ap+ef61://did:key:z6Mkabc/objects/1",
    "@type": ["https://www.w3.org/ns/activitystreams#Note"],
    "https://www.w3.org/ns/activitystreams#attributedTo": [
      { "@id": "ap+ef61://did:key:z6Mkabc/actor" },
    ],
    "https://www.w3.org/ns/activitystreams#content": [
      { "@value": "No-context object shape should stay cached." },
    ],
  });
});

test("compactJsonLdCache() defines no-context prototype-like keys safely", async () => {
  const original: Record<string, unknown> = {
    "@id": "ap://did:key:z6Mkabc/objects/1",
  };
  globalThis.Object.defineProperty(original, "__proto__", {
    value: "ap://did:key:z6Mkabc/proto",
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const normalized: Record<string, unknown> = {
    "@id": "ap+ef61://did:key:z6Mkabc/objects/1",
  };
  globalThis.Object.defineProperty(normalized, "__proto__", {
    value: "ap+ef61://did:key:z6Mkabc/proto",
    enumerable: true,
    configurable: true,
    writable: true,
  });

  const compacted = await compactJsonLdCache([normalized], original) as Record<
    string,
    unknown
  >;

  strictEqual(
    globalThis.Object.getOwnPropertyDescriptor(compacted, "__proto__")?.value,
    "ap+ef61://did:key:z6Mkabc/proto",
  );
  strictEqual(globalThis.Object.getPrototypeOf(compacted), Object.prototype);
});

test("compactJsonLdCache() preserves nested unmapped terms", async () => {
  const context = {
    as: "https://www.w3.org/ns/activitystreams#",
    id: "@id",
    type: "@type",
    attachment: { "@id": "as:attachment" },
    name: "as:name",
  };
  const original = {
    "@context": context,
    type: "as:Note",
    id: "ap://did:key:z6Mkabc/objects/1",
    attachment: {
      type: "as:Object",
      name: "Attachment with an unmapped extension.",
      extra: "This nested unmapped property should stay cached.",
    },
  };
  const expanded = await jsonld.expand(original);
  const normalized = normalizeJsonLdIris(expanded, new Set(["@id"]));

  deepStrictEqual(await compactJsonLdCache(normalized, original), {
    "@context": context,
    type: "as:Note",
    id: "ap+ef61://did:key:z6Mkabc/objects/1",
    attachment: {
      type: "as:Object",
      name: "Attachment with an unmapped extension.",
      extra: "This nested unmapped property should stay cached.",
    },
  });
});

test("compactJsonLdCache() reuses unchanged unmapped values", async () => {
  const context = {
    as: "https://www.w3.org/ns/activitystreams#",
    id: "@id",
    type: "@type",
    attachment: { "@id": "as:attachment" },
    name: "as:name",
  };
  const extra = { source: "unchanged nested extension" };
  const rootExtra = { source: "unchanged root extension" };
  const original = {
    "@context": context,
    type: "as:Note",
    id: "ap://did:key:z6Mkabc/objects/1",
    rootExtra,
    attachment: {
      type: "as:Object",
      name: "Attachment with an unmapped extension.",
      extra,
    },
  };
  const expanded = await jsonld.expand(original);
  const normalized = normalizeJsonLdIris(expanded, new Set(["@id"]));
  const compacted = await compactJsonLdCache(normalized, original) as {
    rootExtra: unknown;
    attachment: { extra: unknown };
  };

  strictEqual(compacted.rootExtra, rootExtra);
  strictEqual(compacted.attachment.extra, extra);
});

test("compactJsonLdCache() defines prototype-like unmapped keys safely", async () => {
  const context = {
    id: "@id",
    type: "@type",
  };
  const protoValue = { source: "own __proto__ extension" };
  const original: Record<string, unknown> = {
    "@context": context,
    type: "https://example.com/ns#Object",
    id: "ap://did:key:z6Mkabc/objects/1",
  };
  globalThis.Object.defineProperty(original, "__proto__", {
    value: protoValue,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const expanded = await jsonld.expand(original);
  const normalized = normalizeJsonLdIris(expanded, new Set(["@id"]));
  const compacted = await compactJsonLdCache(normalized, original) as Record<
    string,
    unknown
  >;

  strictEqual(
    globalThis.Object.getOwnPropertyDescriptor(compacted, "__proto__")?.value,
    protoValue,
  );
  strictEqual(globalThis.Object.getPrototypeOf(compacted), Object.prototype);
});

test("compactJsonLdCache() checks prototype-like aliases safely", async () => {
  const context: Record<string, unknown> = {
    ex: "https://example.com/ns#",
    id: "@id",
    represented: "ex:represented",
  };
  globalThis.Object.defineProperty(context, "__proto__", {
    value: "ex:represented",
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const original: Record<string, unknown> = {
    "@context": context,
    id: "ap://did:key:z6Mkabc/objects/1",
    represented: "Compacted term already present.",
  };
  globalThis.Object.defineProperty(original, "__proto__", {
    value: "Alias represented by the compacted term.",
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const expanded = await jsonld.expand(original);
  const normalized = normalizeJsonLdIris(expanded, new Set(["@id"]));
  const compacted = await compactJsonLdCache(normalized, original) as Record<
    string,
    unknown
  >;

  const protoDescriptor = globalThis.Object.getOwnPropertyDescriptor(
    compacted,
    "__proto__",
  );
  ok(
    protoDescriptor?.value === "Alias represented by the compacted term." ||
      Array.isArray(protoDescriptor?.value) &&
        protoDescriptor.value.includes(
          "Alias represented by the compacted term.",
        ),
  );
  strictEqual(protoDescriptor?.enumerable, true);
  strictEqual(compacted.id, "ap+ef61://did:key:z6Mkabc/objects/1");
  strictEqual(
    globalThis.Object.getPrototypeOf(compacted),
    Object.prototype,
  );
});

test("compactJsonLdCache() preserves nested contexts", async () => {
  const context = {
    as: "https://www.w3.org/ns/activitystreams#",
    id: "@id",
    type: "@type",
    attachment: { "@id": "as:attachment" },
    name: "as:name",
  };
  const nestedContext = {
    id: "@id",
    type: "@type",
    title: "https://example.com/ns#title",
  };
  const original = {
    "@context": context,
    type: "as:Note",
    id: "ap://did:key:z6Mkabc/objects/1",
    attachment: {
      "@context": nestedContext,
      type: "as:Object",
      title: "Nested title.",
    },
  };
  const expanded = await jsonld.expand(original);
  const normalized = normalizeJsonLdIris(expanded, new Set(["@id"]));

  deepStrictEqual(await compactJsonLdCache(normalized, original), {
    "@context": context,
    type: "as:Note",
    id: "ap+ef61://did:key:z6Mkabc/objects/1",
    attachment: {
      "@context": nestedContext,
      type: "as:Object",
      "https://example.com/ns#title": "Nested title.",
    },
  });
});

test("compactJsonLdCache() does not re-add represented nested aliases", async () => {
  const context = {
    as: "https://www.w3.org/ns/activitystreams#",
    id: "@id",
    type: "@type",
    attachment: { "@id": "as:attachment" },
    actor: { "@id": "as:actor", "@type": "@id" },
  };
  const nestedContext = {
    id: "@id",
    type: "@type",
    actorRef: { "@id": "as:actor", "@type": "@id" },
  };
  const original = {
    "@context": context,
    type: "as:Note",
    id: "ap://did:key:z6Mkabc/objects/1",
    attachment: {
      "@context": nestedContext,
      type: "as:Object",
      actorRef: "ap://did:key:z6Mkabc/actor",
    },
  };
  const expanded = await jsonld.expand(original);
  const normalized = normalizeJsonLdIris(
    expanded,
    new Set(["@id", "https://www.w3.org/ns/activitystreams#actor"]),
  );

  deepStrictEqual(await compactJsonLdCache(normalized, original), {
    "@context": context,
    type: "as:Note",
    id: "ap+ef61://did:key:z6Mkabc/objects/1",
    attachment: {
      "@context": nestedContext,
      type: "as:Object",
      actor: "ap+ef61://did:key:z6Mkabc/actor",
    },
  });
});

test("compactJsonLdCache() does not confuse dummy marker prefixes", async () => {
  const context = {
    ex: "https://example.com/ns#",
    id: "@id",
    represented: "ex:represented",
    key10: "ex:represented",
  };
  const original = {
    "@context": context,
    id: "ap://did:key:z6Mkabc/objects/1",
    represented: "Compacted term already present.",
    key0: "Extension 0",
    key1: "Extension 1",
    key2: "Extension 2",
    key3: "Extension 3",
    key4: "Extension 4",
    key5: "Extension 5",
    key6: "Extension 6",
    key7: "Extension 7",
    key8: "Extension 8",
    key9: "Extension 9",
    key10: "Alias represented by the compacted term.",
  };
  const expanded = await jsonld.expand(original);
  const normalized = normalizeJsonLdIris(expanded, new Set(["@id"]));

  deepStrictEqual(await compactJsonLdCache(normalized, original), {
    "@context": context,
    id: "ap+ef61://did:key:z6Mkabc/objects/1",
    key0: "Extension 0",
    key1: "Extension 1",
    key2: "Extension 2",
    key3: "Extension 3",
    key4: "Extension 4",
    key5: "Extension 5",
    key6: "Extension 6",
    key7: "Extension 7",
    key8: "Extension 8",
    key9: "Extension 9",
    key10: [
      "Alias represented by the compacted term.",
      "Compacted term already present.",
    ],
  });
});
