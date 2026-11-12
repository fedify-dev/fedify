---
links:
  '#1252': https://github.com/fedify-dev/fedify/issues/1252
  '#1416': https://github.com/fedify-dev/fedify/pull/1416
---
 -  Added `contextDiscovery: "ancestors"` to backfill options to find the
    nearest usable conversation collection through `inReplyTo` ancestors when
    the seed has none. Discovery respects `maxDepth`, shares traversal budgets
    and caching, and preserves the loaded ancestor's portable history
    verification policy. Reply-tree traversal also continues after individual
    reply-target parsing failures, even when ancestor discovery is disabled.
    Reply-target lookups now propagate `interval` configuration errors.
    [[#1252], [#1416] by Jiwon Kwon]
