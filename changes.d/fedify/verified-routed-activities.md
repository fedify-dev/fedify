 -  Fixed `Context.routeActivity()` passing the caller's unverified document to
    inbox queues and forwarding after verifying a fetched activity.  Queued
    listeners and forwarding now use the verified activity's document.
    [[GHSA-39gj-rchc-q5m3]]

[GHSA-39gj-rchc-q5m3]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-39gj-rchc-q5m3
