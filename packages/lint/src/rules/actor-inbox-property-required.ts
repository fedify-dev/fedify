import { properties } from "../lib/const.ts";
import {
  createRequiredRuleDeno,
  createRequiredRuleEslint,
} from "../lib/required-rule-factory.ts";

export const deno = createRequiredRuleDeno(
  properties.inbox,
);
export const eslint = createRequiredRuleEslint(
  properties.inbox,
);
