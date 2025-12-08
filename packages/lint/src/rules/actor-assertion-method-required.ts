import { properties } from "../lib/const.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_ASSERTION_METHOD_REQUIRED =
  "actor-assertion-method-required";

const actorAssertionMethodRequired: Deno.lint.Rule = createRequiredRule(
  properties.assertionMethod,
);

export default actorAssertionMethodRequired;
