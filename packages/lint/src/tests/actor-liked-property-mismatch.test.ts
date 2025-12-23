import { RULE_IDS } from "../lib/const.ts";
import {
  createMismatchEdgeCaseTests,
  createMismatchRuleTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-liked-property-mismatch.ts";

const ruleName = RULE_IDS.actorLikedPropertyMismatch;
const config = { rule, ruleName };

runTests(ruleName, createMismatchRuleTests("liked", config));
runTests(ruleName, createMismatchEdgeCaseTests("liked", config));
