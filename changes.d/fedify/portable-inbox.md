---
links:
  '#1092': https://github.com/fedify-dev/fedify/pull/1092
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#839': https://github.com/fedify-dev/fedify/issues/839
---
 -  Added delivery to [FEP-ef61] portable inboxes through the gateway endpoint,
    e.g., `POST /.well-known/apgateway/did:key:z6Mk.../users/alice/inbox`.
    Existing inbox listeners handle such a delivery with the path after the
    DID, so the inbox path `/users/{identifier}/inbox` also receives
    deliveries to the portable inbox
    `ap+ef61://did:key:z6Mk.../users/alice/inbox`.  Fedify accepts a delivery
    only if the actor dispatcher returns, for the identifier, a portable actor
    with the same DID whose `inbox` is the requested portable inbox and whose
    `gateways` include this server; otherwise, it responds with
    `404 Not Found`.  Applications without portable actors are unaffected.
    [[#288], [#839], [#1092]]

 -  Fedify now forwards an activity delivered to a portable inbox to the same
    inbox on the actor's other gateways, as FEP-ef61 recommends, if the
    activity is authenticated by its own Object Integrity Proof or Linked Data
    Signature.  Each activity is forwarded to each gateway at most once, which
    requires a `KvStore` that supports `cas()`; with other stores, Fedify logs
    a warning and does not forward.  Forwarded requests are not signed with
    HTTP Signatures.  Configure the `origin` option on gateways so that Fedify
    can tell which gateway it is regardless of the `Host` header.
    [[#288], [#839], [#1092]]

 -  Added the `Context.getPortableInboxUri()` method, which builds the portable
    inbox ID of an actor from the inbox path and a DID.  Custom
    implementations of the `Context` interface need to implement the new
    method.  [[#288], [#839], [#1092]]

 -  Added the `FederationOptions.portableInboxForwarding` option, whose
    `maxTargets`, `ttl`, and `deadline` properties change how many gateways
    a delivery is forwarded to (10 by default; `0` turns off forwarding), how
    long forwarded activities are remembered (30 days by default), and how
    long a delivery waits for forwarding without an outbox queue (10 seconds
    by default).  [[#288], [#839], [#1092]]

 -  Added the `FederationKvPrefixes.portableInboxForwarding` option, the key
    prefix for remembering forwarded activities, which defaults to
    `["_fedify", "portableInboxForwarding"]`.  [[#288], [#839], [#1092]]

[FEP-ef61]: https://w3id.org/fep/ef61
