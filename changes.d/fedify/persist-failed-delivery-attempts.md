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
    `"failed"`, and, for a failed attempt, a `failureKind` of `"http"`,
    `"transport"`, or `"policy"` and, for an HTTP failure, the response's
    `statusCode`.  Retrying the same activity and inbox no longer overwrites
    or merges earlier attempts' records, and `activityCount` in a
    `TraceSummary` now counts every attempt.  The `activitypub.activity.sent`
    span event remains reserved for a successful delivery.  [[#1257] by
    Yujin Jung]
