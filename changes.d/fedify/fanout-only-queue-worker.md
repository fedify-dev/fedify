---
links:
  '#1389': https://github.com/fedify-dev/fedify/issues/1389
  '#1392': https://github.com/fedify-dev/fedify/pull/1392
---
 -  Fixed the fanout worker never starting when the `fanout` queue was the only
    configured queue.  `Federation.startQueue()` returned without calling
    `fanoutQueue.listen()`, so fanout messages were enqueued but never
    consumed; the implicit startup triggered by a fanout enqueue silently did
    nothing.  Both paths now start the fanout worker, and deployments that
    configure only `queue: { fanout: ... }` no longer need to add an unused
    `inbox` or `outbox` queue to make fanout delivery work.  [[#1389], [#1392]]
