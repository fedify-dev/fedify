import { properties } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_FOLLOWING_PROPERTY_REQUIRED =
  "actor-following-property-required";

const actorFollowingPropertyRequired = createRequiredRule({
  propertyName: properties.following.name,
  dispatcherMethod: properties.following.setter,
  errorMessage: actorPropertyRequired(properties.following.name),
});

export default actorFollowingPropertyRequired;
