---
links:
  '#1381': https://github.com/fedify-dev/fedify/issues/1381
  '#1390': https://github.com/fedify-dev/fedify/pull/1390
---
 -  Fixed automatic queue worker startup failures becoming unhandled promise
    rejections.  When `manuallyStartQueue` was left `false` and a `MessageQueue`
    implementation could not start listening, such as `WorkersMessageQueue` on
    Cloudflare Workers whose `listen()` throws a `TypeError`, the rejection from
    the implicit startup in inbox handling and in `Context.sendActivity()` was
    discarded.  It is now logged as a warning once per `Federation` instance,
    and a synchronous throw from one queue no longer prevents the remaining
    queues from starting.  The failed worker is not retried, so restart the
    process after fixing the queue.  `Federation.startQueue()` still rejects so
    callers that start workers deliberately see the error, and Cloudflare
    Workers deployments should set `manuallyStartQueue: true` to avoid the
    warning entirely.  [[#1381], [#1390]]
