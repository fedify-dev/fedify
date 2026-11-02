---
links:
  '#1316': https://github.com/fedify-dev/fedify/issues/1316
---
 -  Added `setOutboundObservers()` on federation builders and instances to
    observe ordinary `Context.sendActivity()` starts and preparation results
    with application context and independent broadcast IDs, without requiring
    OpenTelemetry. Register `onBroadcast` to record preparation separately from
    queue acceptance and delivery success. Callbacks are awaited and their
    errors do not change the send's result. Outbox-context overrides,
    forwarding, replication, workers, and HTTP exchanges are not yet observed.
    [[#1316] by Jiwon Kwon]
