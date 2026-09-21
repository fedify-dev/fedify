---
links:
  '#1028': https://github.com/fedify-dev/fedify/issues/1028
  '#1034': https://github.com/fedify-dev/fedify/issues/1034
---
 -  Fixed `RedisKvStore.set()` failing when the `ttl` option was not a whole
    number of seconds.  The duration was handed to Redis `SETEX` unchanged, and
    `SETEX` takes only whole seconds, so the write was rejected with
    `ERR value is not an integer or out of range` instead of being stored with
    a rounded expiry.  The TTL is now rounded up to the next whole second.  A
    zero or negative duration, which `SETEX` also rejects, now stores the value
    for one second, the shortest expiry that command can express.  The
    one-second granularity is `SETEX`'s rather than Redis's; `SET` with `PX`
    supports millisecond expiries.
    [[#1028], [#1034] by Heewon Chae\]
