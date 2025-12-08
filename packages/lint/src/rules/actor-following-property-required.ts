import { properties } from "../lib/const.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_FOLLOWING_PROPERTY_REQUIRED =
  "actor-following-property-required";

const actorFollowingPropertyRequired = createRequiredRule(
  properties.following,
);

export default actorFollowingPropertyRequired;
