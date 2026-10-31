import assert from "node:assert/strict";
import test from "node:test";
import { choiceKvStore } from "./kv.ts";
import { choiceMessageQueue } from "./mq.ts";

test("choiceKvStore labels denokv as deprecated", () => {
  assert.deepStrictEqual(choiceKvStore("deno")("denokv"), {
    name: "denokv (deprecated)",
    value: "denokv",
    disabled: false,
  });
});

test("choiceKvStore combines deprecation and incompatibility", () => {
  assert.deepStrictEqual(choiceKvStore("npm")("denokv"), {
    name: "denokv (deprecated)",
    value: "denokv",
    disabled: "(not supported with npm)",
  });
});

test("choiceKvStore leaves supported stores unlabeled", () => {
  assert.deepStrictEqual(choiceKvStore("npm")("redis"), {
    name: "redis",
    value: "redis",
    disabled: false,
  });
});

test("choiceMessageQueue labels denokv as deprecated", () => {
  assert.deepStrictEqual(choiceMessageQueue("deno")("denokv"), {
    name: "denokv (deprecated)",
    value: "denokv",
    disabled: false,
  });
});

test("choiceMessageQueue combines deprecation and incompatibility", () => {
  assert.deepStrictEqual(choiceMessageQueue("npm")("denokv"), {
    name: "denokv (deprecated)",
    value: "denokv",
    disabled: "(not supported with npm)",
  });
});

test("choiceMessageQueue leaves supported stores unlabeled", () => {
  assert.deepStrictEqual(choiceMessageQueue("npm")("in-process"), {
    name: "in-process",
    value: "in-process",
    disabled: false,
  });
});
