import { properties } from "../lib/const.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_OUTBOX_PROPERTY_REQUIRED = "actor-outbox-property-required";

const actorOutboxPropertyRequired = createRequiredRule(properties.outbox);

export default actorOutboxPropertyRequired;
