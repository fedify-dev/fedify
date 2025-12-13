import { properties } from "../lib/const.ts";
import {
  createMismatchRuleDeno,
  createMismatchRuleEslint,
} from "../lib/mismatch-rule-factory.ts";

export const deno = createMismatchRuleDeno(
  properties.sharedInbox,
);
export const eslint = createMismatchRuleEslint(
  properties.sharedInbox,
);
