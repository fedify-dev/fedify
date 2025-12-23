import { RULE_IDS } from "../lib/const.ts";
import {
  createMismatchEdgeCaseTests,
  createMismatchRuleTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-shared-inbox-property-mismatch.ts";

const ruleName = RULE_IDS.actorSharedInboxPropertyMismatch;
const config = { rule, ruleName };

runTests(ruleName, createMismatchRuleTests("sharedInbox", config));
runTests(ruleName, createMismatchEdgeCaseTests("sharedInbox", config));
