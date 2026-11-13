 -  Fixed backfill trusting cross-origin embedded objects, which allowed a
    remote document to spoof content from another origin.  Backfill now
    dereferences these objects by their IDs before yielding them.  Backfilled
    objects remain unverified remote data and should be authenticated before
    they are persisted or otherwise trusted.  \[[GHSA-x58x-xx7h-7rh4]]

[GHSA-x58x-xx7h-7rh4]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-x58x-xx7h-7rh4
