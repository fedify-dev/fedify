import { deepStrictEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { plugin } from "../index.ts";
import { RULE_IDS } from "../lib/const.ts";
import denoPlugin from "../mod.ts";
import oxlintPlugin from "../oxlint.ts";

const ruleId = RULE_IDS.outboxListenerDeliveryNotAwaited;
const eslintRuleId = `@fedify/lint/${ruleId}`;

test(`${ruleId}: registered for ESLint, as a warning in recommended and an error in strict`, () => {
  ok(plugin.rules != null && ruleId in plugin.rules);
  deepStrictEqual(plugin.configs.recommended.rules[eslintRuleId], "warn");
  deepStrictEqual(plugin.configs.strict.rules[eslintRuleId], "error");
});

test(`${ruleId}: registered for Oxlint`, () => {
  ok(ruleId in oxlintPlugin.rules);
});

test(`${ruleId}: not registered for Deno, which enables every rule of a plugin`, () => {
  ok(!(ruleId in denoPlugin.rules));
});
