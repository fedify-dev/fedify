/**
 * ESLint tests for actor-id-mismatch rule.
 */
import { test } from "node:test";
import { rules, RULE_IDS } from "../../eslint.ts";
import { runESLintTests } from "../../lib/test-eslint.ts";
import {
  createMismatchInvalidCases,
  createMismatchValidCases,
} from "../../lib/test-templates-eslint.ts";

const ruleName = RULE_IDS.actorIdMismatch;
const rule = rules[ruleName];

test(`ESLint: ${ruleName}`, () => {
  runESLintTests(ruleName, rule, {
    valid: createMismatchValidCases("id"),
    invalid: createMismatchInvalidCases("id", "mismatch"),
  });
});
