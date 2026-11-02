---
links:
  '#1316': https://github.com/fedify-dev/fedify/issues/1316
---
 -  Added `setOutboundObservers()` on federation builders and instances
    for sends, original-payload forwarding, and automatic portable replication.
    Register `onBroadcast` to record producer starts and preparation results,
    and `onDelivery` for destination planning, direct handoffs, queue acceptance
    or uncertainty, and local preparation failures. Use `onAttempt` for concrete
    send results and exact HTTP exchange counts, including queued retries and
    gateway fallback, and `onHttpExchange` for each actual signed or unsigned
    fetch. Reports distinguish received responses from the selected final
    response and retain HTTP evidence alongside later local failures. Use
    `onWorker` for fanout/outbox execution results, concrete send counts, and
    actual child enqueue, retry, deferral, or abandonment actions. Worker
    reports retain accepted children through partial failures and distinguish
    unknown queue acceptance from confirmed scheduling; local completion does
    not establish backend acknowledgment or remote success. Opt in to
    independent redacted header snapshots, bounded streaming response-body
    capture with explicit byte/time limits, and privacy-filtered sender-payload
    projections. Capture summaries distinguish EOF, byte-limit uncertainty,
    deadlines, and consumer/body failures without changing HTTP outcomes;
    payload projections never claim exact wire bytes or proof validity. Error
    diagnostics now have a separate one-second budget while retaining their 1
    KiB preview limit. Reports include observation timestamps and optional
    operation trace IDs. Callbacks receive application context and independent
    grouping IDs without requiring OpenTelemetry; their errors do not replace
    the original result. Known IDs and original inbox source survive queue
    continuations. Send/forward options accept `dispatchId` for application
    correlation without deduplication, limited to 1,024 UTF-8 bytes. Routed
    inbox reports include `inboxRequestId` and informational `requestId`.
    Missing legacy relationships remain unknown. Readiness and handoff
    observations do not establish remote delivery success.
    [[#1316] by Jiwon Kwon]
