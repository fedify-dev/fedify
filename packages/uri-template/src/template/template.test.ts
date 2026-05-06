import { test } from "@fedify/fixture";
import { deepEqual, equal } from "node:assert";
import { throws } from "node:assert/strict";
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
  InvalidLiteralError,
  InvalidPrefixError,
  PrefixModifierNotApplicableError,
  ReservedOperatorError,
  UnclosedExpressionError,
} from "./errors.ts";
import Template from "./template.ts";

const runPairCases = createTemplatePairTest(Template);
for (const { name, cases } of pairTestSuites) {
  test(name, runPairCases(cases as unknown as readonly [string, string][]));
}

const runFixedCases = createFixedTemplateTest(Template);
for (const { template, name, cases } of fixedTestSuites) {
  test(name, runFixedCases(template)(cases));
}

const runWrongCases = createWrongTemplateTest(Template);
for (const { name, cases } of wrongTestSuites) {
  test(name, runWrongCases(cases));
}

const runHardCases = createTemplateHardTest(Template);
for (const { name, cases } of hardTestSuites) {
  test(name, runHardCases(cases));
}

const runMatchCases = createTemplateMatchTest(Template);
for (const { name, cases } of pairTestSuites) {
  test(
    `match: ${name}`,
    runMatchCases(cases as unknown as readonly [string, string][]),
  );
}

const runFixedMatchCases = createFixedTemplateMatchTest(Template);
for (const { template, name, cases } of fixedTestSuites) {
  test(`match: ${name}`, runFixedMatchCases(template)(cases));
}

const runHardMatchCases = createTemplateMatchHardTest(Template);
for (const { name, cases } of hardTestSuites) {
  test(`match: ${name}`, runHardMatchCases(cases));
}

const runMatchOnlyCases = createMatchOnlyTest(Template);
for (const { name, cases } of matchTestSuites) {
  test(`match-only: ${name}`, runMatchOnlyCases(cases));
}

test("throws parse errors in strict mode", () => {
  throws(() => new Template("{var"), UnclosedExpressionError);
  throws(() => new Template("bad literal"), InvalidLiteralError);
  throws(() => new Template("{=var}"), ReservedOperatorError);
  throws(() => new Template("{var:0}"), InvalidPrefixError);
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

test("uses explicit expand options when provided", () => {
  const errors: Error[] = [];
  const template = new Template("{list:3}/{ok}");

  equal(
    template.expand(
      { list: ["red"], ok: "value" },
      { strict: false, report: (error: Error) => errors.push(error) },
    ),
    "/value",
  );
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
