import { properties } from "../lib/const.ts";
import { createMismatchRule } from "../lib/mismatch-rule-factory.ts";

export const ACTOR_FEATURED_PROPERTY_MISMATCH =
  "actor-featured-property-mismatch" as const;

const actorFeaturedPropertyMismatch: Deno.lint.Rule = createMismatchRule({
  propertyPath: properties.featured.name,
  methodName: properties.featured.getter,
});

export default actorFeaturedPropertyMismatch;
