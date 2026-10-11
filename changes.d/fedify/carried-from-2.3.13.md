---
links:
  '#1292': https://github.com/fedify-dev/fedify/issues/1292
  '#1293': https://github.com/fedify-dev/fedify/pull/1293
---
 -  Fixed `getAuthenticatedDocumentLoader()` skipping URL scheme validation
    when `allowPrivateAddress` was enabled.  Unsupported schemes such as
    `ftp:`, `file:`, and `data:` are now rejected with `UrlError` before
    fetching, including redirect and alternate document targets.
    HTTP(S) URLs with private addresses remain allowed.
    [[#1292], [#1293]]
 -  Fixed inboxes accepting signed activities whose IDs had a different origin
    from their actors.  Such deliveries now receive `401 Unauthorized` before
    they can supply trusted embedded objects or reserve the genuine activity's
    idempotency entry.  Queued and manually routed activities apply the same
    origin check.  \[[GHSA-4qhx-hhwf-8685]]

[GHSA-4qhx-hhwf-8685]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-4qhx-hhwf-8685
