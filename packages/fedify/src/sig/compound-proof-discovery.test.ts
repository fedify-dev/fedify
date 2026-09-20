import { test } from "@fedify/fixture";
import { assertEquals } from "@std/assert";
import vector from "../../test-vectors/fep-8b32/map-local-create-note.json" with {
  type: "json",
};
import {
  type CompoundProofDiscoveryLimits,
  discoverCompoundProofDocuments,
} from "./compound-proof.ts";

const limits: CompoundProofDiscoveryLimits = {
  maxDepth: 16,
  maxMaps: 32,
  maxProofs: 8,
  maxBytes: 16_384,
};

test("discoverCompoundProofDocuments() returns immutable deepest-first candidates", () => {
  const input = {
    id: "ap://example.test/activities/1",
    object: {
      id: "ap://example.test/objects/1",
      content: "one",
      proof: { type: "DataIntegrityProof", proofValue: "zInner" },
    },
    items: [{
      id: "ap://example.test/objects/2",
      content: "two",
      proof: { type: "DataIntegrityProof", proofValue: "zArray" },
    }],
    "a/b~c": {
      "@id": "ap://example.test/objects/3",
      proof: { type: "DataIntegrityProof", proofValue: "zEscaped" },
    },
    proof: {
      type: "DataIntegrityProof",
      proofValue: "zOuter",
      proof: { type: "DataIntegrityProof", proofValue: "zNotADocument" },
    },
  };
  const before = structuredClone(input);
  const result = discoverCompoundProofDocuments(input, limits);

  assertEquals(input, before);
  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assertEquals(
    result.documents.map(({ path, id, depth }) => ({ path, id, depth })),
    [
      {
        path: "/items/0",
        id: "ap://example.test/objects/2",
        depth: 2,
      },
      {
        path: "/a~1b~0c",
        id: "ap://example.test/objects/3",
        depth: 1,
      },
      {
        path: "/object",
        id: "ap://example.test/objects/1",
        depth: 1,
      },
      {
        path: "",
        id: "ap://example.test/activities/1",
        depth: 0,
      },
    ],
  );
  assertEquals(result.documents[0].securedDocument, input.items[0]);
  assertEquals(result.documents[0].proof, input.items[0].proof);
  assertEquals(result.statistics.proofCount, 4);

  input.items[0].content = "mutated after discovery";
  assertEquals(
    result.documents[0].securedDocument.content,
    "two",
  );
  assertEquals(
    (result.snapshot.items as Record<string, unknown>[])[0].content,
    "two",
  );
});

test("discoverCompoundProofDocuments() is independent of member order", () => {
  const first = {
    z: { id: "z", proof: { proofValue: "z" } },
    a: { id: "a", proof: { proofValue: "a" } },
    proof: { proofValue: "root" },
  };
  const second = {
    proof: { proofValue: "root" },
    a: { proof: { proofValue: "a" }, id: "a" },
    z: { proof: { proofValue: "z" }, id: "z" },
  };

  const firstResult = discoverCompoundProofDocuments(first, limits);
  const secondResult = discoverCompoundProofDocuments(second, limits);
  assertEquals(firstResult.status, "ok");
  assertEquals(secondResult.status, "ok");
  if (firstResult.status !== "ok" || secondResult.status !== "ok") return;
  assertEquals(
    firstResult.documents.map((candidate) => candidate.path),
    ["/a", "/z", ""],
  );
  assertEquals(
    secondResult.documents.map((candidate) => candidate.path),
    ["/a", "/z", ""],
  );
});

test("discoverCompoundProofDocuments() preserves the recorded compound vector", () => {
  const result = discoverCompoundProofDocuments(
    vector.documents.finalSecuredCompound,
    limits,
  );

  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assertEquals(
    result.documents.map(({ path }) => path),
    ["/object", ""],
  );
  assertEquals(
    result.documents[0].securedDocument,
    vector.documents.securedInner,
  );
  assertEquals(
    result.documents[1].securedDocument,
    vector.documents.finalSecuredCompound,
  );
});

test("discoverCompoundProofDocuments() rejects unsupported proof shapes atomically", () => {
  for (const proof of [null, "remote-proof", [{ proofValue: "z" }]]) {
    const result = discoverCompoundProofDocuments({
      object: { proof: { proofValue: "valid candidate" } },
      other: { proof },
    }, limits);
    assertEquals(result, {
      status: "unsupported",
      reason: {
        type: "unsupportedProofShape",
        path: "/other/proof",
      },
    });
  }
});

test("discoverCompoundProofDocuments() applies resource limits atomically", () => {
  const cases = [
    {
      input: { child: { child: { proof: {} } } },
      limits: { ...limits, maxDepth: 1 },
      limit: "depth",
      maximum: 1,
    },
    {
      input: { first: {}, second: { proof: {} } },
      limits: { ...limits, maxMaps: 2 },
      limit: "maps",
      maximum: 2,
    },
    {
      input: { first: { proof: {} }, second: { proof: {} } },
      limits: { ...limits, maxProofs: 1 },
      limit: "proofs",
      maximum: 1,
    },
    {
      input: { content: "too large", proof: {} },
      limits: { ...limits, maxBytes: 8 },
      limit: "bytes",
      maximum: 8,
    },
  ] as const;

  for (const fixture of cases) {
    const result = discoverCompoundProofDocuments(
      fixture.input,
      fixture.limits,
    );
    assertEquals(result.status, "unsupported");
    if (result.status !== "unsupported") continue;
    assertEquals(result.reason.type, "limitExceeded");
    if (result.reason.type !== "limitExceeded") continue;
    assertEquals(result.reason.limit, fixture.limit);
    assertEquals(result.reason.maximum, fixture.maximum);
  }
});

test("discoverCompoundProofDocuments() rejects values that are not JSON trees", () => {
  const cyclic: Record<string, unknown> = { proof: {} };
  cyclic.self = cyclic;
  const shared = { proof: {} };

  for (
    const input of [
      [],
      { value: undefined },
      { value: Number.NaN },
      cyclic,
      { first: shared, second: shared },
    ]
  ) {
    const result = discoverCompoundProofDocuments(input, limits);
    assertEquals(result.status, "unsupported");
    if (result.status !== "unsupported") continue;
    assertEquals(result.reason.type, "invalidJsonTree");
  }
});

test("discoverCompoundProofDocuments() handles wide JSON containers", () => {
  const input = { values: new Array(200_000).fill(0) };
  const result = discoverCompoundProofDocuments(input, {
    maxDepth: 2,
    maxMaps: 1,
    maxProofs: 0,
    maxBytes: 1_048_576,
  });

  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assertEquals(result.statistics.byteLength, JSON.stringify(input).length);
});

test("discoverCompoundProofDocuments() rejects accessors without invoking them", () => {
  let getterCalls = 0;
  const accessorMap = {};
  Object.defineProperty(accessorMap, "object", {
    enumerable: true,
    get() {
      getterCalls++;
      return { proof: {} };
    },
  });
  const accessorArray = [{}];
  Object.defineProperty(accessorArray, 0, {
    enumerable: true,
    get() {
      getterCalls++;
      return { proof: {} };
    },
  });

  for (const input of [accessorMap, { items: accessorArray }]) {
    const result = discoverCompoundProofDocuments(input, limits);
    assertEquals(result.status, "unsupported");
    if (result.status !== "unsupported") continue;
    assertEquals(result.reason.type, "invalidJsonTree");
  }
  assertEquals(getterCalls, 0);
});

test("discoverCompoundProofDocuments() rejects non-enumerable map properties", () => {
  const input = {};
  Object.defineProperty(input, "proof", {
    value: {},
    enumerable: false,
  });

  const result = discoverCompoundProofDocuments(input, limits);
  assertEquals(result.status, "unsupported");
  if (result.status !== "unsupported") return;
  assertEquals(result.reason.type, "invalidJsonTree");
});

test("discoverCompoundProofDocuments() rejects non-JSON array properties", () => {
  const namedProperty = Object.assign([], {
    extra: { proof: {} },
  });
  const sparse = new Array(2);
  sparse[1] = null;
  const nonEnumerableIndex: unknown[] = [];
  Object.defineProperty(nonEnumerableIndex, 0, {
    value: { proof: {} },
    enumerable: false,
  });

  for (
    const input of [
      { items: namedProperty },
      { items: sparse },
      { items: nonEnumerableIndex },
    ]
  ) {
    const result = discoverCompoundProofDocuments(input, limits);
    assertEquals(result.status, "unsupported");
    if (result.status !== "unsupported") continue;
    assertEquals(result.reason.type, "invalidJsonTree");
  }
});
