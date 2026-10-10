---
links:
  '#1206': https://github.com/fedify-dev/fedify/issues/1206
  '#1245': https://github.com/fedify-dev/fedify/pull/1245
---
 -  Added `isTransientFetchError()` function, which tells whether an error
    thrown by a document loader is likely transient, such as a network error,
    a timeout, a DNS failure, or an HTTP 5xx, 408, or 429 response, so that
    applications can decide whether to retry.  [[#1206], [#1245]]
