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

test("formatJson serializes values with toJSON methods", () => {
  assert.equal(
    formatJson({
      stamp: new Date("2026-06-24T00:00:00.000Z"),
      custom: {
        toJSON: () => ({ value: "serialized" }),
      },
    }),
    '{\n  "stamp": "2026-06-24T00:00:00.000Z",\n  "custom": {\n    "value": "serialized"\n  }\n}\n',
  );
});

test("formatJson omits unserializable object property values", () => {
  assert.equal(
    formatJson({
      keep: "value",
      skipUndefined: undefined,
      skipFunction: () => "value",
      skipSymbol: Symbol("value"),
      array: [undefined, () => "value", Symbol("value")],
    }),
    '{\n  "keep": "value",\n  "array": [\n    null,\n    null,\n    null\n  ]\n}\n',
  );
});
