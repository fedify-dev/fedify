import { RULE_IDS } from "../lib/const.ts";
import {
  createRequiredDispatcherRuleTests,
  createRequiredEdgeCaseTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-assertion-method-required.ts";

const ruleName = RULE_IDS.actorAssertionMethodRequired;
const config = { rule, ruleName };

runTests(
  ruleName,
  createRequiredDispatcherRuleTests("assertionMethod", config),
);
runTests(ruleName, createRequiredEdgeCaseTests("assertionMethod", config));
