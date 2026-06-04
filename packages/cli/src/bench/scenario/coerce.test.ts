import assert from "node:assert/strict";
import test from "node:test";
import { asList } from "./coerce.ts";

test("asList - wraps a scalar", () => {
  assert.deepEqual(asList("a"), ["a"]);
  assert.deepEqual(asList(42), [42]);
  assert.deepEqual(asList(false), [false]);
});

test("asList - copies a list", () => {
  const input = ["a", "b"];
  const output = asList(input);
  assert.deepEqual(output, ["a", "b"]);
  assert.notStrictEqual(output, input);
});

test("asList - empty for null and undefined", () => {
  assert.deepEqual(asList(undefined), []);
  assert.deepEqual(asList(null), []);
});
