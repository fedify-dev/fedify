import { test } from "node:test";
import { RULE_IDS } from "../lib/const.ts";
import {
  createRequiredEdgeCaseTests,
  createRequiredListenerRuleTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-inbox-property-required.ts";

const ruleName = RULE_IDS.actorInboxPropertyRequired;

const config = { rule, ruleName };

// Standard required listener rule tests
const tests = createRequiredListenerRuleTests("inbox", config);
test(
  `${ruleName}: ✅ Good - non-Federation object`,
  tests["non-federation object"],
);
test(
  `${ruleName}: ✅ Good - listeners NOT configured`,
  tests["listeners not configured"],
);
test(
  `${ruleName}: ✅ Good - listeners BEFORE (chained) with property`,
  tests["listeners before chained with property"],
);
test(
  `${ruleName}: ✅ Good - listeners BEFORE (separate) with property`,
  tests["listeners before separate with property"],
);
test(
  `${ruleName}: ✅ Good - listeners AFTER (chained) with property`,
  tests["listeners after chained with property"],
);
test(
  `${ruleName}: ✅ Good - listeners AFTER (separate) with property`,
  tests["listeners after separate with property"],
);
test(
  `${ruleName}: ❌ Bad - listeners configured, property missing`,
  tests["listeners configured property missing"],
);
test(
  `${ruleName}: ❌ Bad - listeners BEFORE (separate), property missing`,
  tests["listeners before separate property missing"],
);
test(
  `${ruleName}: ❌ Bad - listeners AFTER (separate), property missing`,
  tests["listeners after separate property missing"],
);
test(
  `${ruleName}: ❌ Bad - variable assignment without property`,
  tests["variable assignment without property"],
);

// Edge case tests
const edgeCases = createRequiredEdgeCaseTests(
  "inbox",
  config,
  "setInboxListeners",
);
test(
  `${ruleName}: ✅ Edge - ternary with property in both branches`,
  edgeCases["ternary with property in both branches"],
);
test(
  `${ruleName}: ❌ Edge - ternary missing property in consequent`,
  edgeCases["ternary missing property in consequent"],
);
test(
  `${ruleName}: ❌ Edge - ternary missing property in alternate`,
  edgeCases["ternary missing property in alternate"],
);
test(
  `${ruleName}: ❌ Edge - ternary missing property in both branches`,
  edgeCases["ternary missing property in both branches"],
);
test(
  `${ruleName}: ✅ Edge - nested ternary with property`,
  edgeCases["nested ternary with property"],
);
test(
  `${ruleName}: ✅ Edge - if/else with property in both branches`,
  edgeCases["if else with property in both branches"],
);
test(
  `${ruleName}: ❌ Edge - if/else missing property in if block`,
  edgeCases["if else missing property in if block"],
);
test(
  `${ruleName}: ❌ Edge - if/else missing property in else block`,
  edgeCases["if else missing property in else block"],
);
test(
  `${ruleName}: ❌ Edge - if/else missing property in both blocks`,
  edgeCases["if else missing property in both blocks"],
);
test(
  `${ruleName}: ✅ Edge - nested if with property`,
  edgeCases["nested if with property"],
);
test(
  `${ruleName}: ✅ Edge - if else if else with inbox in all branches`,
  edgeCases["if else if else with property in all branches"],
);
test(
  `${ruleName}: ❌ Edge - if else if else missing inbox in else if`,
  edgeCases["if else if else missing property in else if"],
);
test(
  `${ruleName}: ✅ Edge - if else if with final return inbox in all paths`,
  edgeCases["if else if with final return property in all paths"],
);
test(
  `${ruleName}: ❌ Edge - if else if with final return missing inbox in final return`,
  edgeCases["if else if with final return missing property in final return"],
);
