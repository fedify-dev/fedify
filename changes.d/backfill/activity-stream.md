---
links:
  '#1251': https://github.com/fedify-dev/fedify/issues/1251
---
 -  Added `backfillActivities()` to stream original conversation activities,
    including updates and deletions, in collection order without requiring
    their targets to resolve. It reuses collection source selection and
    traversal controls while keeping existing `backfill()` post output
    unchanged. [[#1251] by Jiwon Kwon]
