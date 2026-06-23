import assert from "node:assert/strict";
import test from "node:test";
import { formatJson } from "./utils.ts";

test("formatJson rejects deeply nested values", () => {
  let value: unknown = "leaf";
  for (let i = 0; i < 101; i++) value = { value };

  assert.throws(
    () => formatJson(value),
    new RangeError("Maximum depth exceeded while formatting JSON."),
  );
});
