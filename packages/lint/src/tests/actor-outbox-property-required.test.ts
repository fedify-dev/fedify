import { RULE_IDS } from "../lib/const.ts";
import {
  createRequiredDispatcherRuleTests,
  createRequiredEdgeCaseTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-outbox-property-required.ts";

const ruleName = RULE_IDS.actorOutboxPropertyRequired;
const config = { rule, ruleName };

runTests(ruleName, createRequiredDispatcherRuleTests("outbox", config));
runTests(
  ruleName,
  createRequiredEdgeCaseTests("outbox", config),
);
