---
links:
  '#1249': https://github.com/fedify-dev/fedify/issues/1249
  '#1258': https://github.com/fedify-dev/fedify/pull/1258
---
 -  Fixed conversation backfill stopping when the context collection loader
    failed.  Failed context loads are now skipped so later configured strategies
    can still find accessible posts.  Cancellation and interval configuration
    errors continue to propagate.  [[#1249], [#1258] by Jiwon Kwon]
