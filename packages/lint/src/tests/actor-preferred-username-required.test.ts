import { RULE_IDS } from "../lib/const.ts";
import {
  createPreferredUsernameRequiredRuleTests,
  createRequiredEdgeCaseTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-preferred-username-required.ts";

const ruleName = RULE_IDS.actorPreferredUsernameRequired;
const config = { rule, ruleName };

runTests(ruleName, createPreferredUsernameRequiredRuleTests(config));
runTests(ruleName, createRequiredEdgeCaseTests("preferredUsername", config));
