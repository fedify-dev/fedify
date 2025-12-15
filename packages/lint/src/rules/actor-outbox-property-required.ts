import { properties } from "../lib/const.ts";
import {
  createRequiredRuleDeno,
  createRequiredRuleEslint,
} from "../lib/required.ts";

export const deno = createRequiredRuleDeno(
  properties.outbox,
);
export const eslint = createRequiredRuleEslint(
  properties.outbox,
);
