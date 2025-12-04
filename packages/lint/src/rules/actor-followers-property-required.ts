import { properties } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_FOLLOWERS_PROPERTY_REQUIRED =
  "actor-followers-property-required";

const actorFollowersPropertyRequired = createRequiredRule({
  propertyName: properties.followers.name,
  dispatcherMethod: properties.followers.setter,
  errorMessage: actorPropertyRequired(properties.followers.name),
});

export default actorFollowersPropertyRequired;
