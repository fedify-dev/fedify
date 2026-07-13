import { RULE_IDS } from "../lib/const.ts";
import {
  createRequiredDispatcherRuleTests,
  createRequiredEdgeCaseTests,
  runTests,
} from "../lib/test-templates.ts";
import * as rule from "../rules/actor-upload-media-property-required.ts";

const ruleName = RULE_IDS.actorUploadMediaPropertyRequired;

const config = { rule, ruleName };

// Standard required dispatcher rule tests
runTests(
  ruleName,
  createRequiredDispatcherRuleTests("uploadMedia", config),
);

// Edge case tests
runTests(
  ruleName,
  createRequiredEdgeCaseTests("uploadMedia", config),
);
