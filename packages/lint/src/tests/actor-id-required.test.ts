import { RULE_IDS } from "../lib/const.ts";
import {
  createIdRequiredEdgeCaseTests,
  createIdRequiredRuleTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-id-required.ts";

const ruleName = RULE_IDS.actorIdRequired;
const config = { rule, ruleName };

runTests(ruleName, createIdRequiredRuleTests(config));
runTests(ruleName, createIdRequiredEdgeCaseTests(config));
