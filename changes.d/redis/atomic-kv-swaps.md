---
links:
  '#1163': https://github.com/fedify-dev/fedify/issues/1163
  '#1167': https://github.com/fedify-dev/fedify/pull/1167
---
 -  Added atomic `RedisKvStore.cas()` for standalone Redis and Redis Cluster.
    Redis-backed deployments can now use portable inbox forwarding and other
    features that need compare-and-swap.  Custom codecs must encode equal
    values identically, and Redis must permit `EVAL`; deployments that deny
    scripting can no longer rely on the previous non-CAS fallback.
    [[#1163], [#1167]]
