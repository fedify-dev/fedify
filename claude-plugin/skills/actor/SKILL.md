---
name: actor
description: >-
  Guide the user through implementing an ActivityPub actor with Fedify.
  Use when the user needs to add or configure an actor dispatcher, set up
  key pairs, configure aliases, or handle actor-related requests.
---

Help the user implement an ActivityPub actor using Fedify.

Walk through:

1.  Registering `setActorDispatcher(path, handler)` on the `Federation`
    object or `FederationBuilder`, including the `{identifier}` path
    parameter.
2.  Returning a `Person`, `Service`, or other `Actor` vocabulary object
    with the required fields (`id`, `inbox`, `publicKey`, etc.).  Set
    `attributionDomains` to bare host names when the actor should be
    credited on Mastodon link previews; Fedify does not normalize them.
3.  Chaining `.setKeyPairsDispatcher()` to supply RSA and Ed25519 keys.
4.  Optionally configuring `mapActorAlias()` for handle-based or
    fixed-path aliases.
5.  Making the actor discoverable via WebFinger. Fedify handles
    `/.well-known/webfinger` automatically once the actor dispatcher
    is registered.

Reference: <https://fedify.dev/manual/actor>
