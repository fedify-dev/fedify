---
links:
  '#1055': https://github.com/fedify-dev/fedify/issues/1055
  '#1060': https://github.com/fedify-dev/fedify/pull/1060
  '#1062': https://github.com/fedify-dev/fedify/issues/1062
  '#1078': https://github.com/fedify-dev/fedify/issues/1078
  '#1079': https://github.com/fedify-dev/fedify/pull/1079
---
 -  Added `UrlError.reason` to distinguish DNS resolution failures (`"dns"`)
    from disallowed URLs (`"disallowed"`) without inspecting error messages
    or `cause`.  Existing constructor calls default to `"disallowed"`.
    [[#1055], [#1060] by Jiwon Kwon\]
 -  Added the [FEP-7aa9] context to the preloaded JSON-LD contexts.  The default
    document loader now resolves <https://w3id.org/fep/7aa9> locally, so
    transient Codeberg Pages outages no longer prevent otherwise valid inbound
    documents from being parsed or verified.
    [[#1078], [#1079]]
 -  Fixed `getDocumentLoader()` following unbounded chains of alternate document
    links, which could exhaust resources during remote key and document
    resolution.  Alternate links now share the 20-hop limit and loop detection
    with HTTP redirects, and preserve the caller's cancellation signal.
    [[GHSA-97w4-f4rq-mgqm] by Adel Zaitri\]
 -  Fixed `getDocumentLoader()` logging hostnames that fail to resolve as
    “Disallowed private URL” errors, as if they had been blocked for pointing
    at a private address.  These failures are now logged as “DNS lookup
    failed for {url}” at the debug level, and the thrown `UrlError` is
    unchanged.  [[#1062]]

[FEP-7aa9]: https://w3id.org/fep/7aa9
[GHSA-97w4-f4rq-mgqm]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-97w4-f4rq-mgqm
