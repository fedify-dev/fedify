---
links:
  '#1130': https://github.com/fedify-dev/fedify/issues/1130
  '#1166': https://github.com/fedify-dev/fedify/pull/1166
---
 -  Changed HTTP Signature verification to verify at most the first three
    RFC 9421 signatures of a request, in the order of its `Signature-Input`
    header, and to ignore the rest.  Each signature may make Fedify fetch the
    key that it names from a URL of the sender's choosing, so a single
    unauthenticated request with many signatures could make Fedify fetch any
    number of URLs.  A signature counts even if it fails before its key is
    fetched, and a key is now looked up only once for all the signatures of
    a request that name it.  A request whose only valid signature comes after
    the first three is no longer accepted; senders usually put a single
    signature on a request.  [[#1130], [#1166]]

     -  Added the `FederationOptions.maxHttpSignatures` option to change the
        limit for the inbox and `RequestContext.getSignedKey()`, and the
        `maxSignatures` option of `verifyRequest()` and
        `verifyRequestDetailed()` for verifying requests directly.  Both
        have to be positive integers or `Infinity`, which turns the limit
        off; other values throw a `RangeError`.

     -  When a cached key does not verify a signature, Fedify now fetches it
        again for that signature only, instead of verifying every signature
        of the request once more without the key cache.
