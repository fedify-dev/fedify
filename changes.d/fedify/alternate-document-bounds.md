 -  Fixed `getAuthenticatedDocumentLoader()` following unbounded chains of
    alternate document links, which could exhaust resources during remote key
    and document resolution.  Alternate links now share the 20-hop limit and
    loop detection with HTTP redirects, and preserve the caller's cancellation
    signal.  [[GHSA-97w4-f4rq-mgqm] by Adel Zaitri]

[GHSA-97w4-f4rq-mgqm]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-97w4-f4rq-mgqm
