---
links:
  '#1074': https://github.com/fedify-dev/fedify/pull/1074
  '#1077': https://github.com/fedify-dev/fedify/pull/1077
  '#1084': https://github.com/fedify-dev/fedify/pull/1084
  '#1107': https://github.com/fedify-dev/fedify/issues/1107
  '#1120': https://github.com/fedify-dev/fedify/pull/1120
  '#1151': https://github.com/fedify-dev/fedify/issues/1151
  '#1152': https://github.com/fedify-dev/fedify/issues/1152
  '#1154': https://github.com/fedify-dev/fedify/issues/1154
  '#1159': https://github.com/fedify-dev/fedify/issues/1159
  '#1176': https://github.com/fedify-dev/fedify/issues/1176
  '#1182': https://github.com/fedify-dev/fedify/pull/1182
  '#1186': https://github.com/fedify-dev/fedify/pull/1186
  '#1189': https://github.com/fedify-dev/fedify/pull/1189
  '#1190': https://github.com/fedify-dev/fedify/pull/1190
  '#1198': https://github.com/fedify-dev/fedify/pull/1198
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#826': https://github.com/fedify-dev/fedify/issues/826
  '#827': https://github.com/fedify-dev/fedify/issues/827
  '#828': https://github.com/fedify-dev/fedify/issues/828
  '#829': https://github.com/fedify-dev/fedify/issues/829
  '#830': https://github.com/fedify-dev/fedify/issues/830
  '#831': https://github.com/fedify-dev/fedify/issues/831
  '#833': https://github.com/fedify-dev/fedify/issues/833
  '#834': https://github.com/fedify-dev/fedify/issues/834
  '#836': https://github.com/fedify-dev/fedify/issues/836
  '#850': https://github.com/fedify-dev/fedify/pull/850
  '#915': https://github.com/fedify-dev/fedify/pull/915
  '#924': https://github.com/fedify-dev/fedify/pull/924
  '#926': https://github.com/fedify-dev/fedify/pull/926
  '#928': https://github.com/fedify-dev/fedify/pull/928
  '#935': https://github.com/fedify-dev/fedify/pull/935
---
 -  Added support for [FEP-ef61] portable objects, whose IDs are `ap:` or
    `ap+ef61:` URIs with a DID instead of a host, e.g.,
    `ap://did:key:z6Mk.../actor`.  See the
    [*Portable objects*][portable objects] chapter of the manual for the
    FEP-ef61 profile that Fedify supports.  [[#288]]

     -  Added `parseIri()`, `formatIri()`, `parseJsonLdId()`, and
        `haveSameIriOrigin()`, which parse, format, and compare IRIs,
        including portable IDs with decoded or percent-encoded DID
        authorities.  The `URL` objects that represent portable IDs keep
        their DIDs percent-encoded, and `formatIri()` formats them in their
        canonical form, e.g., `ap+ef61://did:key:z6Mk.../actor`.  Portable
        IDs and compatible identifiers whose paths have `.` or `..`
        segments, which the `URL` class would remove, are rejected with
        a `TypeError`.  [[#826], [#850], [#1154], [#1186]]

     -  Added `canonicalizePortableUri()` and `arePortableUrisEqual()` for
        comparing portable IDs.  They accept both schemes with decoded or
        percent-encoded DID authorities, normalize them to `ap+ef61:`, and
        ignore the query, including `@gateway` location hints.
        Fedify deliberately canonicalizes to `ap+ef61:` rather than `ap:`,
        which FEP-ef61 currently recommends, and this may change in
        Fedify 3.0, so compare portable IDs with
        `arePortableUrisEqual()` rather than as strings.
        [[#828], [#924], [#1151], [#1198]]

     -  Added `getFe34Origin()` and `haveSameFe34Origin()`, which compare
        [FEP-fe34] origins: HTTP(S) URLs have their web origins, while
        portable IDs and DID URLs have their DIDs as their cryptographic
        origins.  [[#829], [#926]]

     -  Added `exportDidKey()`, `importDidKey()`, and
        `parseDidKeyVerificationMethod()` for Ed25519 `did:key` DIDs and
        their verification method DID URLs.  `exportDidKey()` always
        encodes DIDs in base58-btc, as FEP-ef61 requires.  [[#827], [#915]]

     -  Added `toCompatibleEf61Id()` and `fromCompatibleEf61Id()` for
        converting between portable IDs and compatible identifiers, i.e.,
        HTTP(S) URLs under a gateway's */.well-known/apgateway/* path such as
        `https://example.com/.well-known/apgateway/did:key:z6Mk.../actor`,
        which software without portable ID support can use.
        `fromCompatibleEf61Id()` returns `null` for URLs that are not
        compatible identifiers, and throws a `TypeError` for malformed ones,
        including those with location hints.  Converting a compatible
        identifier does not authenticate it.  [[#833], [#1074]]

     -  Added `isGatewayUrl()` and `parseGatewayUrl()`, which check that
        a gateway is an HTTP(S) origin without credentials, a path, a query,
        or a fragment, as FEP-ef61 requires.
        [[#830], [#928], [#1176], [#1190]]

     -  Added `withGatewayHints()`, `withoutGatewayHints()`, and
        `getGatewayHints()` to add, remove, and read the `@gateway` location
        hints of portable IDs, which tell consumers where to retrieve
        a referenced portable actor.  [[#1159], [#1189]]

     -  Added SHA-256 `digestMultibase` and `hl:` hashlink helpers:
        `computeDigestMultibase()`, `parseDigestMultibase()`,
        `verifyDigestMultibase()`, `createHashlink()`, `parseHashlink()`,
        and `verifyHashlink()`.  [[#831], [#935]]

     -  Added `fetchPortableMedia()`, which retrieves the media of a portable
        object through its owner's gateways, or an HTTP(S) resource directly,
        and returns it only after verifying its `digestMultibase`.
        It limits the response size and rejects private network addresses by
        default.  [[#1152], [#1182]]

     -  Added the FEP-ef61 JSON-LD context to the preloaded contexts, so that
        `gateways` and `digestMultibase` can be compacted and expanded
        without fetching the context.  [[#830], [#928]]

     -  Added the `PortableObjectVerifier`, `PortableObjectVerifierOptions`,
        `PortableObjectVerification`, and `PortableObjectReferrer` types,
        which describe the `verifyPortableObject` option of property
        accessors.  A verifier receives a fetched document along with its
        final URL, the gateways used, and the chain of objects that referred
        to it, and can accept a collection without a proof as `unsecured`.
        [[#834], [#836], [#1077], [#1084]]

     -  Added the `verifyPortableObject` property to
        `PropertyPreprocessorContext`, the default verifier that objects
        returned by a property preprocessor should use.  [[#1107], [#1120]]

 -  Changed the `Accept` header that document loaders send when fetching
    ActivityPub objects to
    `application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"`,
    as ActivityPub and [FEP-ef61] gateways require.  Previously, the JSON-LD
    media type lacked the ActivityStreams profile.  [[#288], [#834], [#1077]]

[FEP-ef61]: https://w3id.org/fep/ef61
[portable objects]: https://fedify.dev/manual/portable
[FEP-fe34]: https://w3id.org/fep/fe34
