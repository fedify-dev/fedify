import { properties } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_OUTBOX_PROPERTY_REQUIRED = "actor-outbox-property-required";

const actorOutboxPropertyRequired = createRequiredRule({
  propertyName: properties.outbox.name,
  dispatcherMethod: properties.outbox.setter,
  errorMessage: actorPropertyRequired(properties.outbox.name),
});

export default actorOutboxPropertyRequired;
