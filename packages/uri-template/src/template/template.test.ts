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
