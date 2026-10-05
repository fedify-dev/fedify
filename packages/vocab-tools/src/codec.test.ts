import { deepStrictEqual, match, ok, rejects } from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { generateClasses } from "./class.ts";
import type { PropertySchema, TypeSchema } from "./schema.ts";

const NS = "https://example.com/";
const AS = "https://www.w3.org/ns/activitystreams";
const CONTEXT = `${NS}context`;
const XSD = "http://www.w3.org/2001/XMLSchema#";
const context = {
  type: "@type",
  id: "@id",
  Fixture: `${NS}Fixture`,
  Value: `${NS}Value`,
  label: `${NS}label`,
  value: `${NS}value`,
  first: `${NS}first`,
  second: `${NS}second`,
};

interface Instance {
  values: unknown[];
  value: unknown;
  toJsonLd(options?: Record<string, unknown>): Promise<Record<string, unknown>>;
}
interface FixtureClass {
  new (values?: Record<string, unknown>): Instance;
  fromJsonLd(
    document: unknown,
    options?: Record<string, unknown>,
  ): Promise<Instance>;
}

async function withFixture(
  options: Partial<PropertySchema>,
  run: (
    Fixture: FixtureClass,
    loader: (url: string) => Promise<unknown>,
    source: string,
  ) => Promise<void>,
) {
  const property = {
    singularName: "value",
    pluralName: "values",
    uri: `${NS}value`,
    compactName: "value",
    description: "A value.",
    range: [`${XSD}string`],
    redundantProperties: [
      { uri: `${NS}first`, compactName: "first" },
      { uri: `${NS}second`, compactName: "second" },
    ],
    ...options,
  } as PropertySchema;
  const terms: Record<string, unknown> = { ...context };
  for (const name of ["value", "first", "second"]) {
    const term: Record<string, unknown> = { "@id": `${NS}${name}` };
    if (
      property.range[0] === `${XSD}anyURI` ||
      property.range[0] === "fedify:absoluteIri"
    ) {
      term["@type"] = "@id";
    }
    if ("container" in property && property.container != null) {
      term["@container"] = `@${property.container}`;
    }
    terms[name] = term;
  }
  const loader = (url: string) => {
    if (url !== AS && url !== CONTEXT) {
      throw new Error(`Unexpected context: ${url}`);
    }
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: {
        "@context": url === AS ? { type: "@type", id: "@id" } : terms,
      },
    });
  };
  const types: Record<string, TypeSchema> = {
    [`${NS}Fixture`]: {
      name: "Fixture",
      uri: `${NS}Fixture`,
      compactName: "Fixture",
      entity: false,
      description: "A fixture.",
      defaultContext: [AS, CONTEXT] as unknown as TypeSchema["defaultContext"],
      properties: [property],
    },
    [`${NS}Value`]: {
      name: "Value",
      uri: `${NS}Value`,
      compactName: "Value",
      entity: false,
      description: "An embedded value.",
      defaultContext: [AS, CONTEXT] as unknown as TypeSchema["defaultContext"],
      properties: [{
        singularName: "label",
        functional: true,
        uri: `${NS}label`,
        compactName: "label",
        description: "A label.",
        range: [`${XSD}string`],
      }],
    },
  };
  const source = (await Array.fromAsync(generateClasses(types))).join("");
  const resolved = source.replace(
    /from\s+"([^"]+)"/g,
    (_, specifier: string) =>
      `from ${JSON.stringify(import.meta.resolve(specifier))}`,
  );
  const dir = await mkdtemp(join(tmpdir(), "fedify-codec-"));
  try {
    const file = join(dir, "fixture.mts");
    await writeFile(file, resolved);
    const { Fixture } = await import(pathToFileURL(file).href);
    await run(Fixture, loader, source);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const literal = (value: unknown) => ({ "@value": value });
const document = (properties: Record<string, unknown>) => ({
  "@type": [`${NS}Fixture`],
  ...properties,
});

test("redundant properties select the first non-empty entire set", async () => {
  await withFixture({}, async (Fixture, contextLoader) => {
    for (
      const [properties, expected] of [
        [{ [`${NS}first`]: [literal("a"), literal("b"), literal("a")] }, [
          "a",
          "b",
          "a",
        ]],
        [{ [`${NS}value`]: [], [`${NS}first`]: [literal("a")] }, ["a"]],
        [{ [`${NS}first`]: [], [`${NS}second`]: [literal("b")] }, ["b"]],
        [{ [`${NS}value`]: [literal("c")], [`${NS}first`]: [literal("a")] }, [
          "c",
        ]],
        [{ [`${NS}first`]: [literal("a")], [`${NS}second`]: [literal("b")] }, [
          "a",
        ]],
        [{}, []],
      ] as const
    ) {
      const parsed = await Fixture.fromJsonLd(document(properties), {
        contextLoader,
      });
      deepStrictEqual(parsed.values, expected);
    }
    const parsed = await Fixture.fromJsonLd({
      "@context": termsForRead(),
      type: "Fixture",
      alternate: ["a", "b", "a"],
    }, { contextLoader });
    deepStrictEqual(parsed.values, ["a", "b", "a"]);
  });
});

function termsForRead() {
  return { ...context, alternate: `${NS}first` };
}

test("redundant properties do not retry invalid canonical values", async () => {
  await withFixture({
    range: [
      `${XSD}string`,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
    ],
  }, async (Fixture, contextLoader) => {
    const parsed = await Fixture.fromJsonLd(
      document({
        [`${NS}value`]: [literal(42)],
        [`${NS}first`]: [literal("fallback")],
      }),
      { contextLoader },
    );
    deepStrictEqual(parsed.values, []);
  });
  await withFixture(
    { range: ["fedify:url"] },
    async (Fixture, contextLoader) => {
      const parsed = await Fixture.fromJsonLd(
        document({
          [`${NS}value`]: [literal("http://[")],
          [`${NS}first`]: [literal("https://example.com/fallback")],
        }),
        { contextLoader },
      );
      deepStrictEqual(parsed.values, []);
    },
  );
  await withFixture(
    { range: [`${XSD}anyURI`] },
    async (Fixture, contextLoader) => {
      await rejects(Fixture.fromJsonLd(
        document({
          [`${NS}value`]: [{ "@id": "http://[" }],
          [`${NS}first`]: [{ "@id": "https://example.com/fallback" }],
        }),
        { contextLoader },
      ));
    },
  );
});

for (const policy of [undefined, "all", "canonical"] as const) {
  test(`redundant properties write policy ${policy ?? "default"}`, async () => {
    await withFixture(
      { redundantPropertiesWrite: policy },
      async (Fixture, contextLoader) => {
        for (const values of [[], ["a"], ["a", "b", "a"]]) {
          const instance = new Fixture({ values });
          const compact = await instance.toJsonLd({
            format: "compact",
            contextLoader,
          });
          deepStrictEqual(await instance.toJsonLd({ contextLoader }), compact);
          const expanded = await instance.toJsonLd({
            format: "expand",
            contextLoader,
          }) as unknown as Record<string, unknown>[];
          for (const alias of ["first", "second"]) {
            if (policy === "canonical" || values.length === 0) {
              ok(!(alias in compact));
              ok(!(`${NS}${alias}` in expanded[0]));
            } else {
              deepStrictEqual(compact[alias], compact.value);
              deepStrictEqual(
                expanded[0][`${NS}${alias}`],
                expanded[0][`${NS}value`],
              );
            }
          }
          const custom = await instance.toJsonLd({
            format: "compact",
            contextLoader,
            context: { ...context, renamed: `${NS}value` },
          });
          deepStrictEqual(
            (await Fixture.fromJsonLd(custom, { contextLoader })).values,
            values,
          );
        }
        const aliasOnly = await Fixture.fromJsonLd(
          document({ [`${NS}first`]: [literal("read")] }),
          { contextLoader },
        );
        deepStrictEqual(aliasOnly.values, ["read"]);
      },
    );
  });
}

for (const container of ["list", "graph"] as const) {
  for (const policy of ["all", "canonical"] as const) {
    test(`redundant ${container} containers with ${policy} writes`, async () => {
      await withFixture({
        container,
        redundantPropertiesWrite: policy,
        range: container === "graph" ? [`${NS}Value`] : [`${XSD}string`],
      }, async (Fixture, contextLoader) => {
        const items = container === "list"
          ? [literal("a"), literal("b"), literal("a")]
          : [
            { "@type": [`${NS}Value`], [`${NS}label`]: [literal("a")] },
            { "@type": [`${NS}Value`], [`${NS}label`]: [literal("b")] },
          ];
        const set = container === "list"
          ? [{ "@list": items }]
          : items.map((item) => ({ "@graph": [item] }));
        const parsed = await Fixture.fromJsonLd(
          document({
            [`${NS}first`]: set,
            [`${NS}second`]: [{ "@list": [literal("other")] }],
          }),
          { contextLoader },
        );
        deepStrictEqual(
          container === "list"
            ? parsed.values
            : parsed.values.map((v) => (v as { label: string }).label),
          container === "list" ? ["a", "b", "a"] : ["a", "b"],
        );
        const instance = new Fixture({ values: parsed.values });
        const compact = await instance.toJsonLd({
          format: "compact",
          contextLoader,
        });
        if (container === "list" || policy === "all") {
          deepStrictEqual(await instance.toJsonLd({ contextLoader }), compact);
        } else {
          // Parsed children retain expanded caches in the heuristic path.
          const defaultOutput = await instance.toJsonLd({ contextLoader });
          const decoded = await Fixture.fromJsonLd(defaultOutput, {
            contextLoader,
          });
          deepStrictEqual(
            decoded.values.map((v) => (v as { label: string }).label),
            ["a", "b"],
          );
        }
        const expanded = await instance.toJsonLd({
          format: "expand",
          contextLoader,
        }) as unknown as Record<string, unknown>[];
        for (const alias of ["first", "second"]) {
          if (policy === "canonical") {
            ok(!(`${NS}${alias}` in expanded[0]));
            ok(!(alias in compact));
          } else {
            deepStrictEqual(
              expanded[0][`${NS}${alias}`],
              expanded[0][`${NS}value`],
            );
            deepStrictEqual(compact[alias], compact.value);
          }
        }
        const roundtrip = await Fixture.fromJsonLd(compact, { contextLoader });
        deepStrictEqual(
          container === "list"
            ? roundtrip.values
            : roundtrip.values.map((v) => (v as { label: string }).label),
          container === "list" ? ["a", "b", "a"] : ["a", "b"],
        );
        const empty = await Fixture.fromJsonLd(
          document({
            [`${NS}value`]: [{ [`@${container}`]: [] }],
            [`${NS}first`]: set,
          }),
          { contextLoader },
        );
        deepStrictEqual(empty.values, []);
      });
    });
  }
}

for (const functional of [false, true]) {
  test(`URI-only aliases and portable read keys (functional=${functional})`, async () => {
    for (const policy of ["all", "canonical"] as const) {
      await withFixture({
        ...(functional ? { functional: true } : {}),
        range: [`${XSD}anyURI`],
        redundantPropertiesWrite: policy,
        redundantProperties: [{ uri: `${NS}first` }],
      }, async (Fixture, contextLoader, source) => {
        ok(!source.includes("result[undefined]"));
        match(source, /PORTABLE_IRI_KEYS[^\n]+https:\/\/example.com\/first/);
        const url = new URL("https://example.com/object");
        const instance = new Fixture(
          functional ? { value: url } : { values: [url] },
        );
        const compact = await instance.toJsonLd({
          format: "compact",
          contextLoader,
        });
        deepStrictEqual(await instance.toJsonLd({ contextLoader }), compact);
        const expanded = await instance.toJsonLd({
          format: "expand",
          contextLoader,
        }) as unknown as Record<string, unknown>[];
        if (policy === "all") {
          deepStrictEqual(expanded[0][`${NS}first`], [{ "@id": url.href }]);
        } else ok(!(`${NS}first` in expanded[0]));
        const custom = await instance.toJsonLd({
          format: "compact",
          contextLoader,
          context: {
            type: "@type",
            Fixture: `${NS}Fixture`,
            value: { "@id": `${NS}value`, "@type": "@id" },
          },
        });
        if (policy === "all") {
          deepStrictEqual(custom[`${NS}first`], { "@id": url.href });
        } else {
          ok(!(`${NS}first` in custom));
        }
        const parsed = await Fixture.fromJsonLd(
          document({
            [`${NS}first`]: [{ "@id": "ap://did:key:z6Mkabc/objects/1" }],
          }),
          { contextLoader },
        );
        const value = functional ? parsed.value : parsed.values[0];
        ok(value instanceof URL);
        const cached = await parsed.toJsonLd({ contextLoader });
        deepStrictEqual(cached[`${NS}first`], [{
          "@id": "ap+ef61://did:key:z6Mkabc/objects/1",
        }]);
        const compactInput = await Fixture.fromJsonLd({
          "@context": [AS, CONTEXT],
          type: "Fixture",
          first: "ap://did:key:z6Mkabc/objects/1",
        }, { contextLoader });
        const compactCache = await compactInput.toJsonLd({ contextLoader });
        deepStrictEqual(
          compactCache.first,
          "ap+ef61://did:key:z6Mkabc/objects/1",
        );
      });
    }
  });
}

test("absolute IRIs are read from nodes and plain literals without a base", async () => {
  await withFixture({
    range: ["fedify:absoluteIri"],
    redundantPropertiesWrite: "canonical",
    redundantProperties: [{ uri: `${NS}first` }],
  }, async (Fixture, contextLoader, source) => {
    match(source, /PORTABLE_IRI_KEYS[^\n]+https:\/\/example.com\/value/);
    match(source, /PORTABLE_IRI_KEYS[^\n]+https:\/\/example.com\/first/);
    const values = [
      { "@id": "https://example.com/node" },
      literal("urn:example:literal"),
      { "@value": "https://example.com/any-uri", "@type": `${XSD}anyURI` },
      { "@value": "https://example.com/string", "@type": `${XSD}string` },
      // A context's default language tags uncoerced strings:
      { "@value": "https://example.com/tagged", "@language": "und" },
      // Relative IRIs are never resolved against the object's ID:
      { "@id": "CC-BY-4.0" },
      { "@id": "_:b0" },
      literal("Creative Commons Attribution 4.0 International"),
      { "@value": "https://example.com/date", "@type": `${XSD}date` },
    ];
    const expected = [
      new URL("https://example.com/node"),
      new URL("urn:example:literal"),
      new URL("https://example.com/any-uri"),
      new URL("https://example.com/string"),
      new URL("https://example.com/tagged"),
    ];
    for (const key of ["value", "first"]) {
      const parsed = await Fixture.fromJsonLd(
        {
          "@id": "https://example.com/objects/1",
          ...document({ [`${NS}${key}`]: values }),
        },
        { contextLoader, baseUrl: new URL("https://example.com/base/") },
      );
      deepStrictEqual(parsed.values, expected);
    }
    // An invalid canonical set is not replaced by a synonym:
    const invalid = await Fixture.fromJsonLd(
      document({
        [`${NS}value`]: [{ "@id": "CC-BY-4.0" }],
        [`${NS}first`]: [{ "@id": "https://example.com/fallback" }],
      }),
      { contextLoader },
    );
    deepStrictEqual(invalid.values, []);
    const instance = new Fixture({ values: expected });
    const expanded = await instance.toJsonLd({
      format: "expand",
      contextLoader,
    }) as unknown as Record<string, unknown>[];
    deepStrictEqual(
      expanded[0][`${NS}value`],
      expected.map((url) => ({ "@id": url.href })),
    );
    ok(!(`${NS}first` in expanded[0]));
    const compact = await instance.toJsonLd({
      format: "compact",
      contextLoader,
    });
    deepStrictEqual(compact.value, expected.map((url) => url.href));
  });
});
