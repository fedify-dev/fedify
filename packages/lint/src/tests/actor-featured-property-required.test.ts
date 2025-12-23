import { RULE_IDS } from "../lib/const.ts";
import {
  createRequiredDispatcherRuleTests,
  createRequiredEdgeCaseTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-featured-property-required.ts";

const ruleName = RULE_IDS.actorFeaturedPropertyRequired;
const config = { rule, ruleName };

runTests(ruleName, createRequiredDispatcherRuleTests("featured", config));
runTests(
  ruleName,
  createRequiredEdgeCaseTests("featured", config),
);
