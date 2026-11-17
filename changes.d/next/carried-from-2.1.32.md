---
links:
  '#1402': https://github.com/fedify-dev/fedify/issues/1402
  '#1412': https://github.com/fedify-dev/fedify/pull/1412
---
 -  Fixed `fedifyWith()` not forwarding NodeInfo document requests such as
    `GET /nodeinfo/2.1` without federation media types in their headers.
    `isNodeInfoRequest()` and `isFederationRequest()` now recognize paths under
    `/nodeinfo/` regardless of their headers, so clients using
    `Accept: application/json`, `*/*`, or no `Accept` header can reach the
    dispatcher.  Existing applications must also add
    `{ source: "/nodeinfo/:path*" }` to the `matcher` in their *middleware.ts*
    or *proxy.ts*.  Dispatchers outside `/nodeinfo/` still require explicit
    delegation to `integrateFederation()` and a matching `matcher` entry.
    [[#1402], [#1412]]
