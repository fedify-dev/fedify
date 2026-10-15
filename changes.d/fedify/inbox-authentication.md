---
links:
  '#1289': https://github.com/fedify-dev/fedify/issues/1289
  '#1290': https://github.com/fedify-dev/fedify/issues/1290
  '#1299': https://github.com/fedify-dev/fedify/pull/1299
---
 -  Added `InboxContext.authentication`, which tells inbox listeners who Fedify
    authenticated for an incoming activity independently of its declared
    `actor`: the signers of the HTTP request, the signers of the activity's
    Linked Data Signature or Object Integrity Proofs, and the activity as Fedify
    interpreted it while authenticating it.  A valid signature does not
    authorize an activity by itself; use the new `isActorAuthenticated()`
    function to check whether a specific actor was authenticated, e.g., the
    owner of an object the activity acts on.  The new `InboxPrincipal` and
    `InboxAuthenticationEvidence` types describe the evidence.
    [[#1290], [#1299]]

 -  Added the `allowActorless` option to `InboxListenerSetters.on()`, so that
    activities declaring no `actor` at all, such as the [FEP-7aa9]
    `FeatureRequest` activities Mastodon sends, can reach a listener.  Such an
    activity is dispatched only if Fedify authenticated a principal for it and
    its `id` has the same origin as that principal; the listener must authorize
    it with `InboxContext.authentication`.  Without the option, these
    activities are still rejected with `400 Bad Request`.  An activity whose
    `actor` cannot be read, such as an anonymous actor, is never treated as
    having no actor.  Rejected deliveries are reported with the new
    `noAuthenticatedPrincipal` reason in `onRequestFinished` reports.
    [[#1289], [#1290], [#1299]]

 -  Changed the inbox to interpret each incoming activity with one set of
    JSON-LD context documents throughout signature verification and dispatch,
    and to keep that interpretation, along with the authentication evidence,
    in queued inbox messages.  Queue workers and their retries no longer load
    remote JSON-LD contexts again for such messages, so a remote context that
    changes in the meantime cannot make a listener see an activity other than
    the one that was authenticated.  An activity using a context that cannot
    be kept this way, such as one a custom context loader marks as `static`,
    is processed right away instead of being queued.  Messages queued by
    older versions are processed as before.  [[#1290], [#1299]]

 -  Added the `MessageQueue.maxMessageSize` property.  When an incoming
    activity would make an inbox message larger than the queue can hold, it is
    now processed right away instead of being enqueued.  [[#1290], [#1299]]

 -  Changed inbox queue workers to deduplicate activities with the configured
    `idempotency` strategy, as direct processing already did, instead of always
    deduplicating them per origin.  Activities recorded by workers of older
    versions are still recognized.  [[#1290], [#1299]]

[FEP-7aa9]: https://w3id.org/fep/7aa9
