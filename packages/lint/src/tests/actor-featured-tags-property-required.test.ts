import { test } from "node:test";
import { RULE_IDS } from "../lib/const.ts";
import {
  createRequiredDispatcherRuleTests,
  createRequiredEdgeCaseTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-featured-tags-property-required.ts";

const ruleName = RULE_IDS.actorFeaturedTagsPropertyRequired;

const config = { rule, ruleName };

// Standard required dispatcher rule tests
const tests = createRequiredDispatcherRuleTests("featuredTags", config);
test(
  `${ruleName}: ✅ Good - non-Federation object`,
  tests["non-federation object"],
);
test(
  `${ruleName}: ✅ Good - dispatcher NOT configured`,
  tests["dispatcher not configured"],
);
test(
  `${ruleName}: ✅ Good - dispatcher BEFORE (chained) with property`,
  tests["dispatcher before chained with property"],
);
test(
  `${ruleName}: ✅ Good - dispatcher BEFORE (separate) with property`,
  tests["dispatcher before separate with property"],
);
test(
  `${ruleName}: ✅ Good - dispatcher AFTER (chained) with property`,
  tests["dispatcher after chained with property"],
);
test(
  `${ruleName}: ✅ Good - dispatcher AFTER (separate) with property`,
  tests["dispatcher after separate with property"],
);
test(
  `${ruleName}: ❌ Bad - dispatcher configured, property missing`,
  tests["dispatcher configured property missing"],
);
test(
  `${ruleName}: ❌ Bad - dispatcher BEFORE (separate), property missing`,
  tests["dispatcher before separate property missing"],
);
test(
  `${ruleName}: ❌ Bad - dispatcher AFTER (separate), property missing`,
  tests["dispatcher after separate property missing"],
);
test(
  `${ruleName}: ❌ Bad - variable assignment without property`,
  tests["variable assignment without property"],
);

// Edge case tests
const edgeCases = createRequiredEdgeCaseTests(
  "featuredTags",
  config,
  "setFeaturedTagsDispatcher",
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
  `${ruleName}: ✅ Edge - if else if else with featuredTags in all branches`,
  edgeCases["if else if else with property in all branches"],
);
test(
  `${ruleName}: ❌ Edge - if else if else missing featuredTags in else if`,
  edgeCases["if else if else missing property in else if"],
);
test(
  `${ruleName}: ✅ Edge - if else if with final return featuredTags in all paths`,
  edgeCases["if else if with final return property in all paths"],
);
test(
  `${ruleName}: ❌ Edge - if else if with final return missing featuredTags in final return`,
  edgeCases["if else if with final return missing property in final return"],
);
