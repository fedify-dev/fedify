import { RULE_IDS } from "../lib/const.ts";
import {
  createMismatchEdgeCaseTests,
  createMismatchRuleTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-featured-tags-property-mismatch.ts";

const ruleName = RULE_IDS.actorFeaturedTagsPropertyMismatch;
const config = { rule, ruleName };

runTests(ruleName, createMismatchRuleTests("featuredTags", config));
runTests(ruleName, createMismatchEdgeCaseTests("featuredTags", config));
