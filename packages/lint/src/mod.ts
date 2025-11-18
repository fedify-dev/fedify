import actorAssertionMethodRequired from "./rules/actor-assertion-method-required.ts";
import actorFeaturedPropertyMismatch from "./rules/actor-featured-property-mismatch.ts";
import actorFeaturedPropertyRequired from "./rules/actor-featured-property-required.ts";
import actorFeaturedTagsPropertyMismatch from "./rules/actor-featured-tags-property-mismatch.ts";
import actorFeaturedTagsPropertyRequired from "./rules/actor-featured-tags-property-required.ts";
import actorFollowersPropertyMismatch from "./rules/actor-followers-property-mismatch.ts";
import actorFollowersPropertyRequired from "./rules/actor-followers-property-required.ts";
import actorFollowingPropertyMismatch from "./rules/actor-following-property-mismatch.ts";
import actorFollowingPropertyRequired from "./rules/actor-following-property-required.ts";
import actorIdMismatch from "./rules/actor-id-mismatch.ts";
import actorIdRequired from "./rules/actor-id-required.ts";
import actorInboxPropertyMismatch from "./rules/actor-inbox-property-mismatch.ts";
import actorInboxPropertyRequired from "./rules/actor-inbox-property-required.ts";
import actorLikedPropertyMismatch from "./rules/actor-liked-property-mismatch.ts";
import actorLikedPropertyRequired from "./rules/actor-liked-property-required.ts";
import actorOutboxPropertyMismatch from "./rules/actor-outbox-property-mismatch.ts";
import actorOutboxPropertyRequired from "./rules/actor-outbox-property-required.ts";
import actorPublicKeyRequired from "./rules/actor-public-key-required.ts";
import actorSharedInboxPropertyMismatch from "./rules/actor-shared-inbox-property-mismatch.ts";
import actorSharedInboxPropertyRequired from "./rules/actor-shared-inbox-property-required.ts";
import collectionFilteringNotImplemented from "./rules/collection-filtering-not-implemented.ts";
import ed25519KeyRequiredForProof from "./rules/ed25519-key-required-for-proof.ts";
import rsaKeyRequiredForHttpSignature from "./rules/rsa-key-required-for-http-signature.ts";
import rsaKeyRequiredForLdSignature from "./rules/rsa-key-required-for-ld-signature.ts";

const plugin: Deno.lint.Plugin = {
  name: "@fedify/lint",
  rules: {
    "actor-id-required": actorIdRequired,
    "actor-id-mismatch": actorIdMismatch,
    "actor-following-property-required": actorFollowingPropertyRequired,
    "actor-following-property-mismatch": actorFollowingPropertyMismatch,
    "actor-followers-property-required": actorFollowersPropertyRequired,
    "actor-followers-property-mismatch": actorFollowersPropertyMismatch,
    "actor-outbox-property-required": actorOutboxPropertyRequired,
    "actor-outbox-property-mismatch": actorOutboxPropertyMismatch,
    "actor-liked-property-required": actorLikedPropertyRequired,
    "actor-liked-property-mismatch": actorLikedPropertyMismatch,
    "actor-featured-property-required": actorFeaturedPropertyRequired,
    "actor-featured-property-mismatch": actorFeaturedPropertyMismatch,
    "actor-featured-tags-property-required": actorFeaturedTagsPropertyRequired,
    "actor-featured-tags-property-mismatch": actorFeaturedTagsPropertyMismatch,
    "collection-filtering-not-implemented": collectionFilteringNotImplemented,
    "actor-inbox-property-required": actorInboxPropertyRequired,
    "actor-inbox-property-mismatch": actorInboxPropertyMismatch,
    "actor-shared-inbox-property-required": actorSharedInboxPropertyRequired,
    "actor-shared-inbox-property-mismatch": actorSharedInboxPropertyMismatch,
    "actor-public-key-required": actorPublicKeyRequired,
    "actor-assertion-method-required": actorAssertionMethodRequired,
    "rsa-key-required-for-http-signature": rsaKeyRequiredForHttpSignature,
    "rsa-key-required-for-ld-signature": rsaKeyRequiredForLdSignature,
    "ed25519-key-required-for-proof": ed25519KeyRequiredForProof,
  },
};

export default plugin;
