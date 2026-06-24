import assert from "node:assert/strict";
import test from "node:test";
import {
  type GenerateDirective,
  isGenerateDirective,
  parseSize,
  resolveGenerate,
} from "./generate.ts";

test("parseSize - bare number is bytes", () => {
  assert.strictEqual(parseSize(512), 512);
  assert.strictEqual(parseSize("512"), 512);
});

test("parseSize - binary units", () => {
  assert.strictEqual(parseSize("2KB"), 2048);
  assert.strictEqual(parseSize("1KiB"), 1024);
  assert.strictEqual(parseSize("1.5MB"), Math.floor(1.5 * 1024 * 1024));
  assert.strictEqual(parseSize("1GB"), 1024 ** 3);
});

test("parseSize - case-insensitive and whitespace-tolerant", () => {
  assert.strictEqual(parseSize("10 mb"), 10 * 1024 * 1024);
  assert.strictEqual(parseSize("  4kb  "), 4096);
});

test("parseSize - rejects invalid and negative values", () => {
  assert.throws(() => parseSize("abc"), RangeError);
  assert.throws(() => parseSize("2 tb"), RangeError);
  assert.throws(() => parseSize(-5), RangeError);
  assert.throws(() => parseSize("-5"), RangeError);
});

test("parseSize - rejects values beyond the safe integer range", () => {
  assert.throws(() => parseSize("9999999999999999999 gb"), RangeError);
  assert.throws(() => parseSize(1e30), RangeError);
});

test("isGenerateDirective - distinguishes directives from literals", () => {
  assert.ok(isGenerateDirective({ generate: "lorem" }));
  assert.ok(isGenerateDirective({ generate: "lorem", size: "2KB" }));
  assert.ok(!isGenerateDirective("plain string"));
  assert.ok(!isGenerateDirective({}));
  assert.ok(!isGenerateDirective(null));
  assert.ok(!isGenerateDirective(["lorem"]));
  // An inherited `generate` does not count; only own properties do.
  assert.ok(!isGenerateDirective(Object.create({ generate: "lorem" })));
});

test("resolveGenerate - lorem produces exact byte size", () => {
  const directive: GenerateDirective = { generate: "lorem", size: "100" };
  const out = resolveGenerate(directive);
  assert.strictEqual(out.length, 100);
  // Deterministic across calls.
  assert.strictEqual(resolveGenerate(directive), out);
});

test("resolveGenerate - lorem fills sizes larger than the corpus", () => {
  const out = resolveGenerate({ generate: "lorem", size: "4KB" });
  assert.strictEqual(out.length, 4096);
});

test("resolveGenerate - zero or missing size yields empty string", () => {
  assert.strictEqual(resolveGenerate({ generate: "lorem", size: 0 }), "");
  assert.strictEqual(resolveGenerate({ generate: "lorem" }), "");
});

test("resolveGenerate - unknown generator throws", () => {
  assert.throws(
    () => resolveGenerate({ generate: "markov" }),
    RangeError,
  );
});

test("resolveGenerate - rejects an oversized payload", () => {
  // Guards against memory exhaustion / String.repeat overflow from a huge size.
  // `parseSize` still parses the units; the limit applies when generating.
  assert.strictEqual(parseSize("1GB"), 1024 ** 3);
  assert.throws(
    () => resolveGenerate({ generate: "lorem", size: "200MB" }),
    RangeError,
  );
  // The maximum (100 MiB) itself is still produced.
  assert.strictEqual(
    resolveGenerate({ generate: "lorem", size: "100MB" }).length,
    100 * 1024 * 1024,
  );
});
