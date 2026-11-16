---
links:
  '#1423': https://github.com/fedify-dev/fedify/issues/1423
---
 -  Added `onAcceptedDocument` to plural dereferencing accessors.  The
    synchronous callback receives each newly fetched, accepted target and its
    exact `RemoteDocument` before caching or yielding.  Embedded targets and
    cache hits do not trigger it.  The `AcceptedDocumentCallback<T>` type is
    also exported.  [[#1423] by Jiwon Kwon]
