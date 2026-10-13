---
links:
  '#1289': https://github.com/fedify-dev/fedify/issues/1289
  '#1290': https://github.com/fedify-dev/fedify/issues/1290
  '#1299': https://github.com/fedify-dev/fedify/pull/1299
---
 -  `featureInteraction.verifyRequest()` can now verify the [FEP-7aa9]
    `FeatureRequest` activities Mastodon sends without an `actor`.  Pass the
    inbox listener's `InboxContext.authentication` as the new `authentication`
    option; the requester is then the owner of the featured collection, who
    must have been authenticated.  [[#1289], [#1290], [#1299]]

 -  Changed `featureInteraction.verifyRequest()` to always fetch the featured
    collection from its ID and to take its owner from that document only: an
    ordinary collection must be served from the origin of its ID, a portable
    one must satisfy the FEP-ef61 policy, and it must have exactly one
    `attributedTo` value.  A collection embedded in the request, or given as
    `resolvedInteractingObject`, is no longer trusted, because anyone could
    attribute someone else's collection to themselves that way.  A request
    without an actor is no longer accepted on the strength of the collection's
    `attributedTo` alone; without `authentication`, it fails with
    `missingActor`.  New failure types `credentialsInUrl`,
    `invalidInteractingObject`, `ambiguousRequest`, and
    `unauthenticatedRequester` describe the new checks.  [[#1290], [#1299]]

[FEP-7aa9]: https://w3id.org/fep/7aa9
