---
links:
  '#1062': https://github.com/fedify-dev/fedify/issues/1062
  '#1065': https://github.com/fedify-dev/fedify/pull/1065
---
 -  Fixed `getAuthenticatedDocumentLoader()` and `getNodeInfo()` logging
    hostnames that fail to resolve as if they had been blocked for pointing
    at a private address, which could send operators looking for an SSRF
    attempt when a remote instance was simply gone.  These failures are now
    logged as “DNS lookup failed for {url}”: at the debug level by
    `getAuthenticatedDocumentLoader()`, and at the error level by
    `getNodeInfo()`, as with its other network failures.  [[#1062], [#1065]]
