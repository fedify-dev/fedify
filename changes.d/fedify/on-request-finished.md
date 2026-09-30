---
links:
  '#1191': https://github.com/fedify-dev/fedify/issues/1191
  '#1201': https://github.com/fedify-dev/fedify/pull/1201
---
 -  Added `onRequestFinished()` to observe every inbox delivery, including
    rejected requests and preparation errors, with signature/proof checks,
    actual verification keys, the final authentication decision, and the
    processing outcome.  The callback is awaited independently of trace
    sampling, and its errors do not change delivery results.  [[#1191], [#1201]]
