---
links:
  '#1248': https://github.com/fedify-dev/fedify/issues/1248
---
 -  Fixed conversation backfill skipping posts in paginated context and replies
    collections.  Backfill now follows the first and subsequent pages while
    respecting traversal limits, and retains posts already found if a page
    cannot be loaded.  [[#1248] by Jiwon Kwon]

[#1248]: https://github.com/fedify-dev/fedify/issues/1248
