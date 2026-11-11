 -  On Node.js, NodeInfo hostname resolution now starts at most one operating
    system DNS lookup at a time.  A lookup queued behind a slow resolver call
    can time out or be cancelled before starting, so repeated abandoned
    NodeInfo requests no longer fill the shared libuv thread pool.  An
    already-running operating system lookup cannot be cancelled.
    [[GHSA-64hq-2hgr-q4pm]]

[GHSA-64hq-2hgr-q4pm]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-64hq-2hgr-q4pm
