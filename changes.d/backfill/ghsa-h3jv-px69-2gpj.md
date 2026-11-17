 -  Fixed backfill accepting `documentLoader` results with spoofed origins.
    Results whose declared ID origin differs from the requested IRI's origin
    are now ignored, including otherwise valid cross-origin redirects.
    Custom loaders must still validate IDs against the final response URL:
    pass custom JSON-LD loaders through `lookupObject()` and set `documentUrl`
    to the final response URL after redirects.
    [[GHSA-h3jv-px69-2gpj]]

[GHSA-h3jv-px69-2gpj]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-h3jv-px69-2gpj
