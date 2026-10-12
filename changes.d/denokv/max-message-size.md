---
links:
  '#1290': https://github.com/fedify-dev/fedify/issues/1290
  '#1299': https://github.com/fedify-dev/fedify/pull/1299
---
 -  `DenoKvMessageQueue` now declares the `maxMessageSize` of Deno KV, so that
    an incoming activity too large for Deno KV is processed immediately
    instead of failing to be enqueued.  [[#1290], [#1299]]
