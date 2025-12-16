import { RULE_IDS } from "../lib/const.ts";
import {
  createRequiredDispatcherRuleTests,
  createRequiredEdgeCaseTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-following-property-required.ts";

const ruleName = RULE_IDS.actorFollowingPropertyRequired;
const config = { rule, ruleName };

runTests(ruleName, createRequiredDispatcherRuleTests("following", config));
runTests(
  ruleName,
  createRequiredEdgeCaseTests("following", config),
);
