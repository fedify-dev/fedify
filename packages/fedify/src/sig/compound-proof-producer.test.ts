import { test } from "@fedify/fixture";
import { assertEquals } from "@std/assert";
import {
  containsCompoundPortableObject,
  findUnsupportedCompoundProofShape,
  inspectCompoundPortableObjectApplicability,
} from "./compound-proof.ts";

const portableId = "ap+ef61://did:key:z6MkAlice/objects/1";
const proof = { type: "DataIntegrityProof", proofValue: "z" };

function nest(depth: number, leaf: Record<string, unknown>): unknown {
  let value: unknown = leaf;
  for (let i = 0; i < depth; i++) value = { type: "Note", content: value };
  return value;
}

test("containsCompoundPortableObject() finds portable maps", () => {
  const cases: [unknown, boolean][] = [
    [{ id: portableId }, true],
    [{ "@id": "AP://did:key:z6MkAlice/actor" }, true],
    [{ id: "https://example.com/1", object: [{}, { id: portableId }] }, true],
    [{ id: "https://example.com/1", actor: portableId }, false],
    [{ id: "https://example.com/1", proof: { id: portableId } }, false],
    [{ "@context": [{ id: portableId }], id: "https://example.com/1" }, false],
    [{ id: "https://example.com/1", object: { id: "ap-like" } }, false],
    [[{ id: portableId }], true],
    [null, false],
  ];
  for (const [json, expected] of cases) {
    assertEquals(containsCompoundPortableObject(json), expected, `${json}`);
  }
});

test("containsCompoundPortableObject() ignores the inbox limits", () => {
  const deep = nest(100, { id: portableId });
  const limits = {
    maxDepth: 64,
    maxMaps: 10_000,
    maxProofs: 32,
    maxBytes: 10 * 1024 * 1024,
  };
  assertEquals(
    inspectCompoundPortableObjectApplicability(deep, limits),
    "indeterminate",
  );
  assertEquals(containsCompoundPortableObject(deep), true);
  // An oversized document without portable maps stays outside the profile.
  const large = {
    id: "https://example.com/1",
    content: "x".repeat(11 * 1024 * 1024),
    proof: [proof, proof],
  };
  assertEquals(
    inspectCompoundPortableObjectApplicability(large, limits),
    "indeterminate",
  );
  assertEquals(containsCompoundPortableObject(large), false);
});

test("containsCompoundPortableObject() terminates on repeated maps", () => {
  const shared: Record<string, unknown> = { type: "Note" };
  const cyclic: Record<string, unknown> = { a: shared, b: shared };
  shared.parent = cyclic;
  assertEquals(containsCompoundPortableObject(cyclic), false);
  shared.id = portableId;
  assertEquals(containsCompoundPortableObject(cyclic), true);
});

test("findUnsupportedCompoundProofShape() reports non-map proofs", () => {
  const cases: [unknown, string | null][] = [
    [{ proof }, null],
    [{ proof: [proof, proof] }, "/proof"],
    [{ proof: [proof] }, "/proof"],
    [{ proof: [] }, "/proof"],
    [{ proof: null }, "/proof"],
    [{ proof: "z" }, "/proof"],
    [{ proof: 1 }, "/proof"],
    [{ proof: true }, "/proof"],
    [{ proof, object: { proof: [proof, proof] } }, "/object/proof"],
    [{ items: [{ proof }, { proof: [proof] }] }, "/items/1/proof"],
    [{ "a/b~c": { proof: [proof] } }, "/a~1b~0c/proof"],
    // Values inside a proof or a context are not secured maps.
    [{ proof: { ...proof, nested: { proof: [proof] } } }, null],
    [{ "@context": [{ proof: [proof] }] }, null],
    [{ object: { id: portableId } }, null],
  ];
  for (const [json, expected] of cases) {
    assertEquals(
      findUnsupportedCompoundProofShape(json),
      expected,
      JSON.stringify(json),
    );
  }
  assertEquals(
    findUnsupportedCompoundProofShape(nest(100, { proof: [proof, proof] })),
    "/content".repeat(100) + "/proof",
  );
});
