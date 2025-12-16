import { RULE_IDS } from "../lib/const.ts";
import {
  createIdMismatchEdgeCaseTests,
  createIdMismatchRuleTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-id-mismatch.ts";

const ruleName = RULE_IDS.actorIdMismatch;
const config = { rule, ruleName };

runTests(ruleName, createIdMismatchRuleTests(config));
runTests(ruleName, createIdMismatchEdgeCaseTests(config));
