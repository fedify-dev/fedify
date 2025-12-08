import { test } from "node:test";
import {
  createMismatchEdgeCaseTests,
  createMismatchRuleTests,
} from "../lib/test-templates.ts";
import {
  ACTOR_INBOX_PROPERTY_MISMATCH as ruleName,
  default as rule,
} from "../rules/actor-inbox-property-mismatch.ts";

const config = { rule, ruleName };

// Standard mismatch rule tests
const tests = createMismatchRuleTests("inbox", config);
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
const edgeCases = createMismatchEdgeCaseTests("inbox", config);
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
