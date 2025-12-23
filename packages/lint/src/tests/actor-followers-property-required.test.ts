import { RULE_IDS } from "../lib/const.ts";
import {
  createRequiredDispatcherRuleTests,
  createRequiredEdgeCaseTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-followers-property-required.ts";

const ruleName = RULE_IDS.actorFollowersPropertyRequired;
const config = { rule, ruleName };

runTests(ruleName, createRequiredDispatcherRuleTests("followers", config));
runTests(
  ruleName,
  createRequiredEdgeCaseTests("followers", config),
);
