import { properties } from "../lib/const.ts";
import {
  createRequiredRuleDeno,
  createRequiredRuleEslint,
} from "../lib/required.ts";

export const deno = createRequiredRuleDeno(
  properties.inbox,
);
export const eslint = createRequiredRuleEslint(
  properties.inbox,
);
