---
links:
  '#1077': https://github.com/fedify-dev/fedify/pull/1077
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#834': https://github.com/fedify-dev/fedify/issues/834
---
 -  Changed the `Accept` header that document loaders send when fetching
    ActivityPub objects to
    `application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"`,
    as ActivityPub and [FEP-ef61] gateways require.  Previously, the JSON-LD
    media type lacked the ActivityStreams profile.  [[#288], [#834], [#1077]]

[FEP-ef61]: https://w3id.org/fep/ef61
