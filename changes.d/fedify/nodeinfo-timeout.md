 -  NodeInfo lookups now time out after 10 seconds by default.  A remote server
    could previously keep `getNodeInfo()` or `Context.lookupNodeInfo()` waiting
    indefinitely by delaying a response.  The limit covers discovery,
    redirects, and the document body as one operation.  Pass a `timeout` value
    in milliseconds to allow more time, or `null` to disable the limit; a
    timed-out lookup returns `undefined`.
    [[GHSA-64hq-2hgr-q4pm]]

[GHSA-64hq-2hgr-q4pm]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-64hq-2hgr-q4pm
