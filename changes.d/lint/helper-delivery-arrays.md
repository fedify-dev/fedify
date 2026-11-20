---
links:
  '#1070': https://github.com/fedify-dev/fedify/issues/1070
  '#1446': https://github.com/fedify-dev/fedify/pull/1446
---
 -  Changed `outbox-listener-delivery-not-awaited` to follow arrays of delivery
    promises returned by synchronous local helpers.  Awaiting or discarding
    such an array now produces a warning; use `Promise.all()` to wait for its
    deliveries.  Mixed or unknown helper returns remain unreported.
    [[#1070], [#1446]]
