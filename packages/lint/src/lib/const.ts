export const FEDERATION_SETUP = `
import {
  createFederation,
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
    getter: "getActorUri",
    setter: "setActorDispatcher",
  },
  following: {
    name: "following",
    getter: "getFollowingUri",
    setter: "setFollowingDispatcher",
  },
  followers: {
    name: "followers",
    getter: "getFollowersUri",
    setter: "setFollowersDispatcher",
  },
  outbox: {
    name: "outbox",
    getter: "getOutboxUri",
    setter: "setOutboxDispatcher",
  },
  inbox: {
    name: "inbox",
    getter: "getInboxUri",
    setter: "setInboxListeners",
  },
  liked: {
    name: "liked",
    getter: "getLikedUri",
    setter: "setLikedDispatcher",
  },
  featured: {
    name: "featured",
    getter: "getFeaturedUri",
    setter: "setFeaturedDispatcher",
  },
  featuredTags: {
    name: "featuredTags",
    getter: "getFeaturedTagsUri",
    setter: "setFeaturedTagsDispatcher",
  },
  sharedInbox: {
    name: "endpoints.sharedInbox",
    getter: "getInboxUri",
    setter: "setInboxListeners",
  },
} as const;
