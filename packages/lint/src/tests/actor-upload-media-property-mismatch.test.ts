import { RULE_IDS } from "../lib/const.ts";
import {
  createMismatchEdgeCaseTests,
  createMismatchRuleTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-upload-media-property-mismatch.ts";

const ruleName = RULE_IDS.actorUploadMediaPropertyMismatch;
const config = { rule, ruleName };

runTests(ruleName, createMismatchRuleTests("uploadMedia", config));
runTests(ruleName, createMismatchEdgeCaseTests("uploadMedia", config));
