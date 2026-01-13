<!-- deno-fmt-ignore-file -->

@fedify/redis: Redis drivers for Fedify
=======================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]

This package provides [Fedify]'s [`KvStore`] and [`MessageQueue`]
implementations for Redis:

 -  [`RedisKvStore`]
 -  [`RedisMessageQueue`]

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { RedisKvStore, RedisMessageQueue } from "@fedify/redis";
import { Redis, Cluster } from "ioredis";

// Using a standalone Redis instance:
const federation = createFederation({
  kv: new RedisKvStore(new Redis()),
  queue: new RedisMessageQueue(() => new Redis()),
});

// Using a Redis Cluster:
const federation = createFederation({
  kv: new RedisKvStore(new Cluster([
    { host: "127.0.0.1", port: 7000 },
    { host: "127.0.0.1", port: 7001 },
    { host: "127.0.0.1", port: 7002 },
  ])),
  queue: new RedisMessageQueue(() => new Cluster([
    { host: "127.0.0.1", port: 7000 },
    { host: "127.0.0.1", port: 7001 },
    { host: "127.0.0.1", port: 7002 },
  ])),
});
~~~~

[JSR badge]: https://jsr.io/badges/@fedify/redis
[JSR]: https://jsr.io/@fedify/redis
[npm badge]: https://img.shields.io/npm/v/@fedify/redis?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/redis
[Fedify]: https://fedify.dev/
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[`MessageQueue`]: https://jsr.io/@fedify/fedify/doc/federation/~/MessageQueue
[`RedisKvStore`]: https://jsr.io/@fedify/redis/doc/kv/~/RedisKvStore
[`RedisMessageQueue`]: https://jsr.io/@fedify/redis/doc/mq/~/RedisMessageQueue


Installation
------------

~~~~ sh
deno add jsr:@fedify/redis  # Deno
npm  add     @fedify/redis  # npm
pnpm add     @fedify/redis  # pnpm
yarn add     @fedify/redis  # Yarn
bun  add     @fedify/redis  # Bun
~~~~
