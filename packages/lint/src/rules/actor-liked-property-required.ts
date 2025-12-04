import { properties } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_LIKED_PROPERTY_REQUIRED = "actor-liked-property-required";

const actorLikedPropertyRequired = createRequiredRule({
  propertyName: properties.liked.name,
  dispatcherMethod: properties.liked.setter,
  errorMessage: actorPropertyRequired(properties.liked.name),
});

export default actorLikedPropertyRequired;
