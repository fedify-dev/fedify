import { properties } from "../lib/const.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_FEATURED_PROPERTY_REQUIRED =
  "actor-featured-property-required";

const actorFeaturedPropertyRequired = createRequiredRule(
  properties.featured,
);

export default actorFeaturedPropertyRequired;
