/**
 * ESLint tests for actor-following-property-required rule.
 */
import { test } from "node:test";
import { rules, RULE_IDS } from "../../eslint.ts";
import { runESLintTests } from "../../lib/test-eslint.ts";
import {
  createRequiredInvalidCases,
  createRequiredValidCases,
} from "../../lib/test-templates-eslint.ts";

const ruleName = RULE_IDS.actorFollowingPropertyRequired;
const rule = rules[ruleName];

test(`ESLint: ${ruleName}`, () => {
  runESLintTests(ruleName, rule, {
    valid: createRequiredValidCases("following"),
    invalid: createRequiredInvalidCases("following", "required"),
  });
});
