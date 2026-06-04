import assert from "node:assert/strict";
import test from "node:test";
import { AssertionParseError, compare, parseAssertion } from "./assert.ts";

test("parseAssertion - normalizes percentages to ratios", () => {
  assert.deepEqual(parseAssertion(">= 99%"), {
    op: "gte",
    threshold: 0.99,
    unit: "%",
  });
});

test("parseAssertion - normalizes durations to milliseconds", () => {
  assert.deepEqual(parseAssertion("< 100ms"), {
    op: "lt",
    threshold: 100,
    unit: "ms",
  });
  assert.deepEqual(parseAssertion("< 2s"), {
    op: "lt",
    threshold: 2000,
    unit: "ms",
  });
});

test("parseAssertion - keeps rates per second and bare counts", () => {
  assert.deepEqual(parseAssertion(">= 500/s"), {
    op: "gte",
    threshold: 500,
    unit: "/s",
  });
  assert.deepEqual(parseAssertion("== 0"), {
    op: "eq",
    threshold: 0,
    unit: null,
  });
});

test("parseAssertion - rejects malformed assertions", () => {
  assert.throws(() => parseAssertion("abc"), AssertionParseError);
  assert.throws(() => parseAssertion(">="), AssertionParseError);
  assert.throws(() => parseAssertion("100ms"), AssertionParseError);
});

test("compare - all operators", () => {
  assert.ok(compare(1, "lt", 2));
  assert.ok(!compare(2, "lt", 2));
  assert.ok(compare(2, "lte", 2));
  assert.ok(compare(3, "gt", 2));
  assert.ok(compare(2, "gte", 2));
  assert.ok(compare(0, "eq", 0));
  assert.ok(!compare(1, "eq", 0));
});

test("compare - eq tolerance is opt-out for exact counts", () => {
  // Tolerant (default) absorbs float noise.
  assert.ok(compare(0.994, "eq", 0.9940000000000001));
  // Exact mode does not absorb a near-miss large count.
  assert.ok(!compare(1_000_000_001, "eq", 1_000_000_000, false));
  assert.ok(compare(1_000_000_000, "eq", 1_000_000_000, false));
});
