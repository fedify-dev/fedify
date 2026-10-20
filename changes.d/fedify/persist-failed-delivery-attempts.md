---
links:
  '#1257': https://github.com/fedify-dev/fedify/issues/1257
---
 -  Added `TraceActivityRecord` entries for failed outbound delivery
    attempts.  Previously, `FedifySpanExporter` only persisted a record for
    a delivery once it succeeded, so a delivery that failed on every attempt
    left no record at all, and `~FedifySpanExporter.getRecentTraces()` could
    not surface it.  Each attempt now gets its own record, carrying the
    attempt's own `traceId`/`spanId`, a new `outcome` of `"success"` or
    `"failed"`, and, for a failed attempt, a nested `failure` object with a
    `kind` of `"http"`, `"transport"`, `"policy"`, `"local"`, or `"unknown"`,
    a `phase` of `"pre-request"`, `"request"`, `"response"`,
    `"post-response"`, or `"unknown"`, and, when the attempt's response
    status is known, its `statusCode`, including when the failure is
    `"local"` and `"post-response"`.  Retrying the same activity and inbox
    no longer overwrites or merges earlier attempts' records, and
    `activityCount` in a `TraceSummary` now counts every attempt.  The
    `activitypub.activity.sent` span event remains reserved for a
    successful delivery.
 -  Changed `~FedifySpanExporter.getRecentTraces()` to compute every
    `TraceSummary` it returns directly from the activity and worker
    records currently stored for each trace, rather than from a
    separately maintained counter.  A trace is now discoverable, and its
    `activityCount` accurate, as soon as its records are stored, with no
    further write needed, and a record that has since expired is no
    longer counted.  This costs a scan of every record retained under
    the exporter's `keyPrefix` on each call, so its cost grows with the
    total number of retained records rather than with how much changed
    since the previous call; a deployment that retains many traces and
    polls `getRecentTraces()` should size its polling interval, TTL, and
    `KvStore` choice accordingly.
 -  Added `queueAttempt` to `TraceActivityRecord`.  It carries the outbox
    queue's own retry round for an attempt dispatched from a queued message,
    which is not the same thing as a count of delivery attempts: a native
    queue redelivery can leave it unchanged, and a single round can run more
    than one attempt when trying a portable actor's gateways.  It is absent
    for an immediate send that never went through a queue.
 -  Added `TraceOutboundWorkerRecord`, exposed through the new
    `FedifySpanExporter.getWorkerRecordsByTraceId()` method and kept
    separate from `~FedifySpanExporter.getActivitiesByTraceId()`.  It
    records an outbox queue worker execution that reached a disposition of
    `"held"`, `"dropped"`, `"preparation_failed"`, or `"action_failed"`
    without necessarily ever calling `sendActivity()`, along with
    `attemptsStarted`, the number of attempts the execution actually made.
    `TraceSummary` gained a matching `outboundWorkerCount`, so a trace whose
    every execution was held or dropped is still listed by
    `~FedifySpanExporter.getRecentTraces()` even though its `activityCount`
    is `0`.  [[#1257] by Yujin Jung]
