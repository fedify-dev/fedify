import { properties } from "../lib/const.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_FEATURED_TAGS_PROPERTY_REQUIRED =
  "actor-featured-tags-property-required";

const actorFeaturedTagsPropertyRequired = createRequiredRule(
  properties.featuredTags,
);

export default actorFeaturedTagsPropertyRequired;
