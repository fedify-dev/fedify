import { mockDocumentLoader, test } from "@fedify/fixture";
import { LanguageString, parseDecimal } from "@fedify/vocab-runtime";
import {
  deepStrictEqual,
  notStrictEqual,
  ok,
  rejects,
  strictEqual,
} from "node:assert/strict";
import {
  CollectionPage,
  Create,
  DataIntegrityProof,
  Endpoints,
  getRawPropertyValues,
  Image,
  Measure,
  Multikey,
  Note,
  OrderedCollection,
  OrderedCollectionPage,
  Person,
  Place,
  type RawPropertyValue,
  withRawProperties,
  withRawProperty,
} from "./mod.ts";

const AS = "https://www.w3.org/ns/activitystreams";
const EXT = "https://example.com/ns#extension";
const OTHER = "https://example.com/ns#other";
const SEC = "https://w3id.org/security#";
const DC_LICENSE = "http://purl.org/dc/terms/license";
const SCHEMA_LICENSE = "https://schema.org/license";
const options = { contextLoader: mockDocumentLoader };

test("withRawProperty() rejects processor-incompatible keys and identifiers", async () => {
  for (const node of [
    { "https://example.com/\u00a0x": [{ "@value": 1 }] },
    { "https://example.com/\u2003x": [] },
    { "@id": "@foo", [OTHER]: [] },
  ])
    for (const value of [node, { "@included": [node] }])
      await rejects(withRawProperty(new Note({}), EXT, [value]), TypeError);
});

test("withRawProperty() preserves relative at-identifiers and Unicode node types", async () => {
  for (const value of [
    { "@id": "@alice/post" },
    { "@id": "@alice#post" },
    { "@id": "@alice-123" },
    { "@type": ["https://example.com/\u00a0Type"] },
  ]) {
    const written = await withRawProperty(new Note({}), EXT, [value]);
    deepStrictEqual((await expanded(written))[EXT], [value]);
    await written.toJsonLd({ ...options, format: "compact" });
  }
});

test("withRawProperty() keeps raw relative IDs exact while output normalizes them", async () => {
  for (const [input, expandedId, compactId] of [
    ["", "/", "/"],
    [".", "/", "/"],
    ["../up", "up", "up"],
    ["./a", "a", "a"],
    ["a/../b", "b", "b"],
    ["//host/x", "//host/x", "x"],
    ["a/b", "a/b", "a/b"],
    ["/abs", "/abs", "/abs"],
    ["?q=1", "?q=1", "?q=1"],
    ["#frag", "#frag", "#frag"],
    ["@alice/post", "@alice/post", "@alice/post"],
    ["@alice#post", "@alice#post", "@alice#post"],
    ["@alice-123", "@alice-123", "@alice-123"],
  ]) {
    for (const source of [
      new Note({}),
      new Note({ id: new URL("https://example.com/notes/publication") }),
    ]) {
      const values = [{ "@id": input }];
      const written = await withRawProperty(source, EXT, values);
      deepStrictEqual(await getRawPropertyValues(written, EXT), values);
      deepStrictEqual((await expanded(written))[EXT], [{ "@id": expandedId }]);
      for (const serializationOptions of [
        options,
        { ...options, format: "compact" as const },
      ]) {
        const compacted = await written.toJsonLd(serializationOptions);
        const reparsed = await Note.fromJsonLd(compacted, options);
        deepStrictEqual(await getRawPropertyValues(reparsed, EXT), [
          { "@id": compactId },
        ]);
        deepStrictEqual(await getRawPropertyValues(written, EXT), values);
      }
      deepStrictEqual(await getRawPropertyValues(source, EXT), []);
    }
  }
});

test("withRawProperty() validates included subjects after empty metadata removal", async () => {
  const reference = { "@id": "https://example.com/reference" };
  for (const emptyMembers of [
    { "@type": [] },
    { "@reverse": {} },
    { "@type": [], "@reverse": {} },
  ])
    await rejects(
      withRawProperty(new Note({}), EXT, [
        { "@included": [{ ...reference, ...emptyMembers }] },
      ]),
      TypeError,
    );
  for (const survivingMembers of [
    { [OTHER]: [] },
    { "@graph": [] },
    { "@included": [] },
  ]) {
    const values = [{ "@included": [{ ...reference, ...survivingMembers }] }];
    const written = await withRawProperty(new Note({}), EXT, values);
    deepStrictEqual((await expanded(written))[EXT], values);
  }
});

async function expanded(object: Note | Create | OrderedCollection) {
  const values = (await object.toJsonLd({
    ...options,
    format: "expand",
  })) as Record<string, unknown>[];
  strictEqual(values.length, 1);
  return values[0];
}

test("received child documents stay isolated when input objects are shared", async () => {
  const actor = {
    "@context": AS,
    id: "https://example.com/alice",
    type: "Person",
    name: "Alice",
  };
  const create = await Create.fromJsonLd(
    {
      "@context": AS,
      id: "https://example.com/create",
      type: "Create",
      actor,
      object: {
        "@context": AS,
        id: "https://example.com/note",
        type: "Note",
        attributedTo: actor,
      },
    },
    options,
  );
  const first = await create.getActor();
  const note = await create.getObject();
  ok(first instanceof Person && note instanceof Note);
  const second = await note.getAttribution();
  ok(second instanceof Person);
  notStrictEqual(first, second);
  const firstDocument = (await first.toJsonLd()) as Record<string, unknown>;
  const secondDocument = (await second.toJsonLd()) as Record<string, unknown>;
  notStrictEqual(firstDocument, secondDocument);
  firstDocument.name = "Mutated";
  strictEqual(secondDocument.name, "Alice");
  strictEqual(
    ((await second.toJsonLd()) as Record<string, unknown>).name,
    "Alice",
  );
  strictEqual(actor.name, "Alice");
});

test("withRawProperty() publishes an extension in every output format", async () => {
  for (const source of [
    new Note({ content: "Original" }),
    await Note.fromJsonLd({
      "@context": AS,
      type: "Note",
      content: "Original",
    }),
  ]) {
    const before = await source.toJsonLd(options);
    const values = [{ "@id": "https://example.com/data/1" }];
    const written = await withRawProperty(source, EXT, values);
    notStrictEqual(written, source);
    strictEqual(written.content, "Original");
    deepStrictEqual(await getRawPropertyValues(source, EXT), []);
    deepStrictEqual(await source.toJsonLd(options), before);
    deepStrictEqual(await getRawPropertyValues(written, EXT), values);
    deepStrictEqual((await expanded(written))[EXT], values);
    const compact = (await written.toJsonLd(options)) as Record<
      string,
      unknown
    >;
    ok(EXT in compact);
    const custom = (await written.toJsonLd({
      ...options,
      format: "compact",
      context: [AS, { extension: EXT }],
    })) as Record<string, unknown>;
    strictEqual("extension" in custom, true);
    for (const json of [compact, custom]) {
      const reparsed = await Note.fromJsonLd(json, options);
      deepStrictEqual(await getRawPropertyValues(reparsed, EXT), values);
    }
    const embedded = await expanded(new Create({ object: written }));
    const [child] = embedded[`${AS}#object`] as Record<string, unknown>[];
    deepStrictEqual(child[EXT], values);
  }
});

test("withRawProperty() publishes only explicitly written incoming extensions", async () => {
  const source = await Note.fromJsonLd({
    "@context": AS,
    type: "Note",
    [EXT]: { "@value": "received" },
    [OTHER]: { "@value": "private" },
    [`${SEC}signature`]: { "@value": "legacy signature" },
  });
  const values = await getRawPropertyValues(source, EXT);
  const written = await withRawProperty(source, EXT, values);
  const json = await expanded(written);
  deepStrictEqual(json[EXT], values);
  strictEqual(OTHER in json, false);
  strictEqual(`${SEC}signature` in json, false);
  deepStrictEqual(await getRawPropertyValues(written, OTHER), [
    { "@value": "private" },
  ]);
  const typed = await withRawProperty(source, `${AS}#content`, [
    { "@value": "Edited" },
  ]);
  const typedJson = await expanded(typed);
  strictEqual(EXT in typedJson, false);
  strictEqual(OTHER in typedJson, false);
  strictEqual(`${SEC}signature` in typedJson, false);
  const next = await withRawProperty(written, OTHER, [
    { "@value": "authored" },
  ]);
  deepStrictEqual((await expanded(next))[EXT], values);
  deepStrictEqual((await expanded(next))[OTHER], [{ "@value": "authored" }]);
});

test("withRawProperty() round-trips expanded literals, lists, nodes, graphs, and JSON", async () => {
  const values = [
    { "@value": "Hello", "@language": "en" },
    { "@value": "12.50", "@type": "http://www.w3.org/2001/XMLSchema#decimal" },
    { "@id": "https://example.com/reference" },
    { "@list": [{ "@value": 1 }, { "@value": 2 }] },
    { "@type": [`${AS}#Note`], [`${AS}#content`]: [{ "@value": "Embedded" }] },
    {
      "@graph": [
        {
          "@id": "https://example.com/graph-node",
          [OTHER]: [{ "@value": "Graph value" }],
        },
      ],
    },
    { "@type": "@json", "@value": { nested: [false, null, 0] } },
  ];
  const written = await withRawProperty(new Note({}), EXT, values);
  deepStrictEqual(await getRawPropertyValues(written, EXT), values);
  deepStrictEqual((await expanded(written))[EXT], values);
  const reparsed = await Note.fromJsonLd(
    await written.toJsonLd(options),
    options,
  );
  deepStrictEqual(await getRawPropertyValues(reparsed, EXT), values);
});

test("withRawProperty() round-trips nested lists returned by raw reads", async () => {
  const received = await Note.fromJsonLd(
    {
      "@context": AS,
      type: "Note",
      [EXT]: {
        "@list": [{ "@list": ["one", "two"] }, { "@list": ["three"] }],
      },
    },
    options,
  );
  const values = await getRawPropertyValues(received, EXT);
  deepStrictEqual(values, [
    {
      "@list": [
        { "@list": [{ "@value": "one" }, { "@value": "two" }] },
        { "@list": [{ "@value": "three" }] },
      ],
    },
  ]);
  const written = await withRawProperty(new Note({}), EXT, values);
  deepStrictEqual(await getRawPropertyValues(written, EXT), values);
  const expandedJson = await expanded(written);
  deepStrictEqual(expandedJson[EXT], values);
  for (const json of [expandedJson, await written.toJsonLd(options)]) {
    const reparsed = await Note.fromJsonLd(json, options);
    deepStrictEqual(await getRawPropertyValues(reparsed, EXT), values);
  }
});

test("withRawProperties() accepts records, maps, generators, and readonly tuples", async () => {
  const values = [{ "@value": "written" }] as const;
  const record = Object.freeze({ [EXT]: values });
  const tuples = Object.freeze([Object.freeze([EXT, values] as const)]);
  const map: ReadonlyMap<string | URL, readonly RawPropertyValue[]> = new Map([
    [new URL(EXT), values],
  ]);
  let traversals = 0;
  function* entries() {
    traversals++;
    yield [EXT, values] as const;
  }
  const source = new Note({ content: "Original" });
  for (const pending of [
    withRawProperties(source, record),
    withRawProperties(source, tuples),
    withRawProperties(source, map),
    withRawProperties(source, entries()),
  ]) {
    const written = await pending;
    deepStrictEqual(await getRawPropertyValues(written, EXT), values);
    strictEqual(written.content, "Original");
  }
  strictEqual(traversals, 1);
  deepStrictEqual(record, { [EXT]: values });
  deepStrictEqual(await getRawPropertyValues(source, EXT), []);
});

test("withRawProperty() removals return fresh objects and preserve absent keys", async () => {
  const source = await withRawProperties(new Note({ content: "Original" }), {
    [EXT]: [{ "@value": "extension" }],
    [OTHER]: [{ "@value": "other" }],
  });
  for (const removal of [[], null, undefined]) {
    const written = await withRawProperty(source, EXT, removal);
    notStrictEqual(written, source);
    deepStrictEqual(await getRawPropertyValues(written, EXT), []);
    strictEqual(EXT in (await expanded(written)), false);
    deepStrictEqual(await getRawPropertyValues(written, OTHER), [
      { "@value": "other" },
    ]);
    const typed = await withRawProperty(source, `${AS}#content`, removal);
    deepStrictEqual(typed.contents, []);
  }
  const absent = await withRawProperties(source, {});
  notStrictEqual(absent, source);
  deepStrictEqual(await getRawPropertyValues(absent, EXT), [
    { "@value": "extension" },
  ]);
  const ownUndefined = await withRawProperties(source, { [EXT]: undefined });
  deepStrictEqual(await getRawPropertyValues(ownUndefined, EXT), []);
  const missing = await withRawProperty(
    source,
    "https://example.com/missing",
    null,
  );
  notStrictEqual(missing, source);
  const equal = await withRawProperty(source, `${AS}#content`, [
    { "@value": "Original" },
  ]);
  notStrictEqual(equal, source);
  strictEqual(source.content, "Original");
  deepStrictEqual(await getRawPropertyValues(source, EXT), [
    { "@value": "extension" },
  ]);
});

test("withRawProperty() decodes known literals, dates, numbers, and aliases", async () => {
  const source = new Place({ content: "Original", accuracy: 1 });
  const written = await withRawProperties(source, {
    [`${AS}#content`]: [
      { "@value": "Hello", "@language": "en" },
      { "@value": "안녕", "@language": "ko" },
    ],
    [`${AS}#published`]: [
      {
        "@value": "2026-11-10T01:02:03Z",
        "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
      },
    ],
    [`${AS}#accuracy`]: [
      { "@value": 94.5, "@type": "http://www.w3.org/2001/XMLSchema#float" },
    ],
    [SCHEMA_LICENSE]: [
      { "@id": "https://creativecommons.org/licenses/by/4.0/" },
    ],
  });
  deepStrictEqual(written.contents, [
    new LanguageString("Hello", "en"),
    new LanguageString("안녕", "ko"),
  ]);
  strictEqual(written.published?.toString(), "2026-11-10T01:02:03Z");
  strictEqual(written.accuracy, 94.5);
  deepStrictEqual(written.licenses, [
    new URL("https://creativecommons.org/licenses/by/4.0/"),
  ]);
  deepStrictEqual(
    await getRawPropertyValues(written, SCHEMA_LICENSE),
    await getRawPropertyValues(written, DC_LICENSE),
  );
  strictEqual(source.content, "Original");
  strictEqual(source.accuracy, 1);
});

test("withRawProperty() keeps typed normalization of child types and string literals", async () => {
  const written = await withRawProperty(new Create({}), `${AS}#object`, [
    {
      "@type": [`${AS}#Note`, "https://example.com/ns#Custom"],
      [`${AS}#content`]: [
        {
          "@value": "5",
          "@type": "http://www.w3.org/2001/XMLSchema#integer",
        },
      ],
    },
  ]);
  const child = await written.getObject();
  ok(child instanceof Note);
  strictEqual(child.content, "5");
  const [raw] = await getRawPropertyValues(written, `${AS}#object`);
  deepStrictEqual((raw as Record<string, unknown>)["@type"], [`${AS}#Note`]);
  deepStrictEqual((raw as Record<string, unknown>)[`${AS}#content`], [
    { "@value": "5" },
  ]);
  const [serialized] = (await expanded(written))[`${AS}#object`] as Record<
    string,
    unknown
  >[];
  deepStrictEqual(serialized["@type"], [`${AS}#Note`]);
  deepStrictEqual(serialized[`${AS}#content`], [{ "@value": "5" }]);
});

test("withRawProperty() decodes typeless source and endpoint values returned by raw reads", async () => {
  const original = await Note.fromJsonLd(
    {
      "@context": AS,
      type: "Note",
      source: { content: "# Original", mediaType: "text/markdown" },
    },
    options,
  );
  const values = await getRawPropertyValues(original, `${AS}#source`);
  deepStrictEqual(values, [
    {
      [`${AS}#content`]: [{ "@value": "# Original" }],
      [`${AS}#mediaType`]: [{ "@value": "text/markdown" }],
    },
  ]);
  const written = await withRawProperty(new Note({}), `${AS}#source`, values);
  strictEqual(written.source?.content, "# Original");
  strictEqual(written.source?.mediaType, "text/markdown");
  deepStrictEqual(await getRawPropertyValues(written, `${AS}#source`), values);
  deepStrictEqual((await expanded(written))[`${AS}#source`], values);
  const person = new Person({
    endpoints: new Endpoints({
      sharedInbox: new URL("https://example.com/inbox"),
    }),
  });
  const endpointValues = await getRawPropertyValues(person, `${AS}#endpoints`);
  strictEqual(endpointValues.length, 1);
  strictEqual("@type" in endpointValues[0], false);
  const writtenPerson = await withRawProperty(
    new Person({}),
    `${AS}#endpoints`,
    endpointValues,
  );
  strictEqual(
    writtenPerson.endpoints?.sharedInbox?.href,
    "https://example.com/inbox",
  );
  deepStrictEqual(
    await getRawPropertyValues(writtenPerson, `${AS}#endpoints`),
    endpointValues,
  );
});

test("withRawProperty() uses declared nested license alias order", async () => {
  const ccLicense = "http://creativecommons.org/ns#license";
  const schema = [{ "@id": "https://example.com/schema-license" }];
  const cc = [{ "@id": "https://example.com/cc-license" }];
  const canonical = [{ "@id": "https://example.com/canonical-license" }];
  const aliases = [
    [SCHEMA_LICENSE, schema],
    [ccLicense, cc],
  ] as const;
  for (const orderedAliases of [aliases, [...aliases].reverse()]) {
    for (const canonicalPresent of [false, true]) {
      const node = {
        "@type": [`${AS}#Note`],
        ...Object.fromEntries(orderedAliases),
        ...(canonicalPresent ? { [DC_LICENSE]: canonical } : {}),
      };
      const ordinary = await Note.fromJsonLd(node, options);
      const written = await withRawProperty(new Create({}), `${AS}#object`, [
        node,
      ]);
      const child = await written.getObject();
      ok(child instanceof Note);
      const expected = canonicalPresent ? canonical : schema;
      for (const note of [ordinary, child]) {
        deepStrictEqual(
          note.licenses.map((license) => license.href),
          [expected[0]["@id"]],
        );
        deepStrictEqual(await getRawPropertyValues(note, DC_LICENSE), expected);
      }
    }
  }
});

test("withRawProperty() decodes lists and removes inherited collection items", async () => {
  const source = new OrderedCollection({
    items: [new Note({ content: "Old" })],
  });
  const values = [
    {
      "@list": [
        { "@type": [`${AS}#Note`], [`${AS}#content`]: [{ "@value": "First" }] },
        { "@id": "https://example.com/notes/2" },
      ],
    },
  ];
  const written = await withRawProperty(source, `${AS}#items`, values);
  deepStrictEqual(await getRawPropertyValues(written, `${AS}#items`), values);
  const first = await written
    .getItems({ crossOrigin: "trust" })
    [Symbol.asyncIterator]()
    .next();
  ok(first.value instanceof Note);
  strictEqual(first.value.content, "First");
  const removed = await withRawProperty(written, `${AS}#items`, []);
  deepStrictEqual(await Array.fromAsync(removed.getItems()), []);
  strictEqual(`${AS}#items` in (await expanded(removed)), false);
  const compact = (await removed.toJsonLd(options)) as Record<string, unknown>;
  strictEqual("items" in compact, false);
  strictEqual("orderedItems" in compact, false);
  const originalItem = (await Array.fromAsync(source.getItems()))[0];
  ok(originalItem instanceof Note);
  strictEqual(originalItem.content, "Old");
});

test("withRawProperty() rejects empty known containers and preserves unknown empty lists", async () => {
  const collection = new OrderedCollection({
    items: [new Note({ content: "Original" })],
  });
  const beforeItems = await getRawPropertyValues(collection, `${AS}#items`);
  const beforeCollection = await collection.toJsonLd(options);
  await rejects(
    withRawProperty(collection, `${AS}#items`, [{ "@list": [] }]),
    TypeError,
  );
  deepStrictEqual(
    await getRawPropertyValues(collection, `${AS}#items`),
    beforeItems,
  );
  deepStrictEqual(await collection.toJsonLd(options), beforeCollection);
  const note = new Note({
    proofs: [new DataIntegrityProof({ cryptosuite: "eddsa-jcs-2022" })],
  });
  const beforeProofs = await getRawPropertyValues(note, `${SEC}proof`);
  const beforeNote = await note.toJsonLd(options);
  await rejects(
    withRawProperty(note, `${SEC}proof`, [{ "@graph": [] }]),
    TypeError,
  );
  deepStrictEqual(
    await getRawPropertyValues(note, `${SEC}proof`),
    beforeProofs,
  );
  deepStrictEqual(await note.toJsonLd(options), beforeNote);
  const values = [{ "@list": [] }];
  const written = await withRawProperty(new Note({}), EXT, values);
  deepStrictEqual(await getRawPropertyValues(written, EXT), values);
  deepStrictEqual((await expanded(written))[EXT], values);
  const reparsed = await Note.fromJsonLd(
    await written.toJsonLd(options),
    options,
  );
  deepStrictEqual(await getRawPropertyValues(reparsed, EXT), values);
});

test("withRawProperty() rejects undeclared list and graph containers", async () => {
  const list = { "@list": [{ "@value": "first" }, { "@value": "second" }] };
  const original = new Note({ content: "Original" });
  const before = await original.toJsonLd(options);
  await rejects(withRawProperty(original, `${AS}#content`, [list]), TypeError);
  strictEqual(original.content, "Original");
  deepStrictEqual(await original.toJsonLd(options), before);
  const lenientNote = await Note.fromJsonLd(
    {
      "@type": [`${AS}#Note`],
      [`${AS}#content`]: [list],
    },
    options,
  );
  deepStrictEqual(lenientNote.contents, ["first", "second"]);
  const child = new Note({ content: "Original child" });
  const create = new Create({ object: child });
  const beforeCreate = await create.toJsonLd(options);
  const graph = {
    "@graph": [
      {
        "@type": [`${AS}#Note`],
        [`${AS}#content`]: [{ "@value": "Graph child" }],
      },
    ],
  };
  await rejects(withRawProperty(create, `${AS}#object`, [graph]), TypeError);
  strictEqual(await create.getObject(), child);
  deepStrictEqual(await create.toJsonLd(options), beforeCreate);
  const lenientCreate = await Create.fromJsonLd(
    {
      "@type": [`${AS}#Create`],
      [`${AS}#object`]: [graph],
    },
    options,
  );
  strictEqual((await lenientCreate.getObject())?.content, "Graph child");
});

test("withRawProperty() rejects scalar references with unrepresentable node properties", async () => {
  const source = new Note({
    licenses: [new URL("https://example.com/original-license")],
  });
  const before = await source.toJsonLd(options);
  await rejects(
    withRawProperty(source, DC_LICENSE, [
      {
        "@id": "https://example.com/new-license",
        [EXT]: [{ "@value": "must not disappear" }],
      },
    ]),
    TypeError,
  );
  deepStrictEqual(source.licenses, [
    new URL("https://example.com/original-license"),
  ]);
  deepStrictEqual(await source.toJsonLd(options), before);
});

test("withRawProperty() keeps decimal normalization and rejects invalid decimals", async () => {
  const iri =
    "http://www.ontology-of-units-of-measure.org/resource/om-2/hasNumericalValue";
  const source = new Measure({ numericalValue: parseDecimal("1") });
  const written = await withRawProperty(source, iri, [
    {
      "@value": "  +30.00  ",
      "@type": "http://www.w3.org/2001/XMLSchema#decimal",
    },
  ]);
  strictEqual(written.numericalValue, parseDecimal("+30.00"));
  deepStrictEqual(await getRawPropertyValues(written, iri), [
    { "@value": "+30.00", "@type": "http://www.w3.org/2001/XMLSchema#decimal" },
  ]);
  await rejects(
    withRawProperty(source, iri, [
      { "@value": "1e3", "@type": "http://www.w3.org/2001/XMLSchema#decimal" },
    ]),
  );
  strictEqual(source.numericalValue, parseDecimal("1"));
});

test("withRawProperty() decodes proof graphs and asynchronous keys", async () => {
  const proof = new DataIntegrityProof({
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: new URL("https://example.com/alice#key"),
    proofPurpose: "assertionMethod",
    proofValue: new TextEncoder().encode("proof"),
    created: Temporal.Instant.from("2026-11-10T00:00:00Z"),
  });
  const source = new Note({ proofs: [proof] });
  const values = await getRawPropertyValues(source, `${SEC}proof`);
  const written = await withRawProperty(new Note({}), `${SEC}proof`, values);
  const decodedProof = await written.getProof();
  ok(decodedProof instanceof DataIntegrityProof);
  strictEqual(decodedProof.cryptosuite, proof.cryptosuite);
  deepStrictEqual(await getRawPropertyValues(written, `${SEC}proof`), values);
  const pair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  ok("publicKey" in pair);
  const key = new Multikey({ publicKey: pair.publicKey });
  const keyValues = await getRawPropertyValues(key, `${SEC}publicKeyMultibase`);
  const copiedKey = await withRawProperty(
    new Multikey({}),
    `${SEC}publicKeyMultibase`,
    keyValues,
  );
  ok(copiedKey.publicKey != null);
  deepStrictEqual(
    new Uint8Array(await crypto.subtle.exportKey("raw", copiedKey.publicKey)),
    new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
  );
});

test("withRawProperty() normalizes preprocessed nodes and publishes their extensions", async () => {
  const written = await withRawProperty(new Note({}), `${AS}#icon`, [
    {
      "@type": [`${AS}#Link`],
      [`${AS}#href`]: [{ "@id": "https://example.com/icon.png" }],
      [`${AS}#mediaType`]: [{ "@value": "image/png" }],
      [EXT]: [{ "@value": "authored" }],
    },
  ]);
  const icon = await written.getIcon();
  ok(icon instanceof Image);
  strictEqual(icon.url?.href, "https://example.com/icon.png");
  strictEqual(icon.mediaType, "image/png");
  deepStrictEqual(await getRawPropertyValues(icon, EXT), [
    { "@value": "authored" },
  ]);
  const raw = await getRawPropertyValues(written, `${AS}#icon`);
  deepStrictEqual((raw[0] as Record<string, unknown>)[EXT], [
    { "@value": "authored" },
  ]);
  const json = await expanded(written);
  const [child] = json[`${AS}#icon`] as Record<string, unknown>[];
  deepStrictEqual(child[EXT], [{ "@value": "authored" }]);
});

test("withRawProperty() resets changed object trust and preserves untouched children", async () => {
  const originalChild = new Note({
    id: new URL("https://remote.example/original"),
    content: "trusted constructor child",
  });
  let fetches = 0;
  const documentLoader = (url: string) => {
    fetches++;
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: { "@context": AS, id: url, type: "Note", content: "fetched" },
    });
  };
  const source = new Create(
    {
      id: new URL("https://local.example/create"),
      object: originalChild,
      attachments: [originalChild],
    },
    { ...options, documentLoader },
  );
  const written = await withRawProperty(source, `${AS}#object`, [
    {
      "@id": "https://remote.example/replacement",
      "@type": [`${AS}#Note`],
      [`${AS}#content`]: [{ "@value": "untrusted supplied child" }],
    },
  ]);
  strictEqual(
    (await Array.fromAsync(written.getAttachments()))[0],
    originalChild,
  );
  strictEqual(fetches, 0);
  strictEqual((await written.getObject())?.content, "fetched");
  strictEqual(fetches, 1);
  strictEqual(await source.getObject(), originalChild);
  const untouched = await withRawProperty(source, EXT, [{ "@value": "safe" }]);
  strictEqual(await untouched.getObject(), originalChild);
  strictEqual(fetches, 1);
});

test("known raw reads include authored child extensions only", async () => {
  const received = await Note.fromJsonLd({
    "@context": AS,
    type: "Note",
    [OTHER]: { "@value": "received only" },
  });
  const child = await withRawProperty(received, EXT, [
    { "@value": "authored" },
  ]);
  const parent = new Create({ object: child });
  const [raw] = await getRawPropertyValues(parent, `${AS}#object`);
  deepStrictEqual((raw as Record<string, unknown>)[EXT], [
    { "@value": "authored" },
  ]);
  strictEqual(OTHER in raw, false);
  const copied = await withRawProperty(new Create({}), `${AS}#object`, [raw]);
  const copiedChild = await copied.getObject();
  ok(copiedChild instanceof Note);
  deepStrictEqual(await getRawPropertyValues(copiedChild, EXT), [
    { "@value": "authored" },
  ]);
  const [serializedChild] = (await expanded(copied))[`${AS}#object`] as Record<
    string,
    unknown
  >[];
  deepStrictEqual(serializedChild[EXT], [{ "@value": "authored" }]);
  strictEqual(OTHER in serializedChild, false);
  deepStrictEqual(await getRawPropertyValues(received, EXT), []);
  deepStrictEqual(await getRawPropertyValues(received, OTHER), [
    { "@value": "received only" },
  ]);
});

test("withRawProperty() preserves written extensions through clones and isolates outputs", async () => {
  const values = [{ "@type": "@json", "@value": { list: [1] } }];
  const written = await withRawProperty(new Note({}), EXT, values);
  for (const copy of [written, written.clone(), written.deepClone()]) {
    deepStrictEqual((await expanded(copy))[EXT], values);
    const raw = await getRawPropertyValues(copy, EXT);
    (raw[0] as { "@value": { list: number[] } })["@value"].list.push(2);
    const json = await expanded(copy);
    (json[EXT] as { "@value": { list: number[] } }[])[0]["@value"].list.push(3);
    deepStrictEqual(await getRawPropertyValues(copy, EXT), values);
    deepStrictEqual((await expanded(copy))[EXT], values);
  }
});

test("withRawProperty() snapshots values and URL keys before returning", async () => {
  const property = new URL(EXT);
  const values = [{ "@type": "@json", "@value": { list: [1] } }];
  const entries: [string | URL, RawPropertyValue[]][] = [[property, values]];
  const pending = withRawProperties(new Note({}), entries);
  property.hash = "changed";
  values[0]["@value"].list.push(2);
  entries.push([OTHER, [{ "@value": "too late" }]]);
  const written = await pending;
  deepStrictEqual(await getRawPropertyValues(written, EXT), [
    { "@type": "@json", "@value": { list: [1] } },
  ]);
  deepStrictEqual(await getRawPropertyValues(written, OTHER), []);
  deepStrictEqual(await getRawPropertyValues(written, property), []);
  const record = { [EXT]: [{ "@value": "first" }] };
  const recordPending = withRawProperties(new Note({}), record);
  record[EXT][0]["@value"] = "second";
  deepStrictEqual(await getRawPropertyValues(await recordPending, EXT), [
    { "@value": "first" },
  ]);
  const singularProperty = new URL(EXT);
  const singularValues = [{ "@value": "first" }];
  const singularPending = withRawProperty(
    new Note({}),
    singularProperty,
    singularValues,
  );
  singularProperty.hash = "changed";
  singularValues[0]["@value"] = "second";
  deepStrictEqual(await getRawPropertyValues(await singularPending, EXT), [
    { "@value": "first" },
  ]);
});

test("withRawProperties() rejects duplicate destinations before decoding", async () => {
  const source = new Note({
    licenses: [new URL("https://example.com/license")],
  });
  const values = [{ "@value": "one" }];
  const duplicatePairs = [
    [EXT, EXT],
    [EXT, new URL(EXT)],
    ["https://EXAMPLE.com:443/new", "https://example.com/new"],
    [SCHEMA_LICENSE, DC_LICENSE],
  ] as const;
  for (const [first, second] of duplicatePairs) {
    for (const keys of [
      [first, second],
      [second, first],
    ]) {
      await rejects(
        withRawProperties(
          source,
          keys.map((key) => [key, values] as const),
        ),
        TypeError,
      );
      await rejects(
        withRawProperties(
          source,
          keys.map((key) => [key, null] as const),
        ),
        TypeError,
      );
    }
  }
  strictEqual(source.licenses[0]?.href, "https://example.com/license");
});

test("withRawProperty() uses original exact retained keys before URL normalization", async () => {
  const exact = "https://EXAMPLE.com:443/extension";
  const normalized = "https://example.com/extension";
  const source = await Note.fromJsonLd({
    "@type": [`${AS}#Note`],
    [exact]: [{ "@value": "exact" }],
    [normalized]: [{ "@value": "normalized" }],
  });
  for (const entries of [
    [
      [exact, [{ "@value": "new exact" }]],
      [new URL(normalized), [{ "@value": "new normalized" }]],
    ],
    [
      [new URL(normalized), [{ "@value": "new normalized" }]],
      [exact, [{ "@value": "new exact" }]],
    ],
  ] as const) {
    const written = await withRawProperties(source, entries);
    deepStrictEqual(await getRawPropertyValues(written, exact), [
      { "@value": "new exact" },
    ]);
    deepStrictEqual(await getRawPropertyValues(written, normalized), [
      { "@value": "new normalized" },
    ]);
  }
  const fresh = await withRawProperty(new Note({}), exact, [
    { "@value": "new" },
  ]);
  const json = await expanded(fresh);
  strictEqual(exact in json, false);
  deepStrictEqual(json[normalized], [{ "@value": "new" }]);
});

test("withRawProperties() rejects invalid known values atomically", async () => {
  const source = await Note.fromJsonLd({
    "@context": AS,
    type: "Note",
    content: "Original",
    [EXT]: { "@value": "retained" },
    attachment: { type: "Note", content: "Unchanged child" },
  });
  const child = (await Array.fromAsync(source.getAttachments()))[0];
  const before = await source.toJsonLd(options);
  for (const bad of [
    { [`${AS}#content`]: [{ "@id": "https://example.com/not-text" }] },
    { [`${AS}#published`]: [{ "@value": "not a date" }] },
    { [DC_LICENSE]: [{ "@value": "not a URL" }] },
    {
      [`${AS}#attachment`]: [
        {
          "@type": [`${AS}#Note`],
          [`${AS}#published`]: [{ "@value": "bad date" }],
        },
      ],
    },
    {
      [`${AS}#icon`]: [
        {
          "@type": [`${AS}#Note`],
          [`${AS}#content`]: [{ "@value": "wrong range" }],
        },
      ],
    },
  ]) {
    await rejects(
      withRawProperties(source, { [EXT]: [{ "@value": "changed" }], ...bad }),
    );
    strictEqual(source.content, "Original");
    deepStrictEqual(await getRawPropertyValues(source, EXT), [
      { "@value": "retained" },
    ]);
    deepStrictEqual(await source.toJsonLd(options), before);
    strictEqual((await Array.fromAsync(source.getAttachments()))[0], child);
  }
});

test("withRawProperties() rejects included references atomically across shared roles", async () => {
  const source = await Note.fromJsonLd(
    {
      "@context": AS,
      type: "Note",
      content: "Original",
      [EXT]: { "@value": "retained" },
    },
    options,
  );
  const before = await source.toJsonLd(options);
  const reference = { "@id": "https://example.com/reference" };
  const invalid: RawPropertyValue[] = [{ "@included": [reference] }];
  for (const shareArray of [false, true]) {
    const graph = [reference];
    const included = shareArray ? graph : [reference];
    const members = [
      ["@graph", graph],
      ["@included", included],
    ] as const;
    for (const entries of [members, [...members].reverse()]) {
      invalid.push(Object.fromEntries(entries));
    }
  }
  for (const value of invalid) {
    await rejects(
      withRawProperties(source, {
        [`${AS}#content`]: [{ "@value": "Edited" }],
        [EXT]: [value],
      }),
      TypeError,
    );
    strictEqual(source.content, "Original");
    deepStrictEqual(await getRawPropertyValues(source, EXT), [
      { "@value": "retained" },
    ]);
    deepStrictEqual(await source.toJsonLd(options), before);
  }
});

test("withRawProperty() serializes graph and reverse references, included subjects, and opaque JSON", async () => {
  const references = [{ "@id": "https://example.com/reference" }];
  const opaque = { "@included": references, "@graph": references };
  for (const value of [
    { "@graph": references },
    { "@reverse": { [OTHER]: references } },
    { "@included": [{ ...references[0], [OTHER]: [{ "@value": "Subject" }] }] },
    { "@type": "@json", "@value": opaque },
  ]) {
    const written = await withRawProperty(new Note({}), EXT, [value]);
    deepStrictEqual(await getRawPropertyValues(written, EXT), [value]);
    const json = await expanded(written);
    ok(EXT in json);
    await written.toJsonLd(options);
    if ("@value" in value) deepStrictEqual(json[EXT], [value]);
  }
});

for (const [label, values] of [
  [
    "bare reference",
    [{ "@graph": [{ "@id": "https://example.com/reference" }] }],
  ],
  ["empty node", [{ "@graph": [{}] }]],
  [
    "named mixed graph",
    [
      {
        "@id": "https://example.com/graph",
        "@graph": [
          { "@id": "https://example.com/reference" },
          {
            "@id": "https://example.com/subject",
            [OTHER]: [{ "@value": "Subject" }],
          },
        ],
      },
    ],
  ],
  [
    "nested graph property",
    [
      {
        "@id": "https://example.com/nested",
        [OTHER]: [
          { "@graph": [{ "@id": "https://example.com/reference" }, {}] },
        ],
      },
    ],
  ],
] as const) {
  test(`withRawProperty() keeps compact graph publication: ${label}`, async () => {
    const written = await withRawProperty(
      new Note({
        id: new URL("https://example.com/notes/publication"),
      }),
      EXT,
      values,
    );
    deepStrictEqual(await getRawPropertyValues(written, EXT), values);
    deepStrictEqual((await expanded(written))[EXT], values);
    const parent = new Create({
      id: new URL("https://example.com/activities/publication"),
      object: written,
    });
    for (const serializationOptions of [
      options,
      { ...options, format: "compact" as const },
      {
        ...options,
        format: "compact" as const,
        context: [AS, { extension: EXT }],
      },
    ]) {
      const compacted = await written.toJsonLd(serializationOptions);
      const reparsed = await Note.fromJsonLd(compacted, options);
      deepStrictEqual(await getRawPropertyValues(reparsed, EXT), values);
      const compactedParent = await parent.toJsonLd(serializationOptions);
      const reparsedParent = await Create.fromJsonLd(compactedParent, options);
      const child = await reparsedParent.getObject({ crossOrigin: "trust" });
      ok(child instanceof Note);
      deepStrictEqual(await getRawPropertyValues(child, EXT), values);
    }
  });
}

test("withRawProperty() compacts authored graphs alongside proof references", async () => {
  const reference = "https://example.com/proofs/remote";
  const values = [
    { "@graph": [{ "@id": "https://example.com/reference" }, {}] },
  ];
  for (const Page of [CollectionPage, OrderedCollectionPage]) {
    const source = new Page({
      proofs: [
        new URL(reference),
        new DataIntegrityProof({ cryptosuite: "eddsa-jcs-2022" }),
      ],
    });
    const written = await withRawProperty(source, EXT, values);
    for (const serializationOptions of [
      options,
      { ...options, format: "compact" as const },
    ]) {
      const compacted = (await written.toJsonLd(
        serializationOptions,
      )) as Record<string, unknown>;
      const proofs = Array.isArray(compacted.proof)
        ? compacted.proof
        : [compacted.proof];
      ok(proofs.includes(reference));
      const embedded = proofs.find(
        (proof) => proof != null && typeof proof === "object",
      );
      ok(embedded != null);
      deepStrictEqual(
        (embedded as Record<string, unknown>)["@context"],
        compacted["@context"],
      );
      const reparsed = await Page.fromJsonLd(compacted, options);
      deepStrictEqual(await getRawPropertyValues(reparsed, EXT), values);
    }
  }
});

test("withRawProperty() rejects non-expanded and non-JSON input without loading contexts", async () => {
  let loads = 0;
  const source = new Note(
    {},
    {
      contextLoader: () => {
        loads++;
        throw new Error("Raw input must not select a context loader");
      },
    },
  );
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  let accesses = 0;
  const accessor = {
    get value() {
      accesses++;
      return 1;
    },
  };
  const sparse = new Array(2);
  sparse[1] = 1;
  for (const value of [
    "compact literal",
    { "@value": null },
    { "@value": 1, "@id": "https://example.com/id" },
    {
      "@context": "https://example.com/context",
      "@id": "https://example.com/id",
    },
    { content: [{ "@value": "compact key" }] },
    { [EXT]: { "@value": "missing array" } },
    { "@set": [{ "@value": 1 }] },
    { "@type": "@json", "@value": { invalid: undefined } },
    { "@type": "@json", "@value": { invalid: () => 1 } },
    { "@type": "@json", "@value": { invalid: Symbol("value") } },
    { "@type": "@json", "@value": { invalid: Infinity } },
    { "@type": "@json", "@value": { invalid: NaN } },
    { "@type": "@json", "@value": new Date() },
    { "@type": "@json", "@value": cyclic },
    { "@type": "@json", "@value": accessor },
    { "@type": "@json", "@value": sparse },
  ]) {
    await rejects(
      withRawProperty(source, EXT, [value] as readonly RawPropertyValue[]),
      TypeError,
    );
  }
  strictEqual(accesses, 0);
  strictEqual(loads, 0);
  deepStrictEqual(await getRawPropertyValues(source, EXT), []);
});

test("withRawProperty() preserves opaque JSON and shared acyclic values safely", async () => {
  const shared = { value: [false, 0, "", null] };
  const payload = JSON.parse(
    '{"@context":"data","__proto__":{"polluted":true}}',
  ) as Record<string, unknown>;
  payload.first = shared;
  payload.second = shared;
  const values = [
    { "@type": "@json", "@value": payload },
    { "@type": "@json", "@value": null },
    { "@value": false },
    { "@value": 0 },
    { "@value": "" },
  ];
  const written = await withRawProperty(new Note({}), EXT, values);
  deepStrictEqual(await getRawPropertyValues(written, EXT), values);
  const [raw] = await getRawPropertyValues(written, EXT);
  const copied = (raw as { "@value": Record<string, unknown> })["@value"];
  strictEqual(Object.hasOwn(copied, "__proto__"), true);
  strictEqual(Object.getPrototypeOf(copied), Object.prototype);
  strictEqual("polluted" in {}, false);
});

test("withRawProperty() preserves opaque JSON key order", async () => {
  const payload = {
    z: 1,
    a: 2,
    m: { y: 1, b: 2 },
    entries: [{ second: 2, first: 1 }],
  };
  const written = await withRawProperty(new Note({}), EXT, [
    { "@type": "@json", "@value": payload },
  ]);
  const [raw] = await getRawPropertyValues(written, EXT);
  strictEqual(
    JSON.stringify((raw as { "@value": unknown })["@value"]),
    JSON.stringify(payload),
  );
  const [serialized] = (await expanded(written))[EXT] as {
    "@value": unknown;
  }[];
  strictEqual(JSON.stringify(serialized["@value"]), JSON.stringify(payload));
  const reparsed = await Note.fromJsonLd(
    await written.toJsonLd(options),
    options,
  );
  const [roundTripped] = await getRawPropertyValues(reparsed, EXT);
  strictEqual(
    JSON.stringify((roundTripped as { "@value": unknown })["@value"]),
    JSON.stringify(payload),
  );
});

test("withRawProperty() copies multilevel shared JSON without expanding every path", async () => {
  const levels = 24;
  const leaf = { value: "original" };
  let payload: unknown = leaf;
  for (let i = 0; i < levels; i++) payload = { left: payload, right: payload };
  const source = new Note({ content: "Original" });
  const pending = withRawProperty(source, EXT, [
    { "@type": "@json", "@value": payload },
  ]);
  leaf.value = "changed input";
  const written = await pending;
  function checkDag(root: unknown): { value: string } {
    const pendingNodes: [unknown, number][] = [[root, levels]];
    const seen = new Map<object, number>();
    let copiedLeaf: { value: string } | undefined;
    while (pendingNodes.length > 0) {
      const [value, remaining] = pendingNodes.pop()!;
      ok(value != null && typeof value === "object" && !Array.isArray(value));
      if (seen.has(value)) {
        strictEqual(seen.get(value), remaining);
        continue;
      }
      seen.set(value, remaining);
      ok(
        seen.size <= 4 * (levels + 1),
        "Copy expanded the shared JSON into separate paths",
      );
      if (remaining === 0) {
        strictEqual((value as { value: unknown }).value, "original");
        copiedLeaf = value as { value: string };
      } else {
        const node = value as { left: unknown; right: unknown };
        pendingNodes.push(
          [node.left, remaining - 1],
          [node.right, remaining - 1],
        );
      }
    }
    ok(copiedLeaf != null);
    return copiedLeaf;
  }
  const [raw] = await getRawPropertyValues(written, EXT);
  const copiedLeaf = checkDag((raw as { "@value": unknown })["@value"]);
  notStrictEqual(copiedLeaf, leaf);
  copiedLeaf.value = "changed output";
  const [reread] = await getRawPropertyValues(written, EXT);
  checkDag((reread as { "@value": unknown })["@value"]);
  strictEqual(leaf.value, "changed input");
  strictEqual(source.content, "Original");
  deepStrictEqual(await getRawPropertyValues(source, EXT), []);
  const cycle: Record<string, unknown> = { left: payload };
  cycle.right = cycle;
  await rejects(
    withRawProperty(source, EXT, [{ "@type": "@json", "@value": cycle }]),
    TypeError,
  );
  deepStrictEqual(await getRawPropertyValues(source, EXT), []);
});

test("withRawProperty() stores and reads a deeply nested unknown JSON literal", async () => {
  let payload: unknown = "leaf";
  for (let i = 0; i < 20_000; i++) payload = { child: payload };
  const written = await withRawProperty(new Note({}), EXT, [
    { "@type": "@json", "@value": payload },
  ]);
  const [value] = await getRawPropertyValues(written, EXT);
  let current = (value as { "@value": unknown })["@value"];
  for (let i = 0; i < 20_000; i++) {
    ok(current != null && typeof current === "object");
    current = (current as { child: unknown }).child;
  }
  strictEqual(current, "leaf");
});

test("withRawProperties() keeps deep known children atomic with invalid sibling writes", async () => {
  let payload: unknown = "leaf";
  for (let i = 0; i < 20_000; i++) payload = { child: payload };
  const source = new Create({ object: new Note({ content: "Original" }) });
  const child = await source.getObject();
  const rawChild = {
    "@type": [`${AS}#Note`],
    [EXT]: [{ "@type": "@json", "@value": payload }],
  };
  const written = await withRawProperty(source, `${AS}#object`, [rawChild]);
  const decodedChild = await written.getObject();
  ok(decodedChild instanceof Note);
  const [decodedValue] = await getRawPropertyValues(decodedChild, EXT);
  let current = (decodedValue as { "@value": unknown })["@value"];
  for (let i = 0; i < 20_000; i++) {
    ok(current != null && typeof current === "object");
    current = (current as { child: unknown }).child;
  }
  strictEqual(current, "leaf");
  await rejects(
    withRawProperties(source, {
      [OTHER]: [{ "@value": "must not commit" }],
      [`${AS}#object`]: [rawChild],
      [`${AS}#content`]: [{ "@id": "https://example.com/not-text" }],
    }),
  );
  strictEqual(await source.getObject(), child);
  strictEqual(child?.content, "Original");
  deepStrictEqual(await getRawPropertyValues(source, OTHER), []);
});

test("withRawProperty() requires an explicitly supplied values argument", async () => {
  const source = new Note({});
  const omitValues = withRawProperty as unknown as (
    object: Note,
    iri: string,
  ) => Promise<Note>;
  await rejects(omitValues(source, EXT), TypeError);
  const written = await withRawProperty(source, EXT, undefined);
  notStrictEqual(written, source);
});

test("withRawProperty() preserves subclass identity and generic result types", async () => {
  class CustomNote extends Note {
    marker = "subclass";
  }
  const source = new CustomNote({ content: "Original" });
  const pending: Promise<CustomNote> = withRawProperty(source, EXT, [
    { "@value": "new" },
  ]);
  const batch: Promise<CustomNote> = withRawProperties(source, {});
  for (const written of [await pending, await batch]) {
    ok(written instanceof CustomNote);
    strictEqual(written.marker, "subclass");
    notStrictEqual(written, source);
  }
  // Type-check this function without invoking a deliberately invalid call:
  function checkRequiredArgument() {
    // @ts-expect-error The third argument is required even though undefined removes.
    withRawProperty(source, EXT);
  }
  void checkRequiredArgument;
});
