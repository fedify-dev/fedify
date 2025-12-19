import { RULE_IDS } from "../lib/const.ts";
import {
  createKeyRequiredDispatcherRuleTests,
  createKeyRequiredEdgeCaseTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-public-key-required.ts";

const ruleName = RULE_IDS.actorPublicKeyRequired;
const config = { rule, ruleName };

runTests(ruleName, createKeyRequiredDispatcherRuleTests("publicKey", config));
runTests(ruleName, createKeyRequiredEdgeCaseTests("publicKey", config));
