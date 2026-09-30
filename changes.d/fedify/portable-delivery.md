---
links:
  '#1147': https://github.com/fedify-dev/fedify/issues/1147
  '#1180': https://github.com/fedify-dev/fedify/pull/1180
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Added delivery to [FEP-ef61] portable inboxes, i.e., `ap:` and `ap+ef61:`
    URIs, to `Context.sendActivity()` and `InboxContext.forwardActivity()`.
    They deliver an activity to the compatible identifier of such an inbox
    on one of the recipient's gateways, e.g.,
    `https://gateway.example/.well-known/apgateway/did:key:z6Mk.../actor/inbox`.
    The gateways are taken from the recipient's `gateways`, or, if it has no
    valid gateway, from the `@gateway` location hints of the inbox URI, and
    at most five of them are tried one after another until one accepts the
    activity.  Previously, such a delivery failed with
    `UrlError: Unsupported protocol: ap+ef61:`.  A recipient with no gateway
    to deliver through is skipped with a warning.  [[#288], [#1147], [#1180]]

     -  A gateway that fails with a permanent failure status, such as
        `404 Not Found`, is not tried again for the activity.  If no gateway
        accepts the activity, the whole round of gateways counts as one
        attempt of the retry policy.

     -  The `preferSharedInbox` option is ignored for recipients with portable
        inboxes, the `excludeBaseUris` option is compared with the origins of
        their gateways, and deliveries to a portable inbox are ordered by the
        actor's DID when the `orderingKey` option is given.

     -  Queue workers of older Fedify versions deliver queued activities to
        portable inboxes only through the first gateway, so upgrade them
        before the servers that enqueue deliveries.

[FEP-ef61]: https://w3id.org/fep/ef61
