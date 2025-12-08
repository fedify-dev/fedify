import { properties } from "../lib/const.ts";
import { createMismatchRule } from "../lib/mismatch-rule-factory.ts";

export const ACTOR_FOLLOWING_PROPERTY_MISMATCH =
  "actor-following-property-mismatch" as const;

const actorFollowingPropertyMismatch: Deno.lint.Rule = createMismatchRule(
  properties.following,
);

export default actorFollowingPropertyMismatch;
