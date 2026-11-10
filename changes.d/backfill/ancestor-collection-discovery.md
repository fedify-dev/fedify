---
links:
  '#1252': https://github.com/fedify-dev/fedify/issues/1252
---
 -  Added `contextDiscovery: "ancestors"` to backfill options to find the
    nearest usable conversation collection through `inReplyTo` ancestors when
    the seed has none. Discovery respects `maxDepth`, shares traversal budgets
    and caching, and preserves the loaded ancestor's portable history
    verification policy. [[#1252] by Jiwon Kwon]
