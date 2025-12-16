import { test } from "node:test";
import { RULE_IDS } from "../lib/const.ts";
import {
  createIdRequiredEdgeCaseTests,
  createIdRequiredRuleTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-id-required.ts";

const ruleName = RULE_IDS.actorIdRequired;
const config = { rule, ruleName };

// Standard id required rule tests
const tests = createIdRequiredRuleTests(config);
test(
  `${ruleName}: ✅ Good - non-federation object`,
  tests["non-federation object"],
);
test(
  `${ruleName}: ✅ Good - with id property any value`,
  tests["with id property any value"],
);
test(
  `${ruleName}: ✅ Good - with id property using getActorUri`,
  tests["with id property using getActorUri"],
);
test(
  `${ruleName}: ✅ Good - block statement with id`,
  tests["block statement with id"],
);
test(`${ruleName}: ❌ Bad - without id property`, tests["without id property"]);
test(
  `${ruleName}: ❌ Bad - returning empty object`,
  tests["returning empty object"],
);
test(
  `${ruleName}: ✅ Good - multiple properties including id`,
  tests["multiple properties including id"],
);
test(
  `${ruleName}: ❌ Bad - variable assignment without id`,
  tests["variable assignment without id"],
);

// Edge case tests
const edgeCases = createIdRequiredEdgeCaseTests(config);
test(
  `${ruleName}: ✅ Edge - ternary with id in both branches`,
  edgeCases["ternary with id in both branches"],
);
test(
  `${ruleName}: ❌ Edge - ternary missing id in consequent`,
  edgeCases["ternary missing id in consequent"],
);
test(
  `${ruleName}: ❌ Edge - ternary missing id in alternate`,
  edgeCases["ternary missing id in alternate"],
);
test(
  `${ruleName}: ❌ Edge - ternary missing id in both branches`,
  edgeCases["ternary missing id in both branches"],
);
test(
  `${ruleName}: ✅ Edge - nested ternary with id`,
  edgeCases["nested ternary with id"],
);
test(
  `${ruleName}: ✅ Edge - if/else with id in both branches`,
  edgeCases["if else with id in both branches"],
);
test(
  `${ruleName}: ❌ Edge - if/else missing id in if block`,
  edgeCases["if else missing id in if block"],
);
test(
  `${ruleName}: ❌ Edge - if/else missing id in else block`,
  edgeCases["if else missing id in else block"],
);
test(
  `${ruleName}: ❌ Edge - if/else missing id in both blocks`,
  edgeCases["if else missing id in both blocks"],
);
test(
  `${ruleName}: ✅ Edge - nested if with id`,
  edgeCases["nested if with id"],
);
test(
  `${ruleName}: ✅ Edge - if else if else with id in all branches`,
  edgeCases["if else if else with id in all branches"],
);
test(
  `${ruleName}: ❌ Edge - if else if else missing id in else if`,
  edgeCases["if else if else missing id in else if"],
);
test(
  `${ruleName}: ✅ Edge - if else if with final return id in all paths`,
  edgeCases["if else if with final return id in all paths"],
);
test(
  `${ruleName}: ❌ Edge - if else if with final return missing id in final return`,
  edgeCases["if else if with final return missing id in final return"],
);
