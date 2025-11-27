import actorAssertionMethodRequired, {
  ACTOR_ASSERTION_METHOD_REQUIRED,
} from "./rules/actor-assertion-method-required.ts";
import actorFeaturedPropertyMismatch, {
  ACTOR_FEATURED_PROPERTY_MISMATCH,
} from "./rules/actor-featured-property-mismatch.ts";
import actorFeaturedPropertyRequired, {
  ACTOR_FEATURED_PROPERTY_REQUIRED,
} from "./rules/actor-featured-property-required.ts";
import actorFeaturedTagsPropertyMismatch, {
  ACTOR_FEATURED_TAGS_PROPERTY_MISMATCH,
} from "./rules/actor-featured-tags-property-mismatch.ts";
import actorFeaturedTagsPropertyRequired, {
  ACTOR_FEATURED_TAGS_PROPERTY_REQUIRED,
} from "./rules/actor-featured-tags-property-required.ts";
import actorFollowersPropertyMismatch, {
  ACTOR_FOLLOWERS_PROPERTY_MISMATCH,
} from "./rules/actor-followers-property-mismatch.ts";
import actorFollowersPropertyRequired, {
  ACTOR_FOLLOWERS_PROPERTY_REQUIRED,
} from "./rules/actor-followers-property-required.ts";
import actorFollowingPropertyMismatch, {
  ACTOR_FOLLOWING_PROPERTY_MISMATCH,
} from "./rules/actor-following-property-mismatch.ts";
import actorFollowingPropertyRequired, {
  ACTOR_FOLLOWING_PROPERTY_REQUIRED,
} from "./rules/actor-following-property-required.ts";
import actorIdMismatch, {
  ACTOR_ID_MISMATCH,
} from "./rules/actor-id-mismatch.ts";
import actorIdRequired, {
  ACTOR_ID_REQUIRED,
} from "./rules/actor-id-required.ts";
import actorInboxPropertyMismatch, {
  ACTOR_INBOX_PROPERTY_MISMATCH,
} from "./rules/actor-inbox-property-mismatch.ts";
import actorInboxPropertyRequired, {
  ACTOR_INBOX_PROPERTY_REQUIRED,
} from "./rules/actor-inbox-property-required.ts";
import actorLikedPropertyMismatch, {
  ACTOR_LIKED_PROPERTY_MISMATCH,
} from "./rules/actor-liked-property-mismatch.ts";
import actorLikedPropertyRequired, {
  ACTOR_LIKED_PROPERTY_REQUIRED,
} from "./rules/actor-liked-property-required.ts";
import actorOutboxPropertyMismatch, {
  ACTOR_OUTBOX_PROPERTY_MISMATCH,
} from "./rules/actor-outbox-property-mismatch.ts";
import actorOutboxPropertyRequired, {
  ACTOR_OUTBOX_PROPERTY_REQUIRED,
} from "./rules/actor-outbox-property-required.ts";
import actorPublicKeyRequired, {
  ACTOR_PUBLIC_KEY_REQUIRED,
} from "./rules/actor-public-key-required.ts";
import actorSharedInboxPropertyMismatch, {
  ACTOR_SHARED_INBOX_PROPERTY_MISMATCH,
} from "./rules/actor-shared-inbox-property-mismatch.ts";
import actorSharedInboxPropertyRequired, {
  ACTOR_SHARED_INBOX_PROPERTY_REQUIRED,
} from "./rules/actor-shared-inbox-property-required.ts";
import collectionFilteringNotImplemented, {
  COLLECTION_FILTERING_NOT_IMPLEMENTED,
} from "./rules/collection-filtering-not-implemented.ts";
import ed25519KeyRequired, {
  ED25519_KEY_REQUIRED,
} from "./rules/ed25519-key-required.ts";
import rsaKeyRequired, { RSA_KEY_REQUIRED } from "./rules/rsa-key-required.ts";

const plugin: Deno.lint.Plugin = {
  name: "@fedify/lint",
  rules: {
    [ACTOR_ID_MISMATCH]: actorIdMismatch,
    [ACTOR_ID_REQUIRED]: actorIdRequired,
    [ACTOR_FOLLOWING_PROPERTY_REQUIRED]: actorFollowingPropertyRequired,
    [ACTOR_FOLLOWING_PROPERTY_MISMATCH]: actorFollowingPropertyMismatch,
    [ACTOR_FOLLOWERS_PROPERTY_REQUIRED]: actorFollowersPropertyRequired,
    [ACTOR_FOLLOWERS_PROPERTY_MISMATCH]: actorFollowersPropertyMismatch,
    [ACTOR_OUTBOX_PROPERTY_REQUIRED]: actorOutboxPropertyRequired,
    [ACTOR_OUTBOX_PROPERTY_MISMATCH]: actorOutboxPropertyMismatch,
    [ACTOR_LIKED_PROPERTY_REQUIRED]: actorLikedPropertyRequired,
    [ACTOR_LIKED_PROPERTY_MISMATCH]: actorLikedPropertyMismatch,
    [ACTOR_FEATURED_PROPERTY_REQUIRED]: actorFeaturedPropertyRequired,
    [ACTOR_FEATURED_PROPERTY_MISMATCH]: actorFeaturedPropertyMismatch,
    [ACTOR_FEATURED_TAGS_PROPERTY_REQUIRED]: actorFeaturedTagsPropertyRequired,
    [ACTOR_FEATURED_TAGS_PROPERTY_MISMATCH]: actorFeaturedTagsPropertyMismatch,
    [COLLECTION_FILTERING_NOT_IMPLEMENTED]: collectionFilteringNotImplemented,
    [ACTOR_INBOX_PROPERTY_REQUIRED]: actorInboxPropertyRequired,
    [ACTOR_INBOX_PROPERTY_MISMATCH]: actorInboxPropertyMismatch,
    [ACTOR_SHARED_INBOX_PROPERTY_REQUIRED]: actorSharedInboxPropertyRequired,
    [ACTOR_SHARED_INBOX_PROPERTY_MISMATCH]: actorSharedInboxPropertyMismatch,
    [ACTOR_PUBLIC_KEY_REQUIRED]: actorPublicKeyRequired,
    [ACTOR_ASSERTION_METHOD_REQUIRED]: actorAssertionMethodRequired,
    [RSA_KEY_REQUIRED]: rsaKeyRequired,
    [ED25519_KEY_REQUIRED]: ed25519KeyRequired,
  },
};

export default plugin;
