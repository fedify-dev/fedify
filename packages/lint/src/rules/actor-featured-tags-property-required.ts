import { properties } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_FEATURED_TAGS_PROPERTY_REQUIRED =
  "actor-featured-tags-property-required";

const actorFeaturedTagsPropertyRequired = createRequiredRule({
  propertyName: properties.featuredTags.name,
  dispatcherMethod: properties.featuredTags.setter,
  errorMessage: actorPropertyRequired(properties.featuredTags.name),
});

export default actorFeaturedTagsPropertyRequired;
