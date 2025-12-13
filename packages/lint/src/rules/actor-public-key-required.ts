import { properties } from "../lib/const.ts";
import {
  createRequiredRuleDeno,
  createRequiredRuleEslint,
} from "../lib/required-rule-factory.ts";

export const deno = createRequiredRuleDeno(
  properties.publicKey,
);
export const eslint = createRequiredRuleEslint(
  properties.publicKey,
);
