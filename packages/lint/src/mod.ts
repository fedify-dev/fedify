import { RULE_IDS } from "./lib/const.ts";
import {
  deno as actorAssertionMethodRequired,
} from "./rules/actor-assertion-method-required.ts";
import {
  deno as actorFeaturedPropertyMismatch,
} from "./rules/actor-featured-property-mismatch.ts";
import {
  deno as actorFeaturedPropertyRequired,
} from "./rules/actor-featured-property-required.ts";
import {
  deno as actorFeaturedTagsPropertyMismatch,
} from "./rules/actor-featured-tags-property-mismatch.ts";
import {
  deno as actorFeaturedTagsPropertyRequired,
} from "./rules/actor-featured-tags-property-required.ts";
import {
  deno as actorFollowersPropertyMismatch,
} from "./rules/actor-followers-property-mismatch.ts";
import {
  deno as actorFollowersPropertyRequired,
} from "./rules/actor-followers-property-required.ts";
import {
  deno as actorFollowingPropertyMismatch,
} from "./rules/actor-following-property-mismatch.ts";
import {
  deno as actorFollowingPropertyRequired,
} from "./rules/actor-following-property-required.ts";
import { deno as actorIdMismatch } from "./rules/actor-id-mismatch.ts";
import { deno as actorIdRequired } from "./rules/actor-id-required.ts";
import {
  deno as actorInboxPropertyMismatch,
} from "./rules/actor-inbox-property-mismatch.ts";
import {
  deno as actorInboxPropertyRequired,
} from "./rules/actor-inbox-property-required.ts";
import {
  deno as actorLikedPropertyMismatch,
} from "./rules/actor-liked-property-mismatch.ts";
import {
  deno as actorLikedPropertyRequired,
} from "./rules/actor-liked-property-required.ts";
import {
  deno as actorOutboxPropertyMismatch,
} from "./rules/actor-outbox-property-mismatch.ts";
import {
  deno as actorOutboxPropertyRequired,
} from "./rules/actor-outbox-property-required.ts";
import {
  deno as actorPublicKeyRequired,
} from "./rules/actor-public-key-required.ts";
import {
  deno as actorSharedInboxPropertyMismatch,
} from "./rules/actor-shared-inbox-property-mismatch.ts";
import {
  deno as actorSharedInboxPropertyRequired,
} from "./rules/actor-shared-inbox-property-required.ts";
import {
  deno as collectionFiltering,
} from "./rules/collection-filtering-not-implemented.ts";

const plugin: Deno.lint.Plugin = {
  name: "fedify-lint",
  rules: {
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
    [RULE_IDS.actorSharedInboxPropertyRequired]:
      actorSharedInboxPropertyRequired,
    [RULE_IDS.actorSharedInboxPropertyMismatch]:
      actorSharedInboxPropertyMismatch,
    [RULE_IDS.actorPublicKeyRequired]: actorPublicKeyRequired,
    [RULE_IDS.actorAssertionMethodRequired]: actorAssertionMethodRequired,
    [RULE_IDS.collectionFilteringNotImplemented]: collectionFiltering,
  },
};

export default plugin;
