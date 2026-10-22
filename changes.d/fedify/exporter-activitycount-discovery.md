 -  Fixed `FedifySpanExporter.getRecentTraces()`'s `activityCount` drifting
    from the number of records `getActivitiesByTraceId()` actually returns
    for a trace when a span was re-exported, and a trace becoming
    permanently undiscoverable through `getRecentTraces()` if the separate
    summary entry it depended on was never successfully written.  Both
    problems shared the same cause: counting and discovery depended on a
    separately maintained counter instead of the records that are actually
    stored.  `getRecentTraces()` now computes every summary it returns
    directly from the activity records currently retained for each trace.
    This costs a scan of every retained record on each call, so its cost
    grows with the total number of retained records rather than with how
    much changed since the previous call, and `limit` does not reduce that
    cost; a deployment that retains many traces and polls
    `getRecentTraces()` should size its polling interval, TTL, and
    `KvStore` choice accordingly.
