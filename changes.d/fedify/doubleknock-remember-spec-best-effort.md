---
links:
  '#1257': https://github.com/fedify-dev/fedify/issues/1257
---
 -  Fixed `doubleKnock()` discarding the response it already received when
    the `HttpMessageSignaturesSpecDeterminer`'s `rememberSpec()` call
    afterward threw, e.g., because of a transient `KvStore` write failure.
    A final non-OK response now stays the outcome `sendActivity()` reports,
    with its real status, even when that bookkeeping call also fails
    afterward.  A successful response followed by a `rememberSpec()`
    failure still rejects, same as before, but `sendActivity()` now
    classifies it as a local, post-response failure and keeps the
    response's status separately from that failure, instead of reporting
    it as a generic transport failure. [[#1257] by Yujin Jung]
