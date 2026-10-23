 -  Fixed DNS rebinding bypassing the SSRF protection of
    `getDocumentLoader()` on Node.js and Bun.  Deno requires a separate
    deployment mitigation, described in the `@fedify/fedify` section above,
    and remains vulnerable without it.  The document loader resolved
    a hostname once to check that it was public, and then let `fetch()`
    resolve it again to connect.  On Node.js and Bun, connections are now
    made only to the addresses that passed the check.  The behavior of
    `allowPrivateAddress` is unchanged.  [[GHSA-r48c-xx2h-fv4g]]
 -  Added [undici] `^7.30.1` as a dependency, which is used on Node.js to
    connect only to validated addresses.  [[GHSA-r48c-xx2h-fv4g]]
 -  Documented that `validatePublicUrl()` only checks the addresses
    a hostname currently resolves to and does not pin the connection, so it
    alone does not prevent DNS rebinding.  [[GHSA-r48c-xx2h-fv4g]]

[GHSA-r48c-xx2h-fv4g]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-r48c-xx2h-fv4g
[undici]: https://undici.nodejs.org/
