import assert from "node:assert/strict";
import test from "node:test";
import { defaultHelpers } from "./helpers.ts";
import { renderTemplates, TemplateError } from "./template.ts";

const ctx = {
  values: { count: 3, target: { host: "example.com" }, name: "bob" },
  helpers: defaultHelpers(),
};

test("renderTemplates - whole expression keeps the raw value type", () => {
  assert.strictEqual(renderTemplates("${{ count }}", ctx), 3);
});

test("renderTemplates - resolves a dotted path", () => {
  assert.strictEqual(renderTemplates("${{ target.host }}", ctx), "example.com");
});

test("renderTemplates - interpolates inside surrounding text", () => {
  assert.strictEqual(
    renderTemplates("acct:alice@${{ target.host }}", ctx),
    "acct:alice@example.com",
  );
});

test("renderTemplates - interpolates multiple expressions", () => {
  assert.strictEqual(
    renderTemplates("${{ name }}-${{ count }}", ctx),
    "bob-3",
  );
});

test("renderTemplates - calls a helper, whole and embedded", () => {
  assert.strictEqual(renderTemplates("${{ upper('hi') }}", ctx), "HI");
  assert.strictEqual(renderTemplates("${{ upper(name) }}", ctx), "BOB");
  assert.strictEqual(renderTemplates("x=${{ upper(name) }}", ctx), "x=BOB");
});

test("renderTemplates - walks nested objects and arrays", () => {
  const input = {
    recipient: "acct:a@${{ target.host }}",
    counts: ["${{ count }}", "static"],
    nested: { who: "${{ name }}" },
  };
  assert.deepEqual(renderTemplates(input, ctx), {
    recipient: "acct:a@example.com",
    counts: [3, "static"],
    nested: { who: "bob" },
  });
});

test("renderTemplates - leaves non-template strings untouched", () => {
  assert.strictEqual(renderTemplates("plain text", ctx), "plain text");
  assert.strictEqual(renderTemplates("price: ${5}", ctx), "price: ${5}");
});

test("renderTemplates - non-string scalars pass through", () => {
  assert.strictEqual(renderTemplates(42, ctx), 42);
  assert.strictEqual(renderTemplates(true, ctx), true);
  assert.strictEqual(renderTemplates(null, ctx), null);
});

test("renderTemplates - unknown helper throws", () => {
  assert.throws(() => renderTemplates("${{ bogus() }}", ctx), TemplateError);
});

test("renderTemplates - unknown reference throws", () => {
  assert.throws(() => renderTemplates("${{ missing }}", ctx), TemplateError);
  assert.throws(
    () => renderTemplates("${{ target.nope }}", ctx),
    TemplateError,
  );
});

test("renderTemplates - empty expression throws", () => {
  assert.throws(() => renderTemplates("${{ }}", ctx), TemplateError);
});

test("renderTemplates - does not resolve prototype members", () => {
  assert.throws(() => renderTemplates("${{ toString }}", ctx), TemplateError);
  assert.throws(
    () => renderTemplates("${{ constructor }}", ctx),
    TemplateError,
  );
  assert.throws(() => renderTemplates("${{ __proto__ }}", ctx), TemplateError);
  assert.throws(() => renderTemplates("${{ toString() }}", ctx), TemplateError);
});

test("renderTemplates - does not discard trailing text after a match", () => {
  assert.strictEqual(
    renderTemplates("${{ name }} trailing }}", ctx),
    "bob trailing }}",
  );
});

test("renderTemplates - throws on an unclosed expression", () => {
  assert.throws(() => renderTemplates("hello ${{ name", ctx), TemplateError);
  assert.throws(
    () => renderTemplates("${{ name }} and ${{ count", ctx),
    TemplateError,
  );
});

test("renderTemplates - throws on an unbalanced quote in arguments", () => {
  assert.throws(
    () => renderTemplates("${{ upper('hi) }}", ctx),
    TemplateError,
  );
});

test("defaultHelpers - uuid returns a UUID string", () => {
  const value = renderTemplates("${{ uuid() }}", ctx) as string;
  assert.match(
    value,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
});

test("renderTemplates - rejects pathologically deep nesting", () => {
  let deep: unknown = "leaf";
  for (let i = 0; i < 200; i++) deep = { nested: deep };
  assert.throws(() => renderTemplates(deep, ctx), TemplateError);
});

test("renderTemplates - returns the same reference for unchanged subtrees", () => {
  const value = { a: { b: "no expressions here" }, list: [1, 2] };
  assert.strictEqual(renderTemplates(value, ctx), value);
});
