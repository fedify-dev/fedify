import { RULE_IDS } from "../lib/const.ts";
import {
  createMismatchEdgeCaseTests,
  createMismatchRuleTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-following-property-mismatch.ts";

const ruleName = RULE_IDS.actorFollowingPropertyMismatch;
const config = { rule, ruleName };

runTests(ruleName, createMismatchRuleTests("following", config));
runTests(ruleName, createMismatchEdgeCaseTests("following", config));
