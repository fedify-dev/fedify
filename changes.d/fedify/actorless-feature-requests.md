---
links:
  '#1289': https://github.com/fedify-dev/fedify/issues/1289
  '#1291': https://github.com/fedify-dev/fedify/pull/1291
---
 -  Fixed the inbox rejecting FEP-7aa9 `FeatureRequest` activities without
    an `actor`, allowing applications to receive collection inclusion
    requests from Mastodon.  Requests are accepted only when authenticated
    as the referenced collection's owner.  [[#1289], [#1291]]
