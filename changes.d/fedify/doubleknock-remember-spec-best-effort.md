---
links:
  '#1257': https://github.com/fedify-dev/fedify/issues/1257
---
 -  Fixed `doubleKnock()` rejecting an otherwise-successful delivery when
    the `HttpMessageSignaturesSpecDeterminer`'s `rememberSpec()` call
    afterward threw, e.g., because of a transient `KvStore` write failure.
    The response it already received was discarded, and the error
    propagated as if the delivery itself had failed.  `rememberSpec()`
    failures are now logged and otherwise ignored, since they only affect
    which signature spec the next delivery to the same origin tries first.
    [[#1257] by Yujin Jung]
