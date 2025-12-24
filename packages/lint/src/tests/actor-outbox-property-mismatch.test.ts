import { RULE_IDS } from "../lib/const.ts";
import {
  createMismatchEdgeCaseTests,
  createMismatchRuleTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-outbox-property-mismatch.ts";

const ruleName = RULE_IDS.actorOutboxPropertyMismatch;
const config = { rule, ruleName };

runTests(ruleName, createMismatchRuleTests("outbox", config));
runTests(ruleName, createMismatchEdgeCaseTests("outbox", config));
