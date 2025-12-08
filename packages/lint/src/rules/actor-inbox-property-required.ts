import { properties } from "../lib/const.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_INBOX_PROPERTY_REQUIRED = "actor-inbox-property-required";

const actorInboxPropertyRequired = createRequiredRule(properties.inbox);

export default actorInboxPropertyRequired;
