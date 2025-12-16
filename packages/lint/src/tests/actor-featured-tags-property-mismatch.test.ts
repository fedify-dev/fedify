import { test } from "node:test";
import { RULE_IDS } from "../lib/const.ts";
import {
  createMismatchEdgeCaseTests,
  createMismatchRuleTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-featured-tags-property-mismatch.ts";

const ruleName = RULE_IDS.actorFeaturedTagsPropertyMismatch;

const config = { rule, ruleName };

// Standard mismatch rule tests
const tests = createMismatchRuleTests("featuredTags", config);
test(
  `${ruleName}: ✅ Good - non-Federation object`,
  tests["non-federation object"],
);
test(
  `${ruleName}: ✅ Good - correct getter used`,
  tests["correct getter used"],
);
test(
  `${ruleName}: ✅ Good - property not present`,
  tests["property not present"],
);
test(`${ruleName}: ❌ Bad - wrong getter used`, tests["wrong getter used"]);
test(`${ruleName}: ❌ Bad - wrong identifier`, tests["wrong identifier"]);

// Edge case tests
const edgeCases = createMismatchEdgeCaseTests("featuredTags", config);
test(
  `${ruleName}: ✅ Edge - ternary with correct getter in both branches`,
  edgeCases["ternary with correct getter in both branches"],
);
test(
  `${ruleName}: ❌ Edge - ternary with wrong getter in consequent`,
  edgeCases["ternary with wrong getter in consequent"],
);
test(
  `${ruleName}: ❌ Edge - ternary with wrong getter in alternate`,
  edgeCases["ternary with wrong getter in alternate"],
);
test(
  `${ruleName}: ❌ Edge - ternary with wrong getter in both branches`,
  edgeCases["ternary with wrong getter in both branches"],
);
test(
  `${ruleName}: ✅ Edge - nested ternary with correct getter`,
  edgeCases["nested ternary with correct getter"],
);
test(
  `${ruleName}: ✅ Edge - if/else with correct getter in both branches`,
  edgeCases["if else with correct getter in both branches"],
);
test(
  `${ruleName}: ❌ Edge - if/else with wrong getter in if block`,
  edgeCases["if else with wrong getter in if block"],
);
test(
  `${ruleName}: ❌ Edge - if/else with wrong getter in else block`,
  edgeCases["if else with wrong getter in else block"],
);
test(
  `${ruleName}: ❌ Edge - if/else with wrong getter in both blocks`,
  edgeCases["if else with wrong getter in both blocks"],
);
test(
  `${ruleName}: ✅ Edge - nested if with correct getter`,
  edgeCases["nested if with correct getter"],
);
test(
  `${ruleName}: ✅ Edge - if else if else with correct getter in all branches`,
  edgeCases["if else if else with correct getter in all branches"],
);
test(
  `${ruleName}: ❌ Edge - if else if else with wrong getter in else if`,
  edgeCases["if else if else with wrong getter in else if"],
);
test(
  `${ruleName}: ✅ Edge - if else if with final return correct getter in all paths`,
  edgeCases["if else if with final return correct getter in all paths"],
);
test(
  `${ruleName}: ❌ Edge - if else if with final return wrong getter in final return`,
  edgeCases["if else if with final return wrong getter in final return"],
);
