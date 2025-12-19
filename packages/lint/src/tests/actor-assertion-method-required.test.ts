import { RULE_IDS } from "../lib/const.ts";
import {
  createKeyRequiredDispatcherRuleTests,
  createKeyRequiredEdgeCaseTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-assertion-method-required.ts";

const ruleName = RULE_IDS.actorAssertionMethodRequired;
const config = { rule, ruleName };

runTests(
  ruleName,
  createKeyRequiredDispatcherRuleTests("assertionMethod", config),
);
runTests(ruleName, createKeyRequiredEdgeCaseTests("assertionMethod", config));
