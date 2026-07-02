import { deepStrictEqual, ok } from "node:assert";
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

test("getJsonLdContext() finds nested contexts", () => {
  const context = { name: "https://example.com/ns#name" };
  deepStrictEqual(
    getJsonLdContext([{ type: "Note" }, { "@context": context }]),
    context,
  );
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
