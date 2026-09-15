 -  Fixed `RedisKvStore.set()` failing when the `ttl` option was not a whole
    number of seconds.  The duration was handed to Redis `SETEX` unchanged, and
    `SETEX` accepts only whole seconds, so the write was rejected with
    `ERR value is not an integer or out of range` instead of being stored with
    a rounded expiry.  The TTL is now rounded up to the next whole second, and
    never below one second, which is the smallest expiry Redis can express.
    [[#1028], [#1034] by Heewon Chae]
