import { RULE_IDS } from "../lib/const.ts";
import {
  createMismatchEdgeCaseTests,
  createMismatchRuleTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-followers-property-mismatch.ts";

const ruleName = RULE_IDS.actorFollowersPropertyMismatch;
const config = { rule, ruleName };

runTests(ruleName, createMismatchRuleTests("followers", config));
runTests(ruleName, createMismatchEdgeCaseTests("followers", config));
