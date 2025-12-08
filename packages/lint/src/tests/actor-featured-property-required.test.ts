import { test } from "node:test";
import {
  createRequiredDispatcherRuleTests,
  createRequiredEdgeCaseTests,
} from "../lib/test-templates.ts";
import {
  ACTOR_FEATURED_PROPERTY_REQUIRED as ruleName,
  default as rule,
} from "../rules/actor-featured-property-required.ts";

const config = { rule, ruleName };

// Standard required dispatcher rule tests
const tests = createRequiredDispatcherRuleTests("featured", config);
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
  "featured",
  config,
  "setFeaturedDispatcher",
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
