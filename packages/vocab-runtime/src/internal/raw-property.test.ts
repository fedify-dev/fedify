import { deepStrictEqual, ok, rejects, strictEqual, throws } from "node:assert";
import { test } from "node:test";
import {
  createRawPropertyEncodingOptions,
  encodeNestedVocabularyValue,
  expandRawPropertyValue,
  parseRawPropertyIri,
  RAW_PROPERTY_PROTOCOL,
  readRawPropertyValues,
  retainRawProperties,
} from "./raw-property.ts";

test("parseRawPropertyIri() accepts absolute IRIs", () => {
  deepStrictEqual(
    parseRawPropertyIri("https://example.com/ns#prop", "f"),
    ["https://example.com/ns#prop"],
  );
  deepStrictEqual(
    parseRawPropertyIri(new URL("https://example.com/ns#prop"), "f"),
    ["https://example.com/ns#prop"],
  );
  deepStrictEqual(
    parseRawPropertyIri("HTTPS://Example.COM/ns#prop", "f"),
    ["HTTPS://Example.COM/ns#prop", "https://example.com/ns#prop"],
  );
  deepStrictEqual(
    parseRawPropertyIri("https://例え.jp/語#性質", "f")[0],
    "https://例え.jp/語#性質",
  );
  deepStrictEqual(parseRawPropertyIri("https://[::1]/ns#prop", "f"), [
    "https://[::1]/ns#prop",
  ]);
  deepStrictEqual(parseRawPropertyIri("urn:example:prop", "f"), [
    "urn:example:prop",
  ]);
});

test("parseRawPropertyIri() rejects what is not an absolute IRI", () => {
  for (
    const iri of [
      "",
      "@id",
      "@vocab",
      "_:b0",
      "content",
      "/content",
      "#content",
      "../content",
      "https:",
      "https://example.com/a b",
      " https://example.com/",
      "https://example.com/\n",
      "https://example.com/<a>",
      "https://example.com/%",
      "https://example.com/%2",
      "https://example.com/#a#b",
      "https://example.com/[a]",
      "https://example.com/\uD800",
    ]
  ) {
    throws(() => parseRawPropertyIri(iri, "f"), TypeError, JSON.stringify(iri));
  }
  throws(() => parseRawPropertyIri(null, "f"), TypeError);
  throws(() => parseRawPropertyIri(123, "f"), TypeError);
});

test("retainRawProperties() keeps only unknown properties", () => {
  const node = {
    "@id": "https://example.com/",
    "@type": ["https://example.com/Type"],
    "_:gateways": [{ "@value": "x" }],
    "https://example.com/known": [{ "@value": 1 }],
    "https://example.com/unknown": [{ "@value": { a: [1] }, "@type": "@json" }],
  };
  const retained = retainRawProperties(
    node,
    new Set(["https://example.com/known"]),
  );
  deepStrictEqual(retained, {
    "https://example.com/unknown": [{ "@value": { a: [1] }, "@type": "@json" }],
  });
  ok(Object.isFrozen(retained));
  ok(Object.isFrozen(retained!["https://example.com/unknown"]));
  ok(
    Object.isFrozen(
      (retained!["https://example.com/unknown"][0] as { "@value": object })[
        "@value"
      ],
    ),
  );
  // The retained values are independent of the input node:
  node["https://example.com/unknown"][0]["@value"].a.push(2);
  deepStrictEqual(retained!["https://example.com/unknown"], [
    { "@value": { a: [1] }, "@type": "@json" },
  ]);
  strictEqual(
    retainRawProperties(
      { "https://example.com/known": [] },
      new Set(["https://example.com/known"]),
    ),
    undefined,
  );
});

test("expandRawPropertyValue() normalizes encoded values", async () => {
  deepStrictEqual(
    await expandRawPropertyValue("https://example.com/p", [
      { "@value": "a" },
      { "@id": "https://example.com/" },
    ]),
    [{ "@value": "a" }, { "@id": "https://example.com/" }],
  );
  deepStrictEqual(
    await expandRawPropertyValue("https://example.com/p", {
      "@list": [{ "@value": 1 }],
    }),
    [{ "@list": [{ "@value": 1 }] }],
  );
});

test("encodeNestedVocabularyValue() rejects cycles, not shared objects", async () => {
  const a = {};
  const b = {};
  const stack = new Set<object>([a]);
  const options = createRawPropertyEncodingOptions(stack);
  // Shared object, visited twice in sequence:
  strictEqual(
    await encodeNestedVocabularyValue(options, b, () => Promise.resolve(1)),
    1,
  );
  strictEqual(
    await encodeNestedVocabularyValue(options, b, () => Promise.resolve(2)),
    2,
  );
  deepStrictEqual([...stack], [a]);
  // Cycle back to an object that is being encoded:
  await rejects(
    () =>
      encodeNestedVocabularyValue(
        options,
        b,
        () => encodeNestedVocabularyValue(options, a, () => Promise.resolve(3)),
      ),
    TypeError,
  );
  deepStrictEqual([...stack], [a]);
  // Without the raw property options, no tracking takes place:
  strictEqual(
    await encodeNestedVocabularyValue({}, a, () => Promise.resolve(4)),
    4,
  );
  // The tracking survives spreading, as toJsonLd() does with its options:
  await rejects(
    () =>
      encodeNestedVocabularyValue(
        { ...options, contextLoader: undefined },
        a,
        () => Promise.resolve(5),
      ),
    TypeError,
  );
});

test("readRawPropertyValues() dispatches through the protocol", async () => {
  const requests: unknown[] = [];
  const retained = Object.freeze([Object.freeze({ "@value": "x" })]);
  const object = {
    [RAW_PROPERTY_PROTOCOL](request: unknown) {
      requests.push(request);
      return Promise.resolve(retained);
    },
  };
  const values = await readRawPropertyValues(
    object,
    "HTTPS://example.com/p",
    "f",
  );
  deepStrictEqual(values, [{ "@value": "x" }]);
  ok(!Object.isFrozen(values[0]));
  strictEqual(requests.length, 1);
  deepStrictEqual(
    (requests[0] as { candidates: string[] }).candidates,
    ["HTTPS://example.com/p", "https://example.com/p"],
  );
  ok((requests[0] as { stack: Set<object> }).stack.has(object));
  await rejects(
    () => readRawPropertyValues({}, "https://example.com/p", "f"),
    TypeError,
  );
  await rejects(
    () => readRawPropertyValues(null, "https://example.com/p", "f"),
    TypeError,
  );
});
