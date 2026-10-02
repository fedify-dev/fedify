 -  Fixed log entries emitted during an individual outbound activity delivery
    or inbound activity processing carrying the enclosing HTTP request's or
    queue worker's `traceId`/`spanId` instead of the delivery or processing
    operation's own.  Warning and error logs now match the `traceId`/`spanId`
    of the `TraceActivityRecord` that operation produces (as exposed by
    `@fedify/fedify/otel`), including when the operation runs inside a
    background queue worker, which makes it possible to correlate a failure
    log with the specific activity it belongs to.  [[#1030], [#1205] by u-zzn]
