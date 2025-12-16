import { RULE_IDS } from "../lib/const.ts";
import {
  createRequiredDispatcherRuleTests,
  createRequiredEdgeCaseTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-inbox-property-required.ts";

const ruleName = RULE_IDS.actorInboxPropertyRequired;

const config = { rule, ruleName };

// Standard required listener rule tests
runTests(
  ruleName,
  createRequiredDispatcherRuleTests("inbox", config),
);

// Edge case tests
runTests(
  ruleName,
  createRequiredEdgeCaseTests("inbox", config),
);
