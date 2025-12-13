import { properties } from "../lib/const.ts";
import {
  createRequiredRuleDeno,
  createRequiredRuleEslint,
} from "../lib/required-rule-factory.ts";

export const deno = createRequiredRuleDeno(
  properties.following,
);
export const eslint = createRequiredRuleEslint(
  properties.following,
);
