import { properties } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_FEATURED_PROPERTY_REQUIRED =
  "actor-featured-property-required";

const actorFeaturedPropertyRequired = createRequiredRule({
  propertyName: properties.featured.name,
  dispatcherMethod: properties.featured.setter,
  errorMessage: actorPropertyRequired(properties.featured.name),
});

export default actorFeaturedPropertyRequired;
