import { deepStrictEqual, ok, rejects, strictEqual, throws } from "node:assert";
import { test } from "node:test";
import {
  copyJsonValue,
  createRawPropertyEncodingOptions,
  encodeNestedVocabularyValue,
  expandRawPropertyValue,
  parseRawPropertyIri,
  RAW_PROPERTY_PROTOCOL,
  RAW_PROPERTY_WRITE_PROTOCOL,
  type RawPropertyWriteEntry,
  writeRawPropertyValues,
  readRawPropertyValues,
  retainRawProperties,
} from "./raw-property.ts";

test("parseRawPropertyIri() accepts absolute IRIs", () => {
  deepStrictEqual(parseRawPropertyIri("https://example.com/ns#prop", "f"), [
    "https://example.com/ns#prop",
  ]);
  deepStrictEqual(
    parseRawPropertyIri(new URL("https://example.com/ns#prop"), "f"),
    ["https://example.com/ns#prop"],
  );
  deepStrictEqual(parseRawPropertyIri("HTTPS://Example.COM/ns#prop", "f"), [
    "HTTPS://Example.COM/ns#prop",
    "https://example.com/ns#prop",
  ]);
  deepStrictEqual(
    parseRawPropertyIri("https://例え.jp/語#性質", "f")[0],
    "https://例え.jp/語#性質",
  );
  deepStrictEqual(parseRawPropertyIri("https://[::1]/ns#prop", "f"), [
    "https://[::1]/ns#prop",
  ]);
  deepStrictEqual(
    parseRawPropertyIri("https://user@[2001:db8::1]:8080/ns#prop", "f"),
    ["https://user@[2001:db8::1]:8080/ns#prop"],
  );
  deepStrictEqual(parseRawPropertyIri("urn://[v1.fe80::a+en1]/p", "f"), [
    "urn://[v1.fe80::a+en1]/p",
  ]);
  deepStrictEqual(
    parseRawPropertyIri("https://user:pass@example.com:8080/p", "f"),
    ["https://user:pass@example.com:8080/p"],
  );
  deepStrictEqual(
    parseRawPropertyIri("https://example.com:/p", "f")[0],
    "https://example.com:/p",
  );
  deepStrictEqual(parseRawPropertyIri("urn:example:prop", "f"), [
    "urn:example:prop",
  ]);
});

test("parseRawPropertyIri() rejects what is not an absolute IRI", () => {
  for (const iri of [
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
    "https://[abc]/x",
    "https://[::1/x",
    "https://::1]/x",
    "https://[::1]x/y",
    "https://a[::1]/x",
    "https://[u@]::1]/x",
    "https://[v1]/x",
    "https://example.com:abc/p",
    "https://example.com:80:90/p",
    "https://user@example.com:8a/p",
    "https://a@b@example.com/p",
    "https://example.com/\uD800",
  ]) {
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
      encodeNestedVocabularyValue(options, b, () =>
        encodeNestedVocabularyValue(options, a, () => Promise.resolve(3)),
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
  deepStrictEqual((requests[0] as { candidates: string[] }).candidates, [
    "HTTPS://example.com/p",
    "https://example.com/p",
  ]);
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

test("copyJsonValue() copies values nested beyond the call stack", () => {
  let value: unknown = "leaf";
  for (let i = 0; i < 20000; i++) value = { a: [value] };
  const copy = copyJsonValue(value, true) as { a: unknown[] };
  ok(copy !== value);
  ok(Object.isFrozen(copy) && Object.isFrozen(copy.a));
  const thawed = copyJsonValue(copy);
  ok(!Object.isFrozen(thawed));
  const retained = retainRawProperties(
    { "https://example.com/p": [{ "@value": value, "@type": "@json" }] },
    new Set(),
  );
  ok(retained != null);
});

test("raw writes snapshot iterables and JSON before protocol suspension", async () => {
  let captured: readonly RawPropertyWriteEntry[] = [];
  const object = {
    async [RAW_PROPERTY_WRITE_PROTOCOL](
      entries: readonly RawPropertyWriteEntry[],
    ) {
      captured = entries;
      await Promise.resolve();
      return this;
    },
  };
  const iri = new URL("https://example.com/p");
  const shared = { data: "before" };
  const values = [
    { "@value": { first: shared, second: shared }, "@type": "@json" },
  ];
  let traversals = 0;
  function* entries() {
    traversals++;
    yield [iri, values];
  }
  const result = writeRawPropertyValues(object, entries(), "test");
  iri.pathname = "/after";
  shared.data = "after";
  await result;
  strictEqual(traversals, 1);
  deepStrictEqual(captured[0].candidates, ["https://example.com/p"]);
  deepStrictEqual(captured[0].values, [
    {
      "@type": "@json",
      "@value": { first: { data: "before" }, second: { data: "before" } },
    },
  ]);
  ok(Object.isFrozen(captured[0].values));
  ok(
    Object.isFrozen((captured[0].values[0] as { "@value": object })["@value"]),
  );
});

test("raw writes reject malformed JSON and expanded shapes before dispatch", async () => {
  let calls = 0;
  const object = {
    [RAW_PROPERTY_WRITE_PROTOCOL]() {
      calls++;
      return Promise.resolve(this);
    },
  };
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const accessor = Object.defineProperty({}, "@value", {
    get() {
      throw new Error("getter invoked");
    },
    enumerable: true,
  });
  class JsonArray extends Array {}
  const cases = [
    [{ "@value": new JsonArray(), "@type": "@json" }],
    [{ "@type": ["Note"] }],
    [{ "@type": ["@json"] }],
    [{ "@value": "x", "@type": "_:datatype" }],
    [{ "@value": cycle, "@type": "@json" }],
    [{ "@value": undefined }],
    [{ "@value": NaN }],
    [{ "@value": Infinity }],
    [{ "@value": null }],
    [{ "@value": new Date(), "@type": "@json" }],
    [{ "@value": [1, , 3], "@type": "@json" }],
    [accessor],
    [{ "@value": "x", "@id": "urn:x" }],
    [{ "@list": [], "@graph": [] }],
    [{ "@context": {} }],
    [{ "@set": [] }],
    [{ "@nest": {} }],
    [{ content: [{ "@value": "x" }] }],
    [{ "https://example.com/p": "x" }],
    [{ "@reverse": { "https://example.com/p": [{ "@value": "x" }] } }],
    [{ "@graph": [{ "@list": [] }] }],
    [{ "@type": "urn:Type" }],
    [{ "@value": false, "@language": "en" }],
    [{ "@value": "x", "@direction": "up" }],
  ];
  for (const values of cases) {
    await rejects(
      writeRawPropertyValues(
        object,
        { "https://example.com/p": values },
        "test",
      ),
      TypeError,
    );
  }
  for (const entries of [
    [],
    [["https://example.com/p"]],
    { [Symbol.iterator]: 1 },
  ]) {
    if (Array.isArray(entries) && entries.length === 0) continue;
    await rejects(writeRawPropertyValues(object, entries, "test"), TypeError);
  }
  strictEqual(calls, 0);
  await rejects(
    writeRawPropertyValues({ [RAW_PROPERTY_PROTOCOL]() {} }, {}, "test"),
    /write support/,
  );
});

test("raw writes preserve deep opaque JSON, prototype keys, and scalar falsy values", async () => {
  let captured: readonly RawPropertyWriteEntry[] = [];
  const object = {
    [RAW_PROPERTY_WRITE_PROTOCOL](entries: readonly RawPropertyWriteEntry[]) {
      captured = entries;
      return Promise.resolve(this);
    },
  };
  let deep: Record<string, unknown> = JSON.parse(
    '{"__proto__":{"polluted":true},"@context":"data"}',
  );
  for (let i = 0; i < 20_000; i++) deep = { child: deep };
  await writeRawPropertyValues(
    object,
    {
      "https://example.com/p": [
        { "@value": deep, "@type": "@json" },
        { "@value": null, "@type": "@json" },
        { "@value": false },
        { "@value": 0 },
        { "@value": "" },
      ],
    },
    "test",
  );
  let copied = (captured[0].values[0] as { "@value": Record<string, unknown> })[
    "@value"
  ];
  for (let i = 0; i < 20_000; i++)
    copied = copied.child as Record<string, unknown>;
  ok(Object.hasOwn(copied, "__proto__"));
  strictEqual(Object.getPrototypeOf(copied), Object.prototype);
  deepStrictEqual(copied["__proto__"], { polluted: true });
  strictEqual(copied["@context"], "data");
});

test("raw writes reject sparse arrays disguised with out-of-range numeric keys", async () => {
  let calls = 0;
  const object = {
    [RAW_PROPERTY_WRITE_PROTOCOL]() {
      calls++;
      return Promise.resolve(this);
    },
  };
  for (const key of [
    "4294967295",
    "9007199254740992",
    "999999999999999999999999999999999999999999999999",
  ]) {
    const values: unknown[] = [{ "@value": "ok" }];
    values.length = 2;
    Object.defineProperty(values, key, {
      value: { bad: "escaped" },
      enumerable: true,
    });
    await rejects(
      writeRawPropertyValues(
        object,
        { "https://example.com/p": values },
        "test",
      ),
      TypeError,
    );
    await rejects(
      writeRawPropertyValues(
        object,
        { "https://example.com/p": [{ "@value": values, "@type": "@json" }] },
        "test",
      ),
      TypeError,
    );
  }
  // A real high array index extends length, but must reject from the key
  // count without allocating a dense copy or traversing billions of holes.
  const high: unknown[] = [];
  high[4294967294] = { "@value": "last" };
  await rejects(
    writeRawPropertyValues(object, { "https://example.com/p": high }, "test"),
    TypeError,
  );
  strictEqual(calls, 0);
});

function uniqueJsonObjects(value: unknown): Set<object> {
  const seen = new Set<object>();
  const pending = [value];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node == null || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    for (const child of Object.values(node)) pending.push(child);
  }
  return seen;
}

test("JSON copies and raw snapshots preserve bounded shared DAGs without aliasing their source", async () => {
  let shared: Record<string, unknown> = { leaf: "before" };
  const leaf = shared;
  for (let i = 0; i < 12; i++) shared = { left: shared, right: shared };
  for (const freeze of [false, true]) {
    const copy = copyJsonValue(shared, freeze);
    strictEqual(uniqueJsonObjects(copy).size, 13);
    ok(copy !== shared);
    let node = copy;
    for (let i = 0; i < 12; i++) {
      strictEqual(node.left, node.right);
      node = node.left as Record<string, unknown>;
    }
    ok(node !== leaf);
    strictEqual(node.leaf, "before");
    for (const object of uniqueJsonObjects(copy))
      strictEqual(Object.isFrozen(object), freeze);
  }
  let retained: readonly unknown[] = [];
  const target = {
    [RAW_PROPERTY_WRITE_PROTOCOL](entries: readonly RawPropertyWriteEntry[]) {
      retained = entries[0].values;
      return Promise.resolve(this);
    },
    [RAW_PROPERTY_PROTOCOL]() {
      return Promise.resolve(retained);
    },
  };
  const writing = writeRawPropertyValues(
    target,
    { "https://example.com/ext": [{ "@type": "@json", "@value": shared }] },
    "test",
  );
  leaf.leaf = "after";
  await writing;
  strictEqual(uniqueJsonObjects(retained).size, 15);
  for (const object of uniqueJsonObjects(retained)) ok(Object.isFrozen(object));
  const read = await readRawPropertyValues(
    target,
    "https://example.com/ext",
    "test",
  );
  strictEqual(uniqueJsonObjects(read).size, 15);
  for (const object of uniqueJsonObjects(read)) ok(!Object.isFrozen(object));
  let output = (read[0] as { "@value": Record<string, unknown> })["@value"];
  for (let i = 0; i < 12; i++) output = output.left as Record<string, unknown>;
  strictEqual(output.leaf, "before");
  output.leaf = "changed output";
  let stored = (retained[0] as { "@value": Record<string, unknown> })["@value"];
  for (let i = 0; i < 12; i++) stored = stored.right as Record<string, unknown>;
  strictEqual(stored.leaf, "before");
  const cyclic: Record<string, unknown> = { shared };
  cyclic.back = cyclic;
  throws(() => copyJsonValue(cyclic), /cyclic/);
  await rejects(
    writeRawPropertyValues(
      target,
      { "https://example.com/ext": [{ "@type": "@json", "@value": cyclic }] },
      "test",
    ),
    /cycles/,
  );
});

test("expanded DAG validation preserves role checks for shared objects", async () => {
  let calls = 0;
  const target = {
    [RAW_PROPERTY_WRITE_PROTOCOL]() {
      calls++;
      return Promise.resolve(this);
    },
  };
  let node: unknown = { "@id": "urn:leaf" };
  for (let i = 0; i < 24; i++)
    node = { "https://example.com/edge": [node, node] };
  await writeRawPropertyValues(
    target,
    { "https://example.com/ext": [node] },
    "test",
  );
  strictEqual(calls, 1);
  for (const shared of [
    { "@value": "literal" },
    { "@list": [{ "@id": "urn:leaf" }] },
  ]) {
    for (const keyword of ["@graph", "@included", "@reverse"]) {
      for (const reverse of [false, true]) {
        const sharedValues = [shared];
        const entries: [string, unknown][] = [
          ["https://example.com/allowed", sharedValues],
          [
            keyword,
            keyword === "@reverse"
              ? { "https://example.com/edge": sharedValues }
              : sharedValues,
          ],
        ];
        if (reverse) entries.reverse();
        await rejects(
          writeRawPropertyValues(
            target,
            { "https://example.com/ext": [Object.fromEntries(entries)] },
            "test",
          ),
          TypeError,
        );
      }
    }
  }
  // A subtree is opaque in a JSON literal, but still needs shape validation
  // when the same object also appears in a structural property position.
  const compact = { compactTerm: [] };
  for (const values of [
    [{ "@value": compact, "@type": "@json" }, compact],
    [compact, { "@value": compact, "@type": "@json" }],
  ])
    await rejects(
      writeRawPropertyValues(
        target,
        { "https://example.com/ext": values },
        "test",
      ),
      TypeError,
    );
  strictEqual(calls, 1);
});

test("expanded raw values reject processor-incompatible keys and identifiers", async () => {
  let calls = 0;
  const target = {
    [RAW_PROPERTY_WRITE_PROTOCOL]() {
      calls++;
      return Promise.resolve(this);
    },
  };
  for (const node of [
    { "https://example.com/\u00a0x": [{ "@value": 1 }] },
    { "https://example.com/\u2003x": [] },
    { "@id": "@foo" },
  ])
    for (const value of [node, { "@included": [node] }])
      await rejects(
        writeRawPropertyValues(
          target,
          { "https://example.com/ext": [value] },
          "test",
        ),
        TypeError,
      );
  strictEqual(calls, 0);
});

test("included subjects reject pure references before shared validation or dispatch", async () => {
  let calls = 0;
  const target = {
    [RAW_PROPERTY_WRITE_PROTOCOL]() {
      calls++;
      return Promise.resolve(this);
    },
  };
  const iri = "https://example.com/ext";
  const property = "https://example.com/property";
  const reference = { "@id": "https://example.com/reference" };
  for (const emptyMembers of [
    { "@type": [] },
    { "@reverse": {} },
    { "@type": [], "@reverse": {} },
  ])
    await rejects(
      writeRawPropertyValues(
        target,
        { [iri]: [{ "@included": [{ ...reference, ...emptyMembers }] }] },
        "test",
      ),
      TypeError,
    );
  for (const sharedArray of [false, true]) {
    for (const otherRole of ["@graph", "@reverse", property]) {
      for (const reverse of [false, true]) {
        const references = [reference];
        const entries: [string, unknown][] = [
          [
            otherRole,
            otherRole === "@reverse" ? { [property]: references } : references,
          ],
          ["@included", sharedArray ? references : [reference]],
        ];
        if (reverse) entries.reverse();
        await rejects(
          writeRawPropertyValues(
            target,
            {
              [property]: [{ "@value": "otherwise valid batch entry" }],
              [iri]: [Object.fromEntries(entries)],
            },
            "test",
          ),
          TypeError,
        );
      }
    }
  }
  strictEqual(calls, 0);
  for (const node of [
    { "@graph": [reference] },
    { "@reverse": { [property]: [reference] } },
    { "@included": [{ ...reference, [property]: [{ "@value": "subject" }] }] },
    { "@included": [{ ...reference, [property]: [] }] },
    { "@included": [{ ...reference, "@graph": [] }] },
    { "@included": [{ ...reference, "@included": [] }] },
    { "@value": { "@included": [reference] }, "@type": "@json" },
  ])
    await writeRawPropertyValues(target, { [iri]: [node] }, "test");
  strictEqual(calls, 7);
});

test("JSON copying isolates received paths only when sharing is disabled", () => {
  const child = { name: "original", nested: { value: "before" } };
  const input = { actor: child, attribution: child };
  const shared = copyJsonValue(input);
  strictEqual(shared.actor, shared.attribution);
  ok(shared.actor !== child);
  for (const freeze of [false, true]) {
    const separate = copyJsonValue(input, freeze, false);
    ok(separate.actor !== separate.attribution);
    ok(separate.actor.nested !== separate.attribution.nested);
    deepStrictEqual(separate, input);
    for (const object of uniqueJsonObjects(separate))
      strictEqual(Object.isFrozen(object), freeze);
    if (!freeze) {
      separate.actor.name = "changed";
      separate.actor.nested.value = "changed";
      strictEqual(separate.attribution.name, "original");
      strictEqual(separate.attribution.nested.value, "before");
      strictEqual(child.name, "original");
    }
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  throws(() => copyJsonValue(cyclic, false, false), /cyclic/);
});

test("raw snapshots and reads preserve opaque JSON property enumeration order", async () => {
  const values = [
    { "@type": "@json", "@value": { z: 1, a: 2, m: { y: 1, b: 2 } } },
  ];
  let retained: readonly unknown[] = [];
  const target = {
    [RAW_PROPERTY_WRITE_PROTOCOL](entries: readonly RawPropertyWriteEntry[]) {
      retained = entries[0].values;
      return Promise.resolve(this);
    },
    [RAW_PROPERTY_PROTOCOL]() {
      return Promise.resolve(retained);
    },
  };
  await writeRawPropertyValues(
    target,
    { "https://example.com/ext": values },
    "test",
  );
  strictEqual(JSON.stringify(retained), JSON.stringify(values));
  strictEqual(
    JSON.stringify(
      await readRawPropertyValues(target, "https://example.com/ext", "test"),
    ),
    JSON.stringify(values),
  );
});
