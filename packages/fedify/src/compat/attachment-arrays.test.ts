import { test } from "@fedify/fixture";
import { type DocumentLoader, preloadedContexts } from "@fedify/vocab-runtime";
import { assertEquals, assertStrictEquals } from "@std/assert";
import { normalizeAttachmentArrays } from "./attachment-arrays.ts";

const AS = "https://www.w3.org/ns/activitystreams";
const SEC = "https://w3id.org/security#";

test("attachment arrays: singleton, multiple, nested and expanded properties", async () => {
  const document = {
    "@context": AS,
    type: "Collection",
    items: [
      {
        type: "Note",
        attachment: { type: "Image", url: "https://example.com/a" },
      },
      {
        type: "Note",
        attachment: ["https://example.com/b", "https://example.com/c"],
      },
      { type: "Note", attachment: null },
      { type: "Note", [`${AS}#attachment`]: "https://example.com/d" },
    ],
  };
  const before = structuredClone(document);
  const result = await normalizeAttachmentArrays(document);
  assertEquals(result, {
    ...document,
    items: [
      { type: "Note", attachment: [document.items[0].attachment] },
      document.items[1],
      document.items[2],
      { type: "Note", [`${AS}#attachment`]: ["https://example.com/d"] },
    ],
  });
  assertEquals(document, before);
  assertStrictEquals(await normalizeAttachmentArrays(result), result);
});

test("attachment arrays: preserve lists, contexts and value objects", async () => {
  for (
    const document of [
      { "@context": AS, attachment: { "@list": ["https://example.com/a"] } },
      {
        "@context": AS,
        content: { "@value": { attachment: 1 }, "@type": "@json" },
      },
    ]
  ) {
    assertStrictEquals(await normalizeAttachmentArrays(document), document);
  }
});

test("attachment arrays: inline and remote contexts share one loader snapshot", async () => {
  let loads = 0;
  const loader: DocumentLoader = (url) => {
    loads++;
    return Promise.resolve({
      documentUrl: url,
      contextUrl: null,
      document: preloadedContexts[AS],
    });
  };
  const document = {
    "@context": "https://example.com/context",
    attachment: "https://example.com/a",
  };
  assertStrictEquals(await normalizeAttachmentArrays(document), document);
  assertEquals(await normalizeAttachmentArrays(document, loader), {
    ...document,
    attachment: [document.attachment],
  });
  assertEquals(loads, 1);
  const inline = {
    "@context": [AS, { schema: "http://schema.org/", value: "schema:value" }],
    attachment: { type: "Image" },
  };
  assertEquals(await normalizeAttachmentArrays(inline), {
    ...inline,
    attachment: [inline.attachment],
  });
});

test("attachment arrays: JSON literals and context redefinitions remain unchanged", async () => {
  for (
    const document of [
      {
        "@context": [AS, {
          attachment: { "@id": `${AS}#attachment`, "@type": "@json" },
        }],
        attachment: { type: "Image" },
      },
      {
        "@context": [AS, {
          payload: { "@id": "https://example.com/payload", "@type": "@json" },
        }],
        attachment: "https://example.com/a",
        payload: { attachment: { proof: "literal" } },
      },
      {
        "@context": [AS, "https://www.w3.org/ns/cid/v1"],
        attachment: "https://example.com/a",
        publicKeyJwk: { attachment: { type: "Image" } },
      },
      {
        "@context": [AS, null, {
          "@vocab": "https://example.com/",
          attachment: {
            "@id": "https://example.com/attachment",
            "@type": "@json",
          },
        }],
        attachment: { type: "Image" },
      },
    ]
  ) {
    assertStrictEquals(await normalizeAttachmentArrays(document), document);
  }
});

test("attachment arrays: language and index maps retain their semantics", async () => {
  for (const container of ["@language", "@index"]) {
    const document = {
      "@context": [AS, {
        attachment: { "@id": `${AS}#attachment`, "@container": container },
      }],
      attachment: container === "@language"
        ? { en: "example" }
        : { sample: { type: "Image" } },
    };
    assertStrictEquals(await normalizeAttachmentArrays(document), document);
  }
});

test("attachment arrays: scoped contexts cannot change literal payloads", async () => {
  const document = {
    "@context": [AS, {
      Special: {
        "@id": "https://example.com/Special",
        "@context": {
          attachment: { "@id": `${AS}#attachment`, "@type": "@json" },
        },
      },
    }],
    type: "Special",
    attachment: { type: "Image" },
  };
  assertStrictEquals(await normalizeAttachmentArrays(document), document);
});

test("attachment arrays: root proofs and signed siblings are immutable", async () => {
  const signed = Object.freeze({
    "@context": [AS, { proof: `${SEC}proof` }],
    attachment: "https://example.com/a",
    proof: Object.freeze({ id: "https://example.com/proof" }),
  });
  assertStrictEquals(await normalizeAttachmentArrays(signed), signed);
  const document = {
    "@context": AS,
    type: "Collection",
    items: [signed, { type: "Note", attachment: "https://example.com/b" }],
  };
  assertStrictEquals(await normalizeAttachmentArrays(document), document);
  for (const proof of [[], [{ proofValue: "one" }, { proofValue: "two" }]]) {
    const root = {
      "@context": [AS, { proof: `${SEC}proof` }],
      attachment: "https://example.com/a",
      proof,
    };
    assertStrictEquals(await normalizeAttachmentArrays(root), root);
  }
});

test("attachment arrays: semantic proof aliases preserve the whole document", async () => {
  for (const nested of [false, true]) {
    const document = {
      "@context": [AS, { seal: `${SEC}proof` }],
      attachment: "https://example.com/a",
      ...(nested
        ? { object: { seal: { "@id": "https://example.com/proof" } } }
        : { seal: { "@id": "https://example.com/proof" } }),
    };
    assertStrictEquals(await normalizeAttachmentArrays(document), document);
  }
  const literal = {
    "@context": AS,
    content: `<${SEC}proof>`,
    attachment: "https://example.com/a",
  };
  assertEquals(await normalizeAttachmentArrays(literal), {
    ...literal,
    attachment: [literal.attachment],
  });
});

test("attachment arrays: excessive depth and failing loaders preserve input", async () => {
  let document: unknown = { attachment: "https://example.com/a" };
  for (let i = 0; i < 70; i++) document = { object: document };
  assertStrictEquals(await normalizeAttachmentArrays(document), document);
  const custom = {
    "@context": "https://example.com/unavailable",
    attachment: "https://example.com/a",
  };
  assertStrictEquals(
    await normalizeAttachmentArrays(
      custom,
      () => Promise.reject(new Error("unavailable")),
    ),
    custom,
  );
});

test("attachment arrays: context-coerced security-shaped JSON is ordinary data", async () => {
  const data = { proof: { signature: "application data" } };
  const document = {
    "@context": [AS, {
      data: { "@id": "https://example.com/data", "@type": "@json" },
    }],
    attachment: "https://example.com/a",
    data,
  };
  const normalized = await normalizeAttachmentArrays(document);
  assertEquals(normalized, { ...document, attachment: [document.attachment] });
  assertEquals(document.data, data);
  let deep: unknown = { signature: "application data" };
  for (let i = 0; i < 70; i++) deep = { child: deep };
  const large = { ...document, data: deep };
  // Conservative traversal limits can skip normalization, never serialization.
  assertStrictEquals(await normalizeAttachmentArrays(large), large);
});

test("attachment arrays: root and nested semantic LD signatures block rewriting", async () => {
  for (const nested of [false, true]) {
    const document = {
      "@context": [AS, { seal: `${SEC}signature` }],
      attachment: "https://example.com/a",
      ...(nested
        ? { object: { seal: { "@id": "https://example.com/sig" } } }
        : { seal: { "@id": "https://example.com/sig" } }),
    };
    assertStrictEquals(await normalizeAttachmentArrays(document), document);
  }
});
