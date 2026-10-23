 -  Fixed DNS rebinding bypassing the SSRF protection of `lookupWebFinger()`
    on Node.js and Bun.  Deno requires a separate deployment mitigation,
    described in the `@fedify/fedify` section above, and remains vulnerable
    without it.  \[[GHSA-r48c-xx2h-fv4g]]

[GHSA-r48c-xx2h-fv4g]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-r48c-xx2h-fv4g
