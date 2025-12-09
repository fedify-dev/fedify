/**
 * ESLint tests for actor-inbox-property-mismatch rule.
 */
import { test } from "node:test";
import { rules, RULE_IDS } from "../../eslint.ts";
import { runESLintTests } from "../../lib/test-eslint.ts";
import {
  createMismatchInvalidCases,
  createMismatchValidCases,
} from "../../lib/test-templates-eslint.ts";

const ruleName = RULE_IDS.actorInboxPropertyMismatch;
const rule = rules[ruleName];

test(`ESLint: ${ruleName}`, () => {
  runESLintTests(ruleName, rule, {
    valid: createMismatchValidCases("inbox"),
    invalid: createMismatchInvalidCases("inbox", "mismatch"),
  });
});
