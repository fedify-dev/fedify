/**
 * ESLint plugin for Fedify.
 * Provides lint rules for validating Fedify federation code.
 */
import { pipe } from "@fxts/core";
import type { TSESLint } from "@typescript-eslint/utils";
import {
  createCollectionFilteringRule,
  createMismatchRule,
  createRequiredRule,
} from "./eslint-rules.ts";
import { properties } from "./lib/const.ts";

// ============================================================================
// Rule IDs
// ============================================================================

const RULE_IDS = {
  // Required rules
  actorIdRequired: "actor-id-required",
  actorFollowingPropertyRequired: "actor-following-property-required",
  actorFollowersPropertyRequired: "actor-followers-property-required",
  actorOutboxPropertyRequired: "actor-outbox-property-required",
  actorLikedPropertyRequired: "actor-liked-property-required",
  actorFeaturedPropertyRequired: "actor-featured-property-required",
  actorFeaturedTagsPropertyRequired: "actor-featured-tags-property-required",
  actorInboxPropertyRequired: "actor-inbox-property-required",
  actorSharedInboxPropertyRequired: "actor-shared-inbox-property-required",
  actorPublicKeyRequired: "actor-public-key-required",
  actorAssertionMethodRequired: "actor-assertion-method-required",

  // Mismatch rules
  actorIdMismatch: "actor-id-mismatch",
  actorFollowingPropertyMismatch: "actor-following-property-mismatch",
  actorFollowersPropertyMismatch: "actor-followers-property-mismatch",
  actorOutboxPropertyMismatch: "actor-outbox-property-mismatch",
  actorLikedPropertyMismatch: "actor-liked-property-mismatch",
  actorFeaturedPropertyMismatch: "actor-featured-property-mismatch",
  actorFeaturedTagsPropertyMismatch: "actor-featured-tags-property-mismatch",
  actorInboxPropertyMismatch: "actor-inbox-property-mismatch",
  actorSharedInboxPropertyMismatch: "actor-shared-inbox-property-mismatch",

  // Collection rules
  collectionFilteringNotImplemented: "collection-filtering-not-implemented",
} as const;

// ============================================================================
// Rule Definitions
// ============================================================================

const rules: Record<string, TSESLint.RuleModule<string, unknown[]>> = {
  // Required rules
  [RULE_IDS.actorIdRequired]: createRequiredRule(
    RULE_IDS.actorIdRequired,
    properties.id,
  ),
  [RULE_IDS.actorFollowingPropertyRequired]: createRequiredRule(
    RULE_IDS.actorFollowingPropertyRequired,
    properties.following,
  ),
  [RULE_IDS.actorFollowersPropertyRequired]: createRequiredRule(
    RULE_IDS.actorFollowersPropertyRequired,
    properties.followers,
  ),
  [RULE_IDS.actorOutboxPropertyRequired]: createRequiredRule(
    RULE_IDS.actorOutboxPropertyRequired,
    properties.outbox,
  ),
  [RULE_IDS.actorLikedPropertyRequired]: createRequiredRule(
    RULE_IDS.actorLikedPropertyRequired,
    properties.liked,
  ),
  [RULE_IDS.actorFeaturedPropertyRequired]: createRequiredRule(
    RULE_IDS.actorFeaturedPropertyRequired,
    properties.featured,
  ),
  [RULE_IDS.actorFeaturedTagsPropertyRequired]: createRequiredRule(
    RULE_IDS.actorFeaturedTagsPropertyRequired,
    properties.featuredTags,
  ),
  [RULE_IDS.actorInboxPropertyRequired]: createRequiredRule(
    RULE_IDS.actorInboxPropertyRequired,
    properties.inbox,
  ),
  [RULE_IDS.actorSharedInboxPropertyRequired]: createRequiredRule(
    RULE_IDS.actorSharedInboxPropertyRequired,
    properties.sharedInbox,
  ),
  [RULE_IDS.actorPublicKeyRequired]: createRequiredRule(
    RULE_IDS.actorPublicKeyRequired,
    properties.publicKey,
  ),
  [RULE_IDS.actorAssertionMethodRequired]: createRequiredRule(
    RULE_IDS.actorAssertionMethodRequired,
    properties.assertionMethod,
  ),

  // Mismatch rules
  [RULE_IDS.actorIdMismatch]: createMismatchRule(
    RULE_IDS.actorIdMismatch,
    properties.id,
  ),
  [RULE_IDS.actorFollowingPropertyMismatch]: createMismatchRule(
    RULE_IDS.actorFollowingPropertyMismatch,
    properties.following,
  ),
  [RULE_IDS.actorFollowersPropertyMismatch]: createMismatchRule(
    RULE_IDS.actorFollowersPropertyMismatch,
    properties.followers,
  ),
  [RULE_IDS.actorOutboxPropertyMismatch]: createMismatchRule(
    RULE_IDS.actorOutboxPropertyMismatch,
    properties.outbox,
  ),
  [RULE_IDS.actorLikedPropertyMismatch]: createMismatchRule(
    RULE_IDS.actorLikedPropertyMismatch,
    properties.liked,
  ),
  [RULE_IDS.actorFeaturedPropertyMismatch]: createMismatchRule(
    RULE_IDS.actorFeaturedPropertyMismatch,
    properties.featured,
  ),
  [RULE_IDS.actorFeaturedTagsPropertyMismatch]: createMismatchRule(
    RULE_IDS.actorFeaturedTagsPropertyMismatch,
    properties.featuredTags,
  ),
  [RULE_IDS.actorInboxPropertyMismatch]: createMismatchRule(
    RULE_IDS.actorInboxPropertyMismatch,
    properties.inbox,
  ),
  [RULE_IDS.actorSharedInboxPropertyMismatch]: createMismatchRule(
    RULE_IDS.actorSharedInboxPropertyMismatch,
    properties.sharedInbox,
  ),

  // Collection rules
  [RULE_IDS.collectionFilteringNotImplemented]: createCollectionFilteringRule(
    RULE_IDS.collectionFilteringNotImplemented,
  ),
};

// ============================================================================
// Plugin Configuration
// ============================================================================

/**
 * Recommended configuration - enables all rules as warnings
 */
/**
 * Recommended configuration - enables all rules as warnings
 */
const recommendedRules = pipe(
  Object.keys(rules),
  (keys) =>
    keys.reduce((acc, key) => {
      acc[`@fedify/lint/${key}`] = "warn" as const;
      return acc;
    }, {} as Record<string, "warn" | "error" | "off">),
);

/**
 * Strict configuration - enables all rules as errors
 */
const strictRules = pipe(
  Object.keys(rules),
  (keys) =>
    keys.reduce((acc, key) => {
      acc[`@fedify/lint/${key}`] = "error" as const;
      return acc;
    }, {} as Record<string, "warn" | "error" | "off">),
);

// ============================================================================
// Plugin Export
// ============================================================================

const plugin: TSESLint.Linter.Plugin = {
  meta: {
    name: "@fedify/lint",
    version: "2.0.0",
  },
  rules,
  configs: {
    recommended: {
      plugins: ["@fedify/lint"],
      rules: recommendedRules,
    },
    strict: {
      plugins: ["@fedify/lint"],
      rules: strictRules,
    },
  },
};

export default plugin;

// Named exports for convenience
export { RULE_IDS, rules };
export type { TSESLint };
