 -  NodeInfo lookups now stop following a redirect when its target repeats an
    earlier URL in the same chain.  A self-redirect previously opened five
    fetch sessions before hitting the redirect limit; it now stops after the
    first response.  The existing redirect limit still applies to chains
    without cycles.
    [[GHSA-64hq-2hgr-q4pm]]

[GHSA-64hq-2hgr-q4pm]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-64hq-2hgr-q4pm
