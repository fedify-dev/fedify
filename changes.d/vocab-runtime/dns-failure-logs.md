---
links:
  '#1062': https://github.com/fedify-dev/fedify/issues/1062
---
 -  Fixed `getDocumentLoader()` logging hostnames that fail to resolve as
    “Disallowed private URL” errors, as if they had been blocked for pointing
    at a private address.  These failures are now logged as “DNS lookup
    failed for {url}” at the debug level, and the thrown `UrlError` is
    unchanged.  [[#1062]]
