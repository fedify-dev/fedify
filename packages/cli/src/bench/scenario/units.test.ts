import assert from "node:assert/strict";
import test from "node:test";
import { parseDuration, parseRate } from "./units.ts";

test("parseDuration - parses each unit", () => {
  assert.strictEqual(parseDuration("500ms"), 500);
  assert.strictEqual(parseDuration("30s"), 30_000);
  assert.strictEqual(parseDuration("2m"), 120_000);
  assert.strictEqual(parseDuration("1h"), 3_600_000);
  assert.strictEqual(parseDuration("1.5s"), 1500);
});

test("parseDuration - rejects invalid input", () => {
  assert.throws(() => parseDuration("30"), RangeError);
  assert.throws(() => parseDuration("abc"), RangeError);
  assert.throws(() => parseDuration("10 s"), RangeError);
});

test("parseRate - bare number is per second", () => {
  assert.strictEqual(parseRate(200), 200);
});

test("parseRate - parses each time unit", () => {
  assert.strictEqual(parseRate("200/s"), 200);
  assert.strictEqual(parseRate("60/m"), 1);
  assert.strictEqual(parseRate("3600/h"), 1);
  assert.strictEqual(parseRate("100 / s"), 100);
});

test("parseRate - rejects invalid or non-positive input", () => {
  assert.throws(() => parseRate("abc"), RangeError);
  assert.throws(() => parseRate("0"), RangeError);
  assert.throws(() => parseRate("0/s"), RangeError);
  assert.throws(() => parseRate(0), RangeError);
  assert.throws(() => parseRate(-5), RangeError);
});

test("parseRate/parseDuration - reject overflowing magnitudes", () => {
  assert.throws(() => parseRate(`${"9".repeat(400)}/s`), RangeError);
  assert.throws(() => parseDuration(`${"9".repeat(400)}h`), RangeError);
});
