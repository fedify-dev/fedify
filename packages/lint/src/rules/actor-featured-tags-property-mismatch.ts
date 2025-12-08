import { properties } from "../lib/const.ts";
import { createMismatchRule } from "../lib/mismatch-rule-factory.ts";

export const ACTOR_FEATURED_TAGS_PROPERTY_MISMATCH =
  "actor-featured-tags-property-mismatch" as const;

const actorFeaturedTagsPropertyMismatch: Deno.lint.Rule = createMismatchRule(
  properties.featuredTags,
);

export default actorFeaturedTagsPropertyMismatch;
