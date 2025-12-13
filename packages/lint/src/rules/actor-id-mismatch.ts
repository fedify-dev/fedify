import { properties } from "../lib/const.ts";
import {
  createMismatchRuleDeno,
  createMismatchRuleEslint,
} from "../lib/mismatch-rule-factory.ts";

export const deno = createMismatchRuleDeno(properties.id);
export const eslint = createMismatchRuleEslint(properties.id);
