import type { PropertyConfig } from "./types.ts";

export const FEDERATION_SETUP = `
import {
  createFederation,
  Endpoints,
  MemoryKvStore,
  InProcessMessageQueue,
} from "@fedify/fedify";

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});
` as const;

/**
 * Mapping of actor property names to their corresponding Context method names
 * and dispatcher methods.
 * Used by lint rules to validate property existence and correct method usage.
 */
export const properties = {
  id: {
    name: "id",
    path: ["id"],
    getter: "getActorUri",
    setter: "setActorDispatcher",
    requiresIdentifier: true,
  },
  following: {
    name: "following",
    path: ["following"],
    getter: "getFollowingUri",
    setter: "setFollowingDispatcher",
    requiresIdentifier: true,
  },
  followers: {
    name: "followers",
    path: ["followers"],
    getter: "getFollowersUri",
    setter: "setFollowersDispatcher",
    requiresIdentifier: true,
  },
  outbox: {
    name: "outbox",
    path: ["outbox"],
    getter: "getOutboxUri",
    setter: "setOutboxDispatcher",
    requiresIdentifier: true,
  },
  inbox: {
    name: "inbox",
    path: ["inbox"],
    getter: "getInboxUri",
    setter: "setInboxListeners",
    requiresIdentifier: true,
  },
  liked: {
    name: "liked",
    path: ["liked"],
    getter: "getLikedUri",
    setter: "setLikedDispatcher",
    requiresIdentifier: true,
  },
  featured: {
    name: "featured",
    path: ["featured"],
    getter: "getFeaturedUri",
    setter: "setFeaturedDispatcher",
    requiresIdentifier: true,
  },
  featuredTags: {
    name: "featuredTags",
    path: ["featuredTags"],
    getter: "getFeaturedTagsUri",
    setter: "setFeaturedTagsDispatcher",
    requiresIdentifier: true,
  },
  sharedInbox: {
    name: "sharedInbox",
    path: ["endpoints", "sharedInbox"],
    getter: "getInboxUri",
    setter: "setInboxListeners",
    requiresIdentifier: false,
    nested: {
      parent: "endpoints",
      wrapper: "Endpoints",
    },
  },
  publicKey: {
    name: "publicKey",
    path: ["publicKey"],
    getter: "getActorKeyPairs",
    setter: "setKeyPairsDispatcher",
    requiresIdentifier: true,
    isKeyProperty: true,
  },
  assertionMethod: {
    name: "assertionMethod",
    path: ["assertionMethod"],
    getter: "getActorKeyPairs",
    setter: "setKeyPairsDispatcher",
    requiresIdentifier: true,
    isKeyProperty: true,
  },
} as const satisfies Record<string, PropertyConfig>;

/**
 * Rule IDs for all Fedify lint rules
 */
export const RULE_IDS = {
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
