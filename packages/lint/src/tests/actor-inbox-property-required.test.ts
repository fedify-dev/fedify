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
