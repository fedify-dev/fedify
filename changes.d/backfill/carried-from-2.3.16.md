 -  Fixed backfill accepting `documentLoader` results with spoofed origins.
    Results whose declared ID origin differs from the requested IRI's origin
    are now ignored, including otherwise valid cross-origin redirects.
    Custom loaders must still validate IDs against the final response URL:
    pass custom JSON-LD loaders through `lookupObject()` and set `documentUrl`
    to the final response URL after redirects.
    [[GHSA-h3jv-px69-2gpj]]
 -  Fixed backfill trusting cross-origin embedded objects, which allowed a
    remote document to spoof content from another origin.  Backfill now
    dereferences these objects by their IDs before yielding them.  It also
    ignores a `documentLoader` result whose ID has a different origin from the
    requested IRI.  Consequently, objects reached through a cross-origin
    redirect are ignored.  Custom loaders should pass their JSON-LD loader to
    `lookupObject()` so it can validate the object's ID against the final
    response URL.  Backfilled objects remain unverified remote data and should
    be authenticated before they are persisted or otherwise trusted.
    [[GHSA-x58x-xx7h-7rh4]]

[GHSA-h3jv-px69-2gpj]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-h3jv-px69-2gpj
[GHSA-x58x-xx7h-7rh4]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-x58x-xx7h-7rh4
