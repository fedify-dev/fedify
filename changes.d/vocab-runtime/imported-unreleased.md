---
links:
  '#1151': https://github.com/fedify-dev/fedify/issues/1151
  '#1198': https://github.com/fedify-dev/fedify/pull/1198
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#810': https://github.com/fedify-dev/fedify/issues/810
  '#827': https://github.com/fedify-dev/fedify/issues/827
  '#828': https://github.com/fedify-dev/fedify/issues/828
  '#829': https://github.com/fedify-dev/fedify/issues/829
  '#830': https://github.com/fedify-dev/fedify/issues/830
  '#831': https://github.com/fedify-dev/fedify/issues/831
  '#912': https://github.com/fedify-dev/fedify/issues/912
  '#913': https://github.com/fedify-dev/fedify/pull/913
  '#914': https://github.com/fedify-dev/fedify/pull/914
  '#915': https://github.com/fedify-dev/fedify/pull/915
  '#924': https://github.com/fedify-dev/fedify/pull/924
  '#926': https://github.com/fedify-dev/fedify/pull/926
  '#928': https://github.com/fedify-dev/fedify/pull/928
  '#935': https://github.com/fedify-dev/fedify/pull/935
---
 -  Added SHA-256 `digestMultibase` and simple `hl:` hashlink helpers for
    computing, parsing, creating, and verifying portable media resource
    digests as required by [FEP-ef61].
    [[#831], [#935]]

 -  Added the [FEP-ef61] JSON-LD context to the preloaded context registry so
    portable actor and media documents can compact and expand `gateways` and
    `digestMultibase` without fetching the context remotely.
    [[#830], [#928]]

 -  Added `getFe34Origin()` and `haveSameFe34Origin()` for comparing ordinary
    web origins and [FEP-ef61] cryptographic origins with one shared
    [FEP-fe34] helper.  HTTP(S) URLs keep web-origin semantics, while
    `ap:`/`ap+ef61:` URIs and DID URLs use their DID component as the origin.
    [[#829], [#926]]

 -  Added `canonicalizePortableUri()` and `arePortableUrisEqual()` for
    comparing [FEP-ef61] portable ActivityPub URI strings.  The helpers accept
    `ap:` and `ap+ef61:` values with decoded or percent-encoded DID
    authorities, normalize them to `ap+ef61:`, and ignore query hints such as
    `gateways` during comparison.
    [[#828], [#924]]

    Canonicalizing to `ap+ef61:` rather than `ap:`, which FEP-ef61 currently
    recommends, is a deliberate choice of Fedify's that may change in
    Fedify 3.0.  Compare portable IDs with `arePortableUrisEqual()` rather
    than as strings.  See the [*Portable objects*][portable objects] chapter
    of the manual for the FEP-ef61 profile that Fedify supports.
    [[#288], [#1151], [#1198]]

 -  Added the [FEP-7aa9] JSON-LD context to the preloaded context registry so
    FEP-7aa9 documents can be compacted and expanded without fetching the
    context remotely.
    [[#810], [#914]]

 -  Added helpers for Ed25519 `did:key` DIDs and verification method DID
    URLs: `exportDidKey()` exports public keys to base58-btc `did:key` DIDs,
    `importDidKey()` imports supported DIDs back to `CryptoKey`, and
    `parseDidKeyVerificationMethod()` validates `did:key:z...#z...`
    verification methods.
    [[#827], [#915]]

 -  Changed `getDocumentLoader()` to reject HTML and XHTML responses that do
    not advertise an ActivityPub alternate document with a `FetchError`
    instead of attempting to parse the HTML as JSON.  This makes remote HTML
    error pages surface as document loading failures with the response URL and
    content type, rather than generic JSON parser crashes.
    [[#912], [#913]]

[FEP-ef61]: https://w3id.org/fep/ef61
[FEP-fe34]: https://w3id.org/fep/fe34
[portable objects]: https://fedify.dev/manual/portable
[FEP-7aa9]: https://w3id.org/fep/7aa9
