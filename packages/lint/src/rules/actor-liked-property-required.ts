import { properties } from "../lib/const.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_LIKED_PROPERTY_REQUIRED = "actor-liked-property-required";

const actorLikedPropertyRequired = createRequiredRule(properties.liked);

export default actorLikedPropertyRequired;
