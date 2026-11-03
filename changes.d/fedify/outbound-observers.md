---
links:
  '#1316': https://github.com/fedify-dev/fedify/issues/1316
  '#1359': https://github.com/fedify-dev/fedify/pull/1359
---
 -  Added application-facing outbound observers for sends, forwarding,
    replication, and queued retries, independently of OpenTelemetry. Optional
    callbacks report preparation, delivery handoffs, send/HTTP results, and
    worker actions with correlation IDs and preparation failure details.
    Applications can opt in to redacted headers, bounded streaming response
    capture, and privacy-filtered sender payloads. Inbox reports now preserve
    original request context and snapshot request cancellation without changing
    processing outcomes. Malformed optional queue metadata no longer prevents
    delivery; consumers warn and continue without its correlation facts. Error
    diagnostic reads have a one-second deadline.
    The public `Federatable` interface now requires `setOutboundObservers()`,
    breaking source compatibility for custom implementations. Update custom
    mocks, decorators, and wrappers to implement this method.
    [[#1316], [#1359] by Jiwon Kwon]
