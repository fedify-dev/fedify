import { RULE_IDS } from "../lib/const.ts";
import {
  createMismatchEdgeCaseTests,
  createMismatchRuleTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-inbox-property-mismatch.ts";

const ruleName = RULE_IDS.actorInboxPropertyMismatch;
const config = { rule, ruleName };

runTests(ruleName, createMismatchRuleTests("inbox", config));
runTests(ruleName, createMismatchEdgeCaseTests("inbox", config));
