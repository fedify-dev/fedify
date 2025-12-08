import { properties } from "../lib/const.ts";
import { createMismatchRule } from "../lib/mismatch-rule-factory.ts";

export const ACTOR_LIKED_PROPERTY_MISMATCH =
  "actor-liked-property-mismatch" as const;

const actorLikedPropertyMismatch: Deno.lint.Rule = createMismatchRule(
  properties.liked,
);

export default actorLikedPropertyMismatch;
