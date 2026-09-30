---
links:
  '#1144': https://github.com/fedify-dev/fedify/issues/1144
  '#1173': https://github.com/fedify-dev/fedify/pull/1173
---
 -  Fixed `Context.routeActivity()` passing the caller's unverified document to
    inbox queues and forwarding after verifying a fetched activity.  Queued
    listeners and forwarding now use the verified activity's document.
    [[GHSA-39gj-rchc-q5m3]]
 -  Fixed custom collections named with symbols so they can be served and
    parsed, including ordered collections and pages.  Applications using
    symbol names no longer need to replace them with strings.
    [[#1144], [#1173]]

[GHSA-39gj-rchc-q5m3]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-39gj-rchc-q5m3
