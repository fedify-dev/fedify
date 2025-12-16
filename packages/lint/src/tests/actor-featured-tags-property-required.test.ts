import { RULE_IDS } from "../lib/const.ts";
import {
  createRequiredDispatcherRuleTests,
  createRequiredEdgeCaseTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-featured-tags-property-required.ts";

const ruleName = RULE_IDS.actorFeaturedTagsPropertyRequired;
const config = { rule, ruleName };

runTests(ruleName, createRequiredDispatcherRuleTests("featuredTags", config));
runTests(
  ruleName,
  createRequiredEdgeCaseTests(
    "featuredTags",
    config,
  ),
);
