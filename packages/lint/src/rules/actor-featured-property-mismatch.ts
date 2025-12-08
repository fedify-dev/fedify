import { properties } from "../lib/const.ts";
import { createMismatchRule } from "../lib/mismatch-rule-factory.ts";

export const ACTOR_FEATURED_PROPERTY_MISMATCH =
  "actor-featured-property-mismatch" as const;

const actorFeaturedPropertyMismatch: Deno.lint.Rule = createMismatchRule(
  properties.featured,
);

export default actorFeaturedPropertyMismatch;
