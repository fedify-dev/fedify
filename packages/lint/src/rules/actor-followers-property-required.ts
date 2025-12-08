import { properties } from "../lib/const.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_FOLLOWERS_PROPERTY_REQUIRED =
  "actor-followers-property-required";

const actorFollowersPropertyRequired = createRequiredRule(
  properties.followers,
);

export default actorFollowersPropertyRequired;
