---
links:
  '#1055': https://github.com/fedify-dev/fedify/issues/1055
  '#1060': https://github.com/fedify-dev/fedify/pull/1060
  '#1062': https://github.com/fedify-dev/fedify/issues/1062
  '#1065': https://github.com/fedify-dev/fedify/pull/1065
  '#1108': https://github.com/fedify-dev/fedify/issues/1108
  '#1115': https://github.com/fedify-dev/fedify/issues/1115
  '#1121': https://github.com/fedify-dev/fedify/pull/1121
  '#1128': https://github.com/fedify-dev/fedify/pull/1128
---
 -  Fixed an unhandled error when a POST request has multiple RFC 9421
    signatures covering `Content-Digest` and an earlier signature fails.
    Verification now reads the body once, allowing later valid signatures
    to be accepted and invalid requests to receive `401 Unauthorized`.
    [[#1108], [#1128]]
 -  Fixed `getAuthenticatedDocumentLoader()` and `getNodeInfo()` logging
    hostnames that fail to resolve as if they had been blocked for pointing
    at a private address, which could send operators looking for an SSRF
    attempt when a remote instance was simply gone.  These failures are now
    logged as “DNS lookup failed for {url}”: at the debug level by
    `getAuthenticatedDocumentLoader()`, and at the error level by
    `getNodeInfo()`, as with its other network failures.
    [[#1062], [#1065]]
 -  Fixed `getAuthenticatedDocumentLoader()` following unbounded chains of
    alternate document links, which could exhaust resources during remote key
    and document resolution.  Alternate links now share the 20-hop limit and
    loop detection with HTTP redirects, and preserve the caller's cancellation
    signal.  \[[GHSA-97w4-f4rq-mgqm] by Adel Zaitri\]
 -  Fixed malformed activity URLs causing an unhandled error on Cloudflare
    Workers instead of a `400 Bad Request` response.
    [[#1115], [#1121]]
 -  Fixed outbound delivery raising `UrlError` instead of `FetchError` when
    resolving an inbox or redirect hostname fails or returns no usable IP
    addresses.  Applications can now distinguish these network failures from
    disallowed destinations; the original error is preserved in `cause`.
    [[#1055], [#1060] by Jiwon Kwon\]

[GHSA-97w4-f4rq-mgqm]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-97w4-f4rq-mgqm
