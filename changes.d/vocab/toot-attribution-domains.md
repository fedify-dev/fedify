---
links:
  '#1234': https://github.com/fedify-dev/fedify/issues/1234
  '#1353': https://github.com/fedify-dev/fedify/pull/1353
---
 -  Added the `attributionDomains` property to `Application`, `Group`,
    `Organization`, `Person`, and `Service`, so applications can publish the
    domains an actor claims for Mastodon's `fediverse:creator` link credits
    without subclassing the actor types.  Each value is a bare host name
    without a scheme, port, path, or leading `*.`; Fedify treats the values as
    opaque strings and does not normalize them.  Actor serialization and
    `Update` documents that embed an actor now compact the property as
    `attributionDomains` instead of `toot:attributionDomains`, which is the key
    Mastodon reads when it refreshes an account, and parsing accepts both
    a single string value and an array of strings.  [[#1234], [#1353]]
