import { RULE_IDS } from "../lib/const.ts";
import {
  createMismatchEdgeCaseTests,
  createMismatchRuleTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-featured-property-mismatch.ts";

const ruleName = RULE_IDS.actorFeaturedPropertyMismatch;
const config = { rule, ruleName };

runTests(ruleName, createMismatchRuleTests("featured", config));
runTests(ruleName, createMismatchEdgeCaseTests("featured", config));
