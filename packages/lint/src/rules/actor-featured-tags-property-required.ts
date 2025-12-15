import { properties } from "../lib/const.ts";
import {
  createRequiredRuleDeno,
  createRequiredRuleEslint,
} from "../lib/required.ts";

export const deno = createRequiredRuleDeno(
  properties.featuredTags,
);
export const eslint = createRequiredRuleEslint(
  properties.featuredTags,
);
