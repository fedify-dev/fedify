import { test } from "@fedify/fixture";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import {
  createFixedTemplateMatchTest,
  createFixedTemplateTest,
  createMatchOnlyTest,
  createTemplateHardTest,
  createTemplateMatchHardTest,
  createTemplateMatchTest,
  createTemplatePairTest,
  createWrongTemplateTest,
  fixedTestSuites,
  hardTestSuites,
  matchTestSuites,
  pairTestSuites,
  wrongTestSuites,
} from "../tests/mod.ts";
import {
  EmptyExpressionError,
  InvalidLiteralError,
  InvalidPrefixError,
  PrefixModifierNotApplicableError,
  ReservedOperatorError,
  UnclosedExpressionError,
} from "./errors.ts";
import Template from "./template.ts";

const runPairCases = createTemplatePairTest(Template);
test("expand: examples", runPairCases(pairTestSuites));

const runFixedCases = createFixedTemplateTest(Template);
test("expand: fixed templates", runFixedCases(fixedTestSuites));

const runWrongCases = createWrongTemplateTest(Template);
test("parse: invalid templates", runWrongCases(wrongTestSuites));

const runHardCases = createTemplateHardTest(Template);
test("expand: hard cases", runHardCases(hardTestSuites));

const runMatchCases = createTemplateMatchTest(Template);
test("match: examples", runMatchCases(pairTestSuites));

const runFixedMatchCases = createFixedTemplateMatchTest(Template);
test("match: fixed templates", runFixedMatchCases(fixedTestSuites));

const runHardMatchCases = createTemplateMatchHardTest(Template);
for (const { name, cases } of hardTestSuites) {
  test(`match: ${name}`, runHardMatchCases(cases));
}

const runMatchOnlyCases = createMatchOnlyTest(Template);
test("match-only", runMatchOnlyCases(matchTestSuites));

test("throws parse errors in strict mode", () => {
  throws(() => new Template("{var"), UnclosedExpressionError);
  throws(() => new Template("bad literal"), InvalidLiteralError);
  throws(() => new Template("{=var}"), ReservedOperatorError);
  throws(() => new Template("{var:0}"), InvalidPrefixError);
});

test("reports expression parse errors once in strict mode", () => {
  const errors: Error[] = [];

  throws(
    () => new Template("{}", { report: (error: Error) => errors.push(error) }),
    EmptyExpressionError,
  );
  equal(errors.length, 1);
  equal(errors[0] instanceof EmptyExpressionError, true);
});

test("reports parse errors without throwing in non-strict mode", () => {
  const errors: Error[] = [];
  const template = new Template("{=bad}/{ok}", {
    strict: false,
    report: (error: Error) => errors.push(error),
  });

  equal(template.expand({ ok: "value" }), "{=bad}/value");
  equal(errors.length, 1);
  equal(errors[0] instanceof ReservedOperatorError, true);
});

test("reports expansion errors without throwing in non-strict mode", () => {
  const errors: Error[] = [];
  const template = new Template("{list:3}/{ok}", {
    strict: false,
    report: (error: Error) => errors.push(error),
  });

  equal(template.expand({ list: ["red"], ok: "value" }), "/value");
  equal(errors.length, 1);
  equal(errors[0] instanceof PrefixModifierNotApplicableError, true);
});

test("parses reusable template instances", () => {
  const template = Template.parse("/mapper{?address*}");
  equal(
    template.expand({ address: { city: "Newport Beach", state: "CA" } }),
    "/mapper?city=Newport%20Beach&state=CA",
  );
  deepEqual(template.tokens, [
    { kind: "literal", text: "/mapper" },
    {
      kind: "expression",
      operator: "?",
      vars: [{ name: "address", explode: true }],
    },
  ]);
});

// Regression for the `consumeUnnamed` minLength bug: when an unnamed expression
// has more separated parts than variables, the matcher must let the *current*
// variable absorb fewer parts than the naive `parts - remainingVars` formula
// allows.  With `{x:5,y}` against `abc,def,ghi` the only round-trippable
// binding has x consume one part (so prefix:5 truncation does not corrupt the
// joined string); under the buggy minLength formula the matcher only reaches
// the fallback `x undefined, y absorbs everything` decomposition, leaving
// `m.x` undefined.
test("Template#match — unnamed minLength must allow current var to consume one part", () => {
  const template = new Template("{x:5,y}");
  const m = template.match("abc,def,ghi");

  ok(m != null, "matcher returned null for a round-trippable URI");
  equal(template.expand(m), "abc,def,ghi");
  equal(
    m.x,
    "abc",
    "matcher should reach the binding with x consuming one part",
  );
});

// Regression for PR #758 review item 36: `expand` encodes associative keys
// with the full unreserved/reserved set, but `isExplodedPairBoundary` in
// match.ts uses RFC 6570 varname rules to detect the next key. Keys that are
// valid in URIs but outside the varname class (e.g. containing `-` or `~`)
// expand cleanly yet fail to round-trip.
test("Template#match — associative keys with non-varname characters round-trip", () => {
  const template = new Template("{keys*}");
  const uri = template.expand({ keys: { a: "1", "b-c": "2" } });
  equal(uri, "a=1,b-c=2");
  const m = template.match(uri);
  ok(m != null, "matcher returned null for a round-trippable exploded URI");
  deepEqual(m, { keys: { a: "1", "b-c": "2" } });
});

// Regression for PR #758 review item 37: the *wrong.json* fixtures for
// "Invalid characters in literals" store double-escaped sequences such as
// "\\u0000", which JSON-decode to 6-character backslash strings rather than
// the 1-byte control characters they claim to test. The parser does reject
// actual CTL bytes — this test pins that behavior directly, so future
// refactors cannot silently regress on the CTL branch.
test("Template — actual control-character literals throw InvalidLiteralError", () => {
  for (const codePoint of [0x00, 0x01, 0x09, 0x0a, 0x0d, 0x1f, 0x7f]) {
    throws(
      () => new Template(String.fromCodePoint(codePoint)),
      InvalidLiteralError,
      `code point 0x${
        codePoint.toString(16).padStart(2, "0")
      } should be rejected`,
    );
  }
});
