---
links:
  '#1248': https://github.com/fedify-dev/fedify/issues/1248
  '#1249': https://github.com/fedify-dev/fedify/issues/1249
  '#1256': https://github.com/fedify-dev/fedify/pull/1256
  '#1258': https://github.com/fedify-dev/fedify/pull/1258
---
 -  Fixed conversation backfill skipping posts in paginated context and replies
    collections.  Backfill now follows the first and subsequent pages while
    respecting traversal limits, and retains posts already found if a page
    cannot be loaded.
    [[#1248], [#1256] by Jiwon Kwon\]
 -  Fixed conversation backfill stopping when the context collection loader
    failed.  Failed context loads are now skipped so later configured strategies
    can still find accessible posts.  Cancellation and interval configuration
    errors continue to propagate.
    [[#1249], [#1258] by Jiwon Kwon\]
