---
links:
  '#1044': https://github.com/fedify-dev/fedify/issues/1044
  '#1051': https://github.com/fedify-dev/fedify/pull/1051
  '#1077': https://github.com/fedify-dev/fedify/pull/1077
  '#1082': https://github.com/fedify-dev/fedify/pull/1082
  '#1084': https://github.com/fedify-dev/fedify/pull/1084
  '#1090': https://github.com/fedify-dev/fedify/issues/1090
  '#1091': https://github.com/fedify-dev/fedify/pull/1091
  '#1093': https://github.com/fedify-dev/fedify/issues/1093
  '#1097': https://github.com/fedify-dev/fedify/issues/1097
  '#1105': https://github.com/fedify-dev/fedify/pull/1105
  '#1107': https://github.com/fedify-dev/fedify/issues/1107
  '#1120': https://github.com/fedify-dev/fedify/pull/1120
  '#1129': https://github.com/fedify-dev/fedify/issues/1129
  '#1137': https://github.com/fedify-dev/fedify/pull/1137
  '#1147': https://github.com/fedify-dev/fedify/issues/1147
  '#1156': https://github.com/fedify-dev/fedify/issues/1156
  '#1158': https://github.com/fedify-dev/fedify/issues/1158
  '#1160': https://github.com/fedify-dev/fedify/issues/1160
  '#1180': https://github.com/fedify-dev/fedify/pull/1180
  '#1184': https://github.com/fedify-dev/fedify/pull/1184
  '#1194': https://github.com/fedify-dev/fedify/pull/1194
  '#1199': https://github.com/fedify-dev/fedify/pull/1199
  '#1202': https://github.com/fedify-dev/fedify/pull/1202
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#826': https://github.com/fedify-dev/fedify/issues/826
  '#829': https://github.com/fedify-dev/fedify/issues/829
  '#830': https://github.com/fedify-dev/fedify/issues/830
  '#834': https://github.com/fedify-dev/fedify/issues/834
  '#836': https://github.com/fedify-dev/fedify/issues/836
  '#837': https://github.com/fedify-dev/fedify/issues/837
  '#850': https://github.com/fedify-dev/fedify/pull/850
  '#926': https://github.com/fedify-dev/fedify/pull/926
  '#928': https://github.com/fedify-dev/fedify/pull/928
---
 -  Added support for [FEP-ef61] portable objects, whose IDs are `ap:` or
    `ap+ef61:` URIs with a DID instead of a host, e.g.,
    `ap://did:key:z6Mk.../actor`, and which are retrieved through the
    servers listed in their actors' `gateways`.  See the
    [*Portable objects*][portable objects] chapter of the manual for the
    FEP-ef61 profile that Fedify supports.  [[#288]]

     -  Generated vocabulary classes now accept portable IDs with decoded or
        percent-encoded DID authorities wherever an IRI is expected, and
        serialize them as canonical `ap+ef61:` IRIs with decoded DID
        authorities.  Inspecting vocabulary objects, e.g., with
        `console.log()`, also shows them in this form.
        [[#826], [#850], [#1156], [#1199]]

     -  Added the `gateways` property to actor classes, and the
        `digestMultibase` property to `Link` and document and media classes.
        Gateways are serialized as origins without a trailing slash.
        A portable actor that uses the `gateways` term without mapping it in
        its JSON-LD context, as tootik does, is also read.
        [[#830], [#928], [#1097], [#1202]]

     -  Added the optional `Recipient.gateways` property, through which Fedify
        delivers activities to portable inboxes.  Applications that build
        `Recipient` objects by hand, e.g., in followers collection
        dispatchers, need to set it for portable actors.  [[#1147], [#1180]]

     -  Property accessors such as `Create.getObject()` now fetch portable
        references through gateways: those in the new `gateways` option, or
        else those in the `@gateway` location hints of the reference.  A
        reference without hints that has the same DID as a portable actor it
        was reached from, e.g., the actor's `outbox`, is fetched through that
        actor's `gateways`. A fetched object is returned only if its `@id`
        identifies the referenced portable object and the verifier given as the
        new `verifyPortableObject` option accepts it, typically
        `verifyPortableObject()` from `@fedify/fedify`, or a `Context` passed
        as the options.  Portable references cannot be dereferenced without the
        option, and `crossOrigin: "trust"` does not skip these checks.
        [[#834], [#1077], [#1093], [#1105]]

     -  Property accessors tell the `verifyPortableObject` function where
        a portable object was retrieved from and which objects led to it, so
        that it can accept a portable collection without a proof if a gateway
        that its owner lists served it.  Objects embedded in such a collection
        are fetched and verified one by one.  Added the `crossOrigin`,
        `gateways`, and `verifyPortableObject` options to
        `TraverseCollectionOptions` as well.  [[#836], [#1084]]

     -  Added the `verifyPortableObject` option to the constructors,
        the `fromJsonLd()` methods, and the `clone()` methods of vocabulary
        classes, which sets the verifier that the object's property accessors
        use by default.  Objects embedded in the parsed document, and objects
        that accessors and `traverseCollection()` fetch, get the verifier of
        the call or of their parent by default, so that, e.g.,
        `(await create.getObject(ctx))?.getAttribution()` verifies portable
        objects without passing `ctx` again.  Having a default verifier does
        not mean that an object was verified.  Added
        the `inheritPortableObjectVerifier` option to property accessors and
        `TraverseCollectionOptions` to limit a verifier to a single call.
        [[#1107], [#1120], [#1129], [#1137]]

     -  Added the `verifyPortableObject` and `gateways` options to
        `LookupObjectOptions`.  With the former, `lookupObject()` looks up
        portable IDs through their `@gateway` location hints or the gateways
        given by the latter, compatible identifiers through the gateways they
        name, and the handles of portable actors through their WebFinger
        responses, trying at most five gateways per lookup.  The gateways
        that it infers from compatible identifiers, WebFinger responses, and
        location hints are passed to the `verifyPortableObject` function as
        `gatewayHints`, while `gateways` has the ones given explicitly.
        [[#837], [#1082], [#1090], [#1091], [#1158], [#1194]]

     -  `getActorHandle()` now supports portable actors.  It takes the domain
        of a portable actor's handle from the first gateway in its `gateways`,
        and returns the handle only if its WebFinger response links back to
        the actor.  [[#837], [#1082]]

     -  Exported the portable object verifier types and other types used in
        vocabulary API signatures from `@fedify/vocab`, so that custom
        verifiers can be typed without importing `@fedify/vocab-runtime`.
        [[#1160], [#1184]]

 -  Changed property accessors and `lookupObject()` so that they no longer
    trust [FEP-ef61] compatible identifiers, i.e., HTTP(S) URLs under
    a gateway's */.well-known/apgateway/* path such as
    `https://gw.example/.well-known/apgateway/did:key:z6Mk.../actor`, because
    of the origin that serves them.  Anyone can serve a compatible identifier
    for any DID, so previously anyone could serve an unsigned object that
    claimed to be someone else's portable object.
    [[#288], [#837], [#1082], [#1090], [#1091], [#1107], [#1120]]

     -  With the `verifyPortableObject` option, a compatible identifier is
        dereferenced as the portable object it stands for: through the
        gateway that it names and then the gateways in the `gateways` option,
        only if the option accepts the object.  A document fetched from
        an ordinary HTTP(S) URL is verified the same way if its final URL is
        a compatible identifier or its `@id` is a portable ID.  Malformed
        compatible identifiers are rejected without a request.

     -  Without the option, accessors keep fetching compatible identifiers as
        ordinary HTTP(S) URLs, but no longer cache the results in the parent
        objects, so that a later call with the option verifies them.
        However, accessors of an object whose ID is a portable ID or
        a compatible identifier now throw a `TypeError` (or return `null` with
        `suppressError: true`) for such references without the option, as
        for portable IDs.

     -  Accessors no longer trust an embedded object whose `@id` is
        a compatible identifier, or a portable ID with a DID other than its
        parent's, even with `crossOrigin: "trust"`; they dereference and
        verify it on its own.  Likewise, `crossOrigin: "trust"` no longer
        makes `lookupObject()` return an object with a portable `@id` from
        a document URL of another origin.

 -  Updated [FEP-fe34] cross-origin checks to understand the cryptographic
    origins of [FEP-ef61] portable IDs and DID URLs.  Property accessors and
    `lookupObject()` now treat `ap:` and `ap+ef61:` IDs and `did:key`
    verification method IDs as the same origin when their DIDs match.
    [[#288], [#829], [#926]]

 -  Changed nested serialization so that an object carrying the signed
    JSON-LD representation that `signObject()` retains is embedded with that
    exact representation, including its own `@context`, rather than being
    rebuilt under the parent's context, so that its proof keeps verifying.
    `clone()` never carries the retained representation, because a clone may
    differ from the document the proof covers.  [[#288], [#1044], [#1051]]

[FEP-ef61]: https://w3id.org/fep/ef61
[portable objects]: https://fedify.dev/manual/portable
[FEP-fe34]: https://w3id.org/fep/fe34
