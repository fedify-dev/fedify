---
links:
  '#1017': https://github.com/fedify-dev/fedify/issues/1017
  '#1027': https://github.com/fedify-dev/fedify/pull/1027
---
 -  Changed cached actor public keys and remembered per-origin HTTP Message
    Signatures specs to expire, so a `KvStore` that never sees an explicit
    clear no longer accumulates entries for actors and origins that have
    stopped federating.  Keys expire after 30 days and specs after 90 days
    by default, and both windows are configurable through the new
    `FederationOptions.publicKeyTtl` and
    `FederationOptions.httpMessageSignaturesSpecTtl` options.
    [[#1017], [#1027] by Heewon Chae]

     -  Shortening a window trades storage for remote requests: an expired
        key has to be refetched before the next signature verification, and
        an expired spec has to be relearned by double-knocking on the next
        delivery.  Refetching fails while the peer is unavailable, so a very
        short window makes verification depend on the peer being reachable.
     -  Entries written by earlier versions of Fedify have no expiry and are
        left as they are; they gain one the next time they are written.  See
        the new *Clearing legacy cache entries* section of the
        [key–value store guide] to clear them proactively instead of waiting.

[key–value store guide]: https://fedify.dev/manual/kv
