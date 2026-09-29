---
links:
  '#1125': https://github.com/fedify-dev/fedify/issues/1125
  '#1140': https://github.com/fedify-dev/fedify/pull/1140
---
 -  Fixed `outbox-listener-delivery-required` and
    `outbox-listener-delivery-not-awaited` (`@fedify/lint`) losing track of
    the functions an object already holds when a nested helper in the
    listener assigns another property of that object, as in
    `target.fallback = () => {}`.  A listener that delivers through
    `target.deliver()` after such an assignment is no longer reported as
    undelivered, and a dropped delivery promise inside `target.deliver()` is
    now reported.  A helper that declares its own object of the same name is
    still checked separately from the outer one.  [[#1125], [#1140]]
