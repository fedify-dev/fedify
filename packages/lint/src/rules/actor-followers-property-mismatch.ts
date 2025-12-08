import { properties } from "../lib/const.ts";
import { createMismatchRule } from "../lib/mismatch-rule-factory.ts";

export const ACTOR_FOLLOWERS_PROPERTY_MISMATCH =
  "actor-followers-property-mismatch" as const;

const actorFollowersPropertyMismatch: Deno.lint.Rule = createMismatchRule(
  properties.followers,
);

export default actorFollowersPropertyMismatch;
