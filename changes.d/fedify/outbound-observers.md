---
links:
  '#1316': https://github.com/fedify-dev/fedify/issues/1316
---
 -  Added `setOutboundObservers()` on federation builders and instances
    for sends, original-payload forwarding, and automatic portable replication.
    Register `onBroadcast` to record producer starts and preparation results,
    and `onDelivery` for destination planning, direct handoffs, queue acceptance
    or uncertainty, and local preparation failures. Callbacks receive
    application context and independent grouping IDs without requiring
    OpenTelemetry; their errors do not replace the original result. Known IDs
    and original inbox source survive queue continuations. Send/forward options
    accept `dispatchId` for application correlation without deduplication,
    limited to 1,024 UTF-8 bytes. Routed inbox reports include `inboxRequestId`
    and informational `requestId`. Missing legacy relationships remain unknown.
    Readiness and handoff observations do not establish remote delivery success.
    [[#1316] by Jiwon Kwon]
