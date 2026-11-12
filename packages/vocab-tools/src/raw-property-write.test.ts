import {
  RAW_PROPERTY_WRITE_PROTOCOL,
  type RawPropertyWriteEntry,
} from "@fedify/vocab-runtime/internal/raw-property";
import {
  deepStrictEqual,
  notStrictEqual,
  ok,
  rejects,
  strictEqual,
} from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { generateClasses } from "./class.ts";
import type { PropertySchema, TypeSchema } from "./schema.ts";

const NS = "https://example.com/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const context = {
  id: "@id",
  type: "@type",
  Base: `${NS}Base`,
  Sub: `${NS}Sub`,
  Node: `${NS}Node`,
  value: { "@id": `${NS}value`, "@type": "@id", "@container": "@list" },
  alias: `${NS}alias`,
  label: `${NS}label`,
  child: `${NS}child`,
};
function type(
  name: string,
  properties: PropertySchema[],
  parent?: string,
): TypeSchema {
  return {
    name,
    uri: (NS + name) as TypeSchema["uri"],
    compactName: name,
    entity: false,
    description: name,
    ...(parent == null ? {} : { extends: (NS + parent) as TypeSchema["uri"] }),
    defaultContext: context as unknown as TypeSchema["defaultContext"],
    properties,
  };
}
function property(
  uri: string,
  extra: Record<string, unknown> = {},
): PropertySchema {
  return {
    singularName: uri,
    pluralName: uri + "s",
    uri: NS + uri,
    compactName: uri,
    description: uri,
    range: [XSD + "string"],
    ...extra,
  } as PropertySchema;
}
async function generate(types: Record<string, TypeSchema>, file: string) {
  const source = (await Array.fromAsync(generateClasses(types))).join("");
  await writeFile(
    file,
    source.replace(
      /from\s+"([^"]+)"/g,
      (_, specifier: string) =>
        `from ${JSON.stringify(import.meta.resolve(specifier))}`,
    ),
  );
  return await import(pathToFileURL(file).href);
}

test("raw writer clears shadowed slots and uses only the effective decoder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-raw-write-"));
  try {
    const types = {
      [NS + "Base"]: type("Base", [
        property("value", {
          singularName: "oldValue",
          pluralName: "oldValues",
          redundantProperties: [
            { uri: NS + "alias", compactName: "alias" },
            { uri: NS + "secondAlias", compactName: "secondAlias" },
          ],
        }),
      ]),
      [NS + "Sub"]: type(
        "Sub",
        [
          property("value", {
            range: [XSD + "anyURI"],
            container: "list",
          }),
        ],
        "Base",
      ),
    };
    const holderTypes = {
      ...types,
      [NS + "Holder"]: type("Holder", [
        property("child", { range: [NS + "Sub"] }),
      ]),
    };
    const first = await generate(holderTypes, join(dir, "first.mts"));
    const second = await generate(types, join(dir, "second.mts"));
    const original = new first.Sub({
      oldValues: ["old"],
      values: [new URL(NS + "before")],
    });
    for (const iri of [NS + "value", NS + "alias"]) {
      const changed = await second.withRawProperty(original, iri, [
        { "@list": [{ "@id": NS + "after" }] },
      ]);
      strictEqual(
        Object.getPrototypeOf(changed),
        Object.getPrototypeOf(original),
      );
      deepStrictEqual(changed.oldValues, []);
      deepStrictEqual(changed.values, [new URL(NS + "after")]);
      deepStrictEqual(original.oldValues, ["old"]);
      const expected = [{ "@list": [{ "@id": NS + "after" }] }];
      deepStrictEqual(
        await first.getRawPropertyValues(changed, NS + "value"),
        expected,
      );
      deepStrictEqual(
        await second.getRawPropertyValues(changed, NS + "alias"),
        expected,
      );
      const expanded = (await changed.toJsonLd({ format: "expand" }))[0];
      deepStrictEqual(expanded[NS + "value"], expected);
      ok(!(NS + "alias" in expanded));
      for (const options of [
        {},
        { format: "compact" },
        {
          format: "compact",
          context: {
            value: {
              "@id": NS + "value",
              "@container": "@list",
              "@type": "@id",
            },
          },
        },
      ]) {
        const output = await changed.toJsonLd(options);
        deepStrictEqual(output.value, [NS + "after"]);
        ok(!("alias" in output));
        ok(!(NS + "alias" in output));
      }
      const removed = await first.withRawProperty(original, iri, []);
      deepStrictEqual(removed.oldValues, []);
      deepStrictEqual(removed.values, []);
      const removal = (await removed.toJsonLd({ format: "expand" }))[0];
      ok(!(NS + "value" in removal));
      ok(!(NS + "alias" in removal));
    }
    const holder = await first.withRawProperty(
      new first.Holder({}),
      NS + "child",
      [
        {
          "@type": [NS + "Sub"],
          [NS + "alias"]: [{ "@list": [{ "@id": NS + "nested" }] }],
        },
      ],
    );
    deepStrictEqual(holder.childs[0].values, [new URL(NS + "nested")]);
    deepStrictEqual(holder.childs[0].oldValues, []);
    for (const reverse of [false, true]) {
      const aliases = [
        [NS + "alias", [{ "@list": [{ "@id": NS + "first" }] }]],
        [NS + "secondAlias", [{ "@list": [{ "@id": NS + "second" }] }]],
      ];
      if (reverse) aliases.reverse();
      const ordered = await first.withRawProperty(
        new first.Holder({}),
        NS + "child",
        [
          {
            "@type": [NS + "Sub"],
            ...Object.fromEntries(aliases),
          },
        ],
      );
      deepStrictEqual(ordered.childs[0].values, [new URL(NS + "first")]);
    }

    await rejects(
      first.withRawProperties(original, [
        [NS + "alias", []],
        [NS + "value", []],
      ]),
      /Duplicate/,
    );
    await rejects(
      first.withRawProperty(original, NS + "value", [{ "@value": "wrong" }]),
      TypeError,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writer does not decode a subclass canonical IRI as a superclass alias", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-raw-claimed-alias-"));
  try {
    for (const compatible of [false, true]) {
      const { Base, Sub, Leaf, Holder, withRawProperty } = await generate(
        {
          [NS + "Base"]: type("Base", [
            property("value", {
              redundantProperties: [
                { uri: NS + "alias", compactName: "alias" },
                { uri: NS + "inheritedAlias", compactName: "inheritedAlias" },
              ],
            }),
          ]),
          [NS + "Sub"]: type(
            "Sub",
            [
              property("alias", {
                singularName: "claimedValue",
                pluralName: "claimedValues",
                range: [XSD + (compatible ? "string" : "anyURI")],
                redundantProperties: [
                  { uri: NS + "ownAlias", compactName: "ownAlias" },
                ],
              }),
            ],
            "Base",
          ),
          [NS + "Leaf"]: type("Leaf", [], "Sub"),
          [NS + "Holder"]: type("Holder", [
            property("child", { range: [NS + "Sub"] }),
          ]),
        },
        join(dir, `${compatible ? "compatible" : "incompatible"}.mts`),
      );
      const raw = compatible
        ? [{ "@value": "claimed" }]
        : [{ "@id": NS + "claimed" }];
      const expected = compatible ? ["claimed"] : [new URL(NS + "claimed")];
      for (const Child of [Sub, Leaf]) {
        for (const iri of ["alias", "ownAlias"]) {
          const source = new Child({ values: ["original"] });
          const direct = await withRawProperty(source, NS + iri, raw);
          deepStrictEqual(direct.values, ["original"]);
          deepStrictEqual(direct.claimedValues, expected);
          deepStrictEqual(source.claimedValues, []);
          const nested = await withRawProperty(new Holder({}), NS + "child", [
            {
              "@type": [Child.name === "Sub" ? NS + "Sub" : NS + "Leaf"],
              [NS + iri]: raw,
            },
          ]);
          deepStrictEqual(nested.childs[0].values, []);
          deepStrictEqual(nested.childs[0].claimedValues, expected);
        }
        const inherited = await withRawProperty(new Holder({}), NS + "child", [
          {
            "@type": [Child.name === "Sub" ? NS + "Sub" : NS + "Leaf"],
            [NS + "inheritedAlias"]: [{ "@value": "inherited" }],
          },
        ]);
        deepStrictEqual(inherited.childs[0].values, ["inherited"]);
        deepStrictEqual(inherited.childs[0].claimedValues, []);
      }
      // Incoming decoding keeps its historical fallback, even when both
      // compatible fields consume the same IRI.
      const incoming = await Sub.fromJsonLd({
        "@type": [NS + "Sub"],
        [NS + "alias"]: raw,
      });
      deepStrictEqual(incoming.values, compatible ? ["claimed"] : []);
      deepStrictEqual(incoming.claimedValues, expected);
      const base = await Base.fromJsonLd({
        "@type": [NS + "Base"],
        [NS + "alias"]: [{ "@value": "base alias" }],
      });
      deepStrictEqual(base.values, ["base alias"]);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writer validates decoded integer ranges for direct and nested fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-raw-integer-"));
  try {
    for (const union of [false, true]) {
      const { Node, Holder, withRawProperty } = await generate(
        {
          [NS + "Node"]: type("Node", [
            property("value", {
              range: union
                ? [XSD + "integer", XSD + "nonNegativeInteger"]
                : [XSD + "integer"],
            }),
          ]),
          [NS + "Holder"]: type("Holder", [
            property("child", { range: [NS + "Node"] }),
          ]),
        },
        join(dir, `${union ? "union" : "integer"}.mts`),
      );
      const source = new Node({ values: [1] });
      const holder = new Holder({ childs: [source] });
      const fractional = [{ "@value": 1.5, "@type": XSD + "integer" }];
      const integer = [{ "@value": -2, "@type": XSD + "integer" }];
      await rejects(
        withRawProperty(source, NS + "value", fractional),
        TypeError,
      );
      await rejects(
        withRawProperty(holder, NS + "child", [
          {
            "@type": [NS + "Node"],
            [NS + "value"]: fractional,
          },
        ]),
        TypeError,
      );
      deepStrictEqual(source.values, [1]);
      strictEqual(holder.childs[0], source);
      const changed = await withRawProperty(source, NS + "value", integer);
      deepStrictEqual(changed.values, [-2]);
      const nested = await withRawProperty(holder, NS + "child", [
        {
          "@type": [NS + "Node"],
          [NS + "value"]: integer,
        },
      ]);
      deepStrictEqual(nested.childs[0].values, [-2]);
      const incoming = await Node.fromJsonLd({
        "@type": [NS + "Node"],
        [NS + "value"]: fractional,
      });
      deepStrictEqual(incoming.values, [1.5]);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("raw writer honors valid custom clones and rejects incompatible results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-raw-clone-"));
  try {
    const { Node, withRawProperty, withRawProperties } = await generate(
      {
        [NS + "Node"]: type("Node", [property("label", { functional: true })]),
      },
      join(dir, "fixture.mts"),
    );
    let calls = 0;
    class Custom extends Node {
      constructor(values: Record<string, unknown>) {
        super(values);
      }
      clone(values: unknown, options: unknown) {
        calls++;
        return super.clone(values, options);
      }
    }
    const original = new Custom({ label: "before" });
    const copy = await withRawProperty(original, NS + "label", [
      { "@value": "after" },
    ]);
    strictEqual(calls, 1);
    ok(copy instanceof Custom);
    strictEqual(copy.label, "after");
    strictEqual(original.label, "before");
    for (const mode of ["self", "base", "fake", "unrelated"]) {
      class Broken extends Node {
        constructor(values: Record<string, unknown>) {
          super(values);
        }
        clone() {
          if (mode === "self") return this;
          if (mode === "base") return new Node({});
          if (mode === "fake")
            return Object.create(Object.getPrototypeOf(this));
          return {};
        }
      }
      await rejects(withRawProperties(new Broken({}), {}), TypeError);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writer isolates borrowed preprocessor objects before retaining supplied extensions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-raw-hook-"));
  try {
    const hookFile = join(dir, "hook.mts");
    await writeFile(
      hookFile,
      `let borrowed: unknown; export function set(value: unknown) { borrowed = value; } export function preprocess() { return borrowed; }`,
    );
    const hook = await import(pathToFileURL(hookFile).href);
    const types = {
      [NS + "Node"]: type("Node", [
        property("label", { functional: true }),
        property("child", { range: [NS + "Node"] }),
      ]),
      [NS + "Base"]: type("Base", [
        property("value", {
          range: [NS + "Node"],
          preprocessors: [{ module: hookFile, function: "preprocess" }],
        }),
      ]),
    };
    const local = await generate(types, join(dir, "local.mts"));
    const foreign = await generate(types, join(dir, "foreign.mts"));
    for (const module of [local, foreign]) {
      const received = await module.Node.fromJsonLd({
        "@type": [NS + "Node"],
        [NS + "label"]: [{ "@value": "borrowed" }],
        [NS + "received"]: [{ "@value": "private" }],
      });
      const published = await module.withRawProperty(
        received,
        NS + "published",
        [{ "@value": "old" }],
      );
      const child = await module.withRawProperty(
        new module.Node({}),
        NS + "childExtension",
        [{ "@value": "child" }],
      );
      const borrowedWithChild = published.clone({ childs: [child] });
      hook.set(borrowedWithChild);
      const source = new local.Base({});
      const result = await local.withRawProperty(source, NS + "value", [
        {
          "@type": [NS + "Node"],
          [NS + "supplied"]: [{ "@value": "new" }],
        },
      ]);
      const embedded = result.values[0];
      notStrictEqual(embedded, borrowedWithChild);
      strictEqual(embedded.label, "borrowed");
      strictEqual(embedded.childs[0], child);
      deepStrictEqual(
        await module.getRawPropertyValues(borrowedWithChild, NS + "supplied"),
        [],
      );
      deepStrictEqual(
        await module.getRawPropertyValues(embedded, NS + "supplied"),
        [{ "@value": "new" }],
      );
      const output = (await embedded.toJsonLd({ format: "expand" }))[0];
      ok(!(NS + "published" in output));
      ok(!(NS + "received" in output));
      deepStrictEqual(output[NS + "supplied"], [{ "@value": "new" }]);
      deepStrictEqual(
        (await borrowedWithChild.toJsonLd({ format: "expand" }))[0][
          NS + "published"
        ],
        [{ "@value": "old" }],
      );
      deepStrictEqual(
        (await child.toJsonLd({ format: "expand" }))[0][NS + "childExtension"],
        [{ "@value": "child" }],
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writer preserves source defaults and rejects malformed supplied descendants", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-raw-defaults-"));
  try {
    const hookFile = join(dir, "defaults.mts");
    await writeFile(
      hookFile,
      `export let seen: unknown; export function inspect(_value: unknown, options: unknown) { seen = options; }`,
    );
    const hook = await import(pathToFileURL(hookFile).href);
    const { Base, Node, withRawProperty } = await generate(
      {
        [NS + "Node"]: type("Node", [property("label", { functional: true })]),
        [NS + "Base"]: type("Base", [
          property("value", {
            range: [NS + "Node"],
            preprocessors: [{ module: hookFile, function: "inspect" }],
          }),
        ]),
      },
      join(dir, "fixture.mts"),
    );
    const documentLoader = () => {
      throw new Error("unexpected document load");
    };
    const contextLoader = () => {
      throw new Error("unexpected context load");
    };
    const tracerProvider = {
      getTracer: () => ({
        startActiveSpan: (_name: string, ...args: unknown[]) =>
          (args[args.length - 1] as (span: unknown) => unknown)({
            setAttribute() {},
            setStatus() {},
            end() {},
          }),
      }),
    };
    const verifyPortableObject = () => {
      throw new Error("unexpected verification");
    };
    const baseUrl = new URL(NS + "base/");
    const warning = {
      category: ["fedify", "test"],
      message: "fixture",
      values: { reason: "untrusted" },
    };
    class Custom extends Base {
      constructor(values: unknown, options: unknown) {
        super(values, options);
      }
      defaults() {
        return [
          this._documentLoader,
          this._contextLoader,
          this._tracerProvider,
          this._verifyPortableObject,
          this._baseUrl,
          this._warning,
        ];
      }
    }
    const original = new Custom(
      { values: [new Node({ label: "old" })] },
      {
        documentLoader,
        contextLoader,
        tracerProvider,
        verifyPortableObject,
        baseUrl,
        $warning: warning,
      },
    );
    const updated = await withRawProperty(original, NS + "value", [
      {
        "@type": [NS + "Node"],
        [NS + "label"]: [{ "@value": "new" }],
      },
    ]);
    strictEqual(updated.values[0].label, "new");
    deepStrictEqual(updated.defaults(), original.defaults());
    strictEqual(hook.seen.documentLoader, documentLoader);
    strictEqual(hook.seen.contextLoader, contextLoader);
    strictEqual(hook.seen.tracerProvider, tracerProvider);
    strictEqual(hook.seen.verifyPortableObject, verifyPortableObject);
    strictEqual(hook.seen.baseUrl.href, baseUrl.href);
    await rejects(
      withRawProperty(original, NS + "value", [
        {
          "@type": [NS + "Node"],
          [NS + "label"]: [{ "@id": NS + "invalid-string" }],
        },
      ]),
      TypeError,
    );
    strictEqual(original.values[0].label, "old");
    for (const value of [
      { "@type": [NS + "Node"], "_:property": [{ "@value": "payload" }] },
      { "@graph": [{ "@type": [NS + "Node"] }, { "@type": [NS + "Node"] }] },
      { "@type": [NS + "Node"], "@included": [{ "@type": [NS + "Node"] }] },
      {
        "@type": [NS + "Node"],
        "@reverse": { [NS + "label"]: [{ "@id": NS + "other" }] },
      },
    ])
      await rejects(
        withRawProperty(original, NS + "value", [value]),
        TypeError,
      );
    const graphParsed = await Node.fromJsonLd({
      "@graph": [
        { "@type": [NS + "Node"], [NS + "label"]: [{ "@value": "first" }] },
        { "@type": [NS + "Node"], [NS + "label"]: [{ "@value": "second" }] },
      ],
    });
    strictEqual(graphParsed.label, "first");
    // Ordinary parsing retains its existing leniency for the same malformed field.
    const lenient = await Node.fromJsonLd({
      "@type": [NS + "Node"],
      [NS + "label"]: [{ "@id": NS + "invalid-string" }],
    });
    strictEqual(lenient.label, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("raw write protocol interoperates across runtime module copies", async () => {
  const moduleUrl = new URL(
    import.meta.resolve("@fedify/vocab-runtime/internal/raw-property"),
  );
  moduleUrl.search = "?duplicate-runtime";
  const other = await import(moduleUrl.href);
  strictEqual(other.RAW_PROPERTY_WRITE_PROTOCOL, RAW_PROPERTY_WRITE_PROTOCOL);
  let calls = 0;
  const target = {
    [RAW_PROPERTY_WRITE_PROTOCOL](entries: readonly RawPropertyWriteEntry[]) {
      calls++;
      deepStrictEqual(entries[0].values, [{ "@value": "copied" }]);
      return Promise.resolve(this);
    },
  };
  strictEqual(
    await other.writeRawPropertyValues(
      target,
      { "https://example.com/p": [{ "@value": "copied" }] },
      "test",
    ),
    target,
  );
  strictEqual(calls, 1);
});

test("writer preserves typeless classes and rejects unrepresentable container and scalar payloads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-raw-representable-"));
  try {
    const module = await generate(
      {
        [NS + "Node"]: {
          ...type("Node", [property("label", { functional: true })]),
          typeless: true,
        },
        [NS + "Base"]: type("Base", [
          property("value", { range: [NS + "Node"], container: "graph" }),
          property("reference", { range: [XSD + "anyURI"] }),
          property("union", { range: [XSD + "anyURI", NS + "Node"] }),
          property("literal", { functional: true }),
        ]),
      },
      join(dir, "fixture.mts"),
    );
    const { Base, Node, withRawProperty, getRawPropertyValues } = module;
    const source = new Base({ values: [new Node({ label: "original" })] });
    const raw = await getRawPropertyValues(source, NS + "value");
    ok(!("@type" in raw[0]["@graph"][0]));
    const copied = await withRawProperty(new Base({}), NS + "value", raw);
    deepStrictEqual(await getRawPropertyValues(copied, NS + "value"), raw);
    const node = {
      "@type": [NS + "Node"],
      [NS + "label"]: [{ "@value": "new" }],
    };
    for (const values of [
      [{ "@list": [] }],
      [{ "@graph": [] }],
      [{ "@graph": [node] }, { "@graph": [] }],
      [{ "@graph": [node], "@id": NS + "named" }],
      [{ "@graph": [node], [NS + "wrapper"]: [{ "@value": "lost" }] }],
    ]) {
      await rejects(withRawProperty(source, NS + "value", values), TypeError);
      strictEqual(source.values[0].label, "original");
      const unknown = await withRawProperty(source, NS + "unknown", values);
      deepStrictEqual(
        await getRawPropertyValues(unknown, NS + "unknown"),
        values,
      );
    }
    const payload = {
      "@id": NS + "target",
      "@type": [NS + "Node"],
      [NS + "extension"]: [{ "@value": "kept" }],
    };
    await rejects(
      withRawProperty(source, NS + "reference", [payload]),
      TypeError,
    );
    const represented = await withRawProperty(source, NS + "union", [payload]);
    ok(represented.unions[0] instanceof Node);
    deepStrictEqual(
      (await getRawPropertyValues(represented, NS + "union"))[0][
        NS + "extension"
      ],
      [{ "@value": "kept" }],
    );
    // The ordinary decoder still chooses its first compatible scalar range.
    const ordinary = await Base.fromJsonLd({
      "@type": [NS + "Base"],
      [NS + "union"]: [payload],
    });
    deepStrictEqual(ordinary.unions, [new URL(NS + "target")]);
    const metadata = await withRawProperty(source, NS + "literal", [
      { "@value": "text", "@direction": "rtl", "@index": "position" },
    ]);
    strictEqual(metadata.literal, "text");
    deepStrictEqual(await getRawPropertyValues(metadata, NS + "literal"), [
      { "@value": "text" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writer rejects undeclared containers while ordinary decoding stays lenient", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-raw-container-"));
  try {
    const { Base, withRawProperty, getRawPropertyValues } = await generate(
      {
        [NS + "Node"]: type("Node", [property("label", { functional: true })]),
        [NS + "Base"]: type("Base", [
          property("label"),
          property("child", { range: [NS + "Node"] }),
          property("ordered", { container: "list" }),
          property("graph", { range: [NS + "Node"], container: "graph" }),
        ]),
      },
      join(dir, "fixture.mts"),
    );
    const list = [{ "@list": [{ "@value": "first" }, { "@value": "second" }] }];
    const node = {
      "@type": [NS + "Node"],
      [NS + "label"]: [{ "@value": "child" }],
    };
    const graph = [{ "@graph": [node] }];
    const source = new Base({ labels: ["original"] });
    await rejects(
      withRawProperty(source, NS + "label", list),
      /list container/,
    );
    await rejects(
      withRawProperty(source, NS + "child", graph),
      /graph wrapper/,
    );
    await rejects(
      withRawProperty(source, NS + "graph", [{ "@list": [node] }]),
      /list container/,
    );
    await rejects(
      withRawProperty(source, NS + "graph", [
        { "@graph": [{ "@graph": [node] }] },
      ]),
      /graph wrapper/,
    );
    deepStrictEqual(source.labels, ["original"]);
    const ordered = await withRawProperty(source, NS + "ordered", list);
    deepStrictEqual(await getRawPropertyValues(ordered, NS + "ordered"), list);
    const graphed = await withRawProperty(source, NS + "graph", graph);
    deepStrictEqual(await getRawPropertyValues(graphed, NS + "graph"), graph);
    const parsed = await Base.fromJsonLd({
      "@type": [NS + "Base"],
      [NS + "label"]: list,
      [NS + "child"]: graph,
    });
    deepStrictEqual(parsed.labels, ["first", "second"]);
    strictEqual(parsed.childs[0].label, "child");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
