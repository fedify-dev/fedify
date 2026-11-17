 -  On Node.js, NodeInfo hostname resolution now starts at most two operating
    system DNS lookups at a time.  Other hosts can still resolve when one
    resolver call stalls.  A queued lookup can time out or be cancelled before
    starting, so repeated abandoned NodeInfo requests cannot fill the shared
    libuv thread pool.  An already-running operating system lookup cannot be
    cancelled.
    [[GHSA-64hq-2hgr-q4pm]]

[GHSA-64hq-2hgr-q4pm]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-64hq-2hgr-q4pm
