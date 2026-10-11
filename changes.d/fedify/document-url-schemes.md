---
links:
  '#1292': https://github.com/fedify-dev/fedify/issues/1292
  '#1293': https://github.com/fedify-dev/fedify/pull/1293
---
 -  Fixed `getAuthenticatedDocumentLoader()` skipping URL scheme validation
    when `allowPrivateAddress` was enabled.  Unsupported schemes such as
    `ftp:`, `file:`, and `data:` are now rejected with `UrlError` before
    fetching, including redirect and alternate document targets.
    HTTP(S) URLs with private addresses remain allowed.  [[#1292], [#1293]]
