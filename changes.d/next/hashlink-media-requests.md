---
links:
  '#1149': https://github.com/fedify-dev/fedify/issues/1149
  '#1170': https://github.com/fedify-dev/fedify/pull/1170
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Added support for [FEP-ef61] hashlink media requests, e.g.,
    `GET /.well-known/apgateway/hl:zQm...`, to `fedifyWith()`.  Clients fetch
    such media with, e.g., `Accept: image/*`, so these requests were not
    passed to Fedify unless they had federation media types in their headers,
    and Next.js answered them instead of the hashlink media dispatcher.
    `isFederationRequest()` now recognizes them by their paths regardless of
    their headers.  To make Next.js run the middleware for them, add
    `{ source: "/.well-known/apgateway/:path*" }` to the `matcher` of your
    *middleware.ts* or *proxy.ts* file. [[#288], [#1149], [#1170]]

 -  Added `isHashlinkMediaRequest()` function.  [[#288], [#1149], [#1170]]

[FEP-ef61]: https://w3id.org/fep/ef61
