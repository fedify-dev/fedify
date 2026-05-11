/**
 * oxlint plugin for Fedify.
 *
 * Exposes the same rule set as the ESLint plugin in a shape suitable for
 * oxlint's JS plugin API (https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html).
 *
 * Configure via `.oxlintrc.json`:
 *
 * ```json
 * {
 *   "jsPlugins": ["@fedify/lint/oxlint"],
 *   "rules": {
 *     "@fedify/lint/actor-id-required": "error"
 *   }
 * }
 * ```
 */
import type { Rule } from "eslint";
import metadataRaw from "../deno.json" with { type: "json" };
import { RULE_IDS } from "./lib/const.ts";
import {
  eslint as actorAssertionMethodRequired,
} from "./rules/actor-assertion-method-required.ts";
import {
  eslint as actorFeaturedPropertyMismatch,
} from "./rules/actor-featured-property-mismatch.ts";
import {
  eslint as actorFeaturedPropertyRequired,
} from "./rules/actor-featured-property-required.ts";
import {
  eslint as actorFeaturedTagsPropertyMismatch,
} from "./rules/actor-featured-tags-property-mismatch.ts";
import {
  eslint as actorFeaturedTagsPropertyRequired,
} from "./rules/actor-featured-tags-property-required.ts";
import {
  eslint as actorFollowersPropertyMismatch,
} from "./rules/actor-followers-property-mismatch.ts";
import {
  eslint as actorFollowersPropertyRequired,
} from "./rules/actor-followers-property-required.ts";
import {
  eslint as actorFollowingPropertyMismatch,
} from "./rules/actor-following-property-mismatch.ts";
import {
  eslint as actorFollowingPropertyRequired,
} from "./rules/actor-following-property-required.ts";
import { eslint as actorIdMismatch } from "./rules/actor-id-mismatch.ts";
import { eslint as actorIdRequired } from "./rules/actor-id-required.ts";
import {
  eslint as actorInboxPropertyMismatch,
} from "./rules/actor-inbox-property-mismatch.ts";
import {
  eslint as actorInboxPropertyRequired,
} from "./rules/actor-inbox-property-required.ts";
import {
  eslint as actorLikedPropertyMismatch,
} from "./rules/actor-liked-property-mismatch.ts";
import {
  eslint as actorLikedPropertyRequired,
} from "./rules/actor-liked-property-required.ts";
import {
  eslint as actorOutboxPropertyMismatch,
} from "./rules/actor-outbox-property-mismatch.ts";
import {
  eslint as actorOutboxPropertyRequired,
} from "./rules/actor-outbox-property-required.ts";
import {
  eslint as actorPublicKeyRequired,
} from "./rules/actor-public-key-required.ts";
import {
  eslint as actorSharedInboxPropertyMismatch,
} from "./rules/actor-shared-inbox-property-mismatch.ts";
import {
  eslint as actorSharedInboxPropertyRequired,
} from "./rules/actor-shared-inbox-property-required.ts";
import {
  eslint as collectionFiltering,
} from "./rules/collection-filtering-not-implemented.ts";
import {
  eslint as outboxListenerDeliveryRequired,
} from "./rules/outbox-listener-delivery-required.ts";

const rules: Record<
  typeof RULE_IDS[keyof typeof RULE_IDS],
  Rule.RuleModule
> = {
  [RULE_IDS.actorIdMismatch]: actorIdMismatch,
  [RULE_IDS.actorIdRequired]: actorIdRequired,
  [RULE_IDS.actorFollowingPropertyRequired]: actorFollowingPropertyRequired,
  [RULE_IDS.actorFollowingPropertyMismatch]: actorFollowingPropertyMismatch,
  [RULE_IDS.actorFollowersPropertyRequired]: actorFollowersPropertyRequired,
  [RULE_IDS.actorFollowersPropertyMismatch]: actorFollowersPropertyMismatch,
  [RULE_IDS.actorOutboxPropertyRequired]: actorOutboxPropertyRequired,
  [RULE_IDS.actorOutboxPropertyMismatch]: actorOutboxPropertyMismatch,
  [RULE_IDS.actorLikedPropertyRequired]: actorLikedPropertyRequired,
  [RULE_IDS.actorLikedPropertyMismatch]: actorLikedPropertyMismatch,
  [RULE_IDS.actorFeaturedPropertyRequired]: actorFeaturedPropertyRequired,
  [RULE_IDS.actorFeaturedPropertyMismatch]: actorFeaturedPropertyMismatch,
  [RULE_IDS.actorFeaturedTagsPropertyRequired]:
    actorFeaturedTagsPropertyRequired,
  [RULE_IDS.actorFeaturedTagsPropertyMismatch]:
    actorFeaturedTagsPropertyMismatch,
  [RULE_IDS.actorInboxPropertyRequired]: actorInboxPropertyRequired,
  [RULE_IDS.actorInboxPropertyMismatch]: actorInboxPropertyMismatch,
  [RULE_IDS.actorSharedInboxPropertyRequired]: actorSharedInboxPropertyRequired,
  [RULE_IDS.actorSharedInboxPropertyMismatch]: actorSharedInboxPropertyMismatch,
  [RULE_IDS.actorPublicKeyRequired]: actorPublicKeyRequired,
  [RULE_IDS.actorAssertionMethodRequired]: actorAssertionMethodRequired,
  [RULE_IDS.collectionFilteringNotImplemented]: collectionFiltering,
  [RULE_IDS.outboxListenerDeliveryRequired]: outboxListenerDeliveryRequired,
};

/**
 * Plugin object compatible with oxlint's JS plugin API.
 */
export interface OxlintPlugin {
  meta: { name: string; version: string };
  rules: Record<string, Rule.RuleModule>;
}

export const plugin: OxlintPlugin = {
  meta: {
    name: metadataRaw.name,
    version: metadataRaw.version,
  },
  rules,
};

export default plugin;
