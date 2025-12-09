/**
 * ESLint tests for collection-filtering-not-implemented rule.
 */
import { test } from "node:test";
import { rules, RULE_IDS } from "../../eslint.ts";
import { runESLintTests } from "../../lib/test-eslint.ts";
import {
  createCollectionFilteringInvalidCases,
  createCollectionFilteringValidCases,
} from "../../lib/test-templates-eslint.ts";

const ruleName = RULE_IDS.collectionFilteringNotImplemented;
const rule = rules[ruleName];

test(`ESLint: ${ruleName}`, () => {
  runESLintTests(ruleName, rule, {
    valid: createCollectionFilteringValidCases(),
    invalid: createCollectionFilteringInvalidCases("filterRequired"),
  });
});
