---
links:
  '#1041': https://github.com/fedify-dev/fedify/pull/1041
  '#1044': https://github.com/fedify-dev/fedify/issues/1044
  '#1045': https://github.com/fedify-dev/fedify/issues/1045
  '#1051': https://github.com/fedify-dev/fedify/pull/1051
  '#1073': https://github.com/fedify-dev/fedify/pull/1073
  '#1076': https://github.com/fedify-dev/fedify/pull/1076
  '#1080': https://github.com/fedify-dev/fedify/pull/1080
  '#1082': https://github.com/fedify-dev/fedify/pull/1082
  '#1084': https://github.com/fedify-dev/fedify/pull/1084
  '#1092': https://github.com/fedify-dev/fedify/pull/1092
  '#1093': https://github.com/fedify-dev/fedify/issues/1093
  '#1094': https://github.com/fedify-dev/fedify/issues/1094
  '#1095': https://github.com/fedify-dev/fedify/issues/1095
  '#1096': https://github.com/fedify-dev/fedify/issues/1096
  '#1099': https://github.com/fedify-dev/fedify/pull/1099
  '#1100': https://github.com/fedify-dev/fedify/issues/1100
  '#1101': https://github.com/fedify-dev/fedify/issues/1101
  '#1102': https://github.com/fedify-dev/fedify/pull/1102
  '#1104': https://github.com/fedify-dev/fedify/pull/1104
  '#1105': https://github.com/fedify-dev/fedify/pull/1105
  '#1106': https://github.com/fedify-dev/fedify/issues/1106
  '#1107': https://github.com/fedify-dev/fedify/issues/1107
  '#1109': https://github.com/fedify-dev/fedify/pull/1109
  '#1110': https://github.com/fedify-dev/fedify/pull/1110
  '#1111': https://github.com/fedify-dev/fedify/issues/1111
  '#1113': https://github.com/fedify-dev/fedify/issues/1113
  '#1114': https://github.com/fedify-dev/fedify/pull/1114
  '#1119': https://github.com/fedify-dev/fedify/pull/1119
  '#1120': https://github.com/fedify-dev/fedify/pull/1120
  '#1123': https://github.com/fedify-dev/fedify/issues/1123
  '#1124': https://github.com/fedify-dev/fedify/pull/1124
  '#1132': https://github.com/fedify-dev/fedify/issues/1132
  '#1133': https://github.com/fedify-dev/fedify/issues/1133
  '#1134': https://github.com/fedify-dev/fedify/pull/1134
  '#1138': https://github.com/fedify-dev/fedify/pull/1138
  '#1142': https://github.com/fedify-dev/fedify/pull/1142
  '#1143': https://github.com/fedify-dev/fedify/issues/1143
  '#1145': https://github.com/fedify-dev/fedify/pull/1145
  '#1146': https://github.com/fedify-dev/fedify/issues/1146
  '#1147': https://github.com/fedify-dev/fedify/issues/1147
  '#1148': https://github.com/fedify-dev/fedify/issues/1148
  '#1151': https://github.com/fedify-dev/fedify/issues/1151
  '#1153': https://github.com/fedify-dev/fedify/issues/1153
  '#1154': https://github.com/fedify-dev/fedify/issues/1154
  '#1155': https://github.com/fedify-dev/fedify/issues/1155
  '#1159': https://github.com/fedify-dev/fedify/issues/1159
  '#1164': https://github.com/fedify-dev/fedify/pull/1164
  '#1165': https://github.com/fedify-dev/fedify/pull/1165
  '#1171': https://github.com/fedify-dev/fedify/pull/1171
  '#1178': https://github.com/fedify-dev/fedify/pull/1178
  '#1180': https://github.com/fedify-dev/fedify/pull/1180
  '#1183': https://github.com/fedify-dev/fedify/pull/1183
  '#1186': https://github.com/fedify-dev/fedify/pull/1186
  '#1188': https://github.com/fedify-dev/fedify/pull/1188
  '#1189': https://github.com/fedify-dev/fedify/pull/1189
  '#1198': https://github.com/fedify-dev/fedify/pull/1198
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#827': https://github.com/fedify-dev/fedify/issues/827
  '#829': https://github.com/fedify-dev/fedify/issues/829
  '#832': https://github.com/fedify-dev/fedify/issues/832
  '#835': https://github.com/fedify-dev/fedify/issues/835
  '#836': https://github.com/fedify-dev/fedify/issues/836
  '#837': https://github.com/fedify-dev/fedify/issues/837
  '#838': https://github.com/fedify-dev/fedify/issues/838
  '#839': https://github.com/fedify-dev/fedify/issues/839
  '#840': https://github.com/fedify-dev/fedify/issues/840
  '#841': https://github.com/fedify-dev/fedify/issues/841
  '#915': https://github.com/fedify-dev/fedify/pull/915
  '#926': https://github.com/fedify-dev/fedify/pull/926
  '#938': https://github.com/fedify-dev/fedify/issues/938
  '#968': https://github.com/fedify-dev/fedify/pull/968
---
 -  Added support for [FEP-ef61] portable objects, whose IDs are `ap:` or
    `ap+ef61:` URIs with a DID instead of a host, e.g.,
    `ap://did:key:z6Mk.../actor`.  A Fedify server can now act as a gateway for
    portable actors: it serves their actor documents, objects, collections, and
    hashlink media, accepts deliveries to their inboxes, and sends their
    activities.  It can also consume the portable objects of others.  The new
    [*Portable objects*][portable objects] chapter of the manual walks through
    running portable actors, and describes the FEP-ef61 profile that Fedify
    supports, including where it deliberately differs from the FEP and what it
    does not implement.  Applications without portable actors are unaffected,
    except that their dispatchers may be called for requests to the gateway
    endpoint, */.well-known/apgateway/*, and that `Context.sendActivity()` may
    reject activities that embed others' portable objects (see below).
    [[#288], [#1151], [#1198]]

     -  Added `verifyPortableObjectProof()`, which enforces the FEP-ef61 proof
        policy: a portable actor, activity, or object needs an [FEP-8b32]
        Object Integrity Proof whose `verificationMethod` is a DID URL of
        the DID in its ID, and a portable actor needs a non-empty `gateways`
        list of HTTP(S) origins.  A document whose ID is a compatible
        identifier, e.g.,
        `https://gw.example/.well-known/apgateway/did:key:z6Mk.../actor`, is
        verified against the DID in it.  Its detailed result distinguishes
        documents outside the policy, unsecured collections, missing or invalid
        proofs, invalid gateways, unsupported verification methods, and DID
        mismatches.  [[#832], [#968], [#1093], [#1105], [#1148], [#1178]]

     -  Added `verifyPortableObject()`, which verifies proofs like
        `verifyPortableObjectProof()`, and also accepts an actor's `inbox`,
        `outbox`, `followers`, `following`, or `liked` collection without
        a proof if a gateway that the actor lists served it, as FEP-ef61
        allows.  The `VerifyPortableObjectOptions`,
        `VerifyPortableObjectResult`, and `VerifyPortableObjectFailureReason`
        types describe it.  [[#836], [#1084], [#1093], [#1105]]

     -  Added the `Context.verifyPortableObject` property, which is
        `verifyPortableObject()` with the context's loaders.  Since it has
        the same name as the option of property accessors, passing a context
        as their options, e.g., `await create.getObject(ctx)`, verifies
        portable objects.  Inboxes use it as the default verifier of received
        activities, as do `Context.lookupObject()`,
        `Context.traverseCollection()`, and the `onOutboxError` callback.
        Added the `verifyPortableObject` option to `VerifyObjectOptions`.
        [[#1107], [#1120]]

     -  `verifyProof()` now resolves Ed25519 `did:key` verification methods,
        e.g., `did:key:z6Mk...#z6Mk...`, locally without fetching them, and
        `verifyObject()` accepts a proof made by a DID as authenticating
        an actor or attribution whose portable ID or compatible identifier
        has that DID.  [[#827], [#829], [#915], [#926], [#1093], [#1105]]

     -  Added the `Context.getPortableActorUri()`,
        `Context.getPortableObjectUri()`, `Context.getPortableInboxUri()`,
        `Context.getPortableOutboxUri()`, `Context.getPortableFollowingUri()`,
        `Context.getPortableFollowersUri()`, `Context.getPortableLikedUri()`,
        `Context.getPortableFeaturedUri()`,
        `Context.getPortableFeaturedTagsUri()`, and
        `Context.getPortableCollectionUri()` methods, which build portable IDs
        from the paths of the corresponding dispatchers and a DID.  Custom
        implementations of the `Context` interface need to implement them.
        [[#835], [#839], [#841], [#1076], [#1092], [#1111], [#1114], [#1142]]
        They throw a `TypeError` for a `did:key` DID that is not encoded in
        base58-btc, as FEP-ef61 requires, or for an identifier that has
        a `.` or `..` path segment.  [[#841], [#1114], [#1154], [#1186]]

     -  Added the `portable` option to `Context.parseUri()` and
        the `ParseUriOptions` interface.  With `{ portable: true }`,
        the method also recognizes portable IDs and their compatible
        identifiers, and the result has the DID in its new `authority`
        property.  [[#1143], [#1145]]

     -  Object dispatchers and the actor dispatcher now serve portable objects
        and actors through the gateway endpoint, e.g.,
        `GET /.well-known/apgateway/did:key:z6Mk.../notes/123`, with the path
        after the DID.  An object is served only if its ID canonically equals
        the requested portable ID and it has a proof made with a key of
        the DID.  A non-public object is served only if the dispatcher has
        an authorization predicate, as FEP-ef61 forbids gateways to serve it
        to anyone but its audience.  Signed tombstones are served with
        `410 Gone`.  Added the `RequestContext.portableRequest` property,
        which tells the dispatcher the requested DID and ID.
        [[#835], [#841], [#1076], [#1113], [#1114], [#1124], [#1153], [#1183]]

     -  Added the `RequestContext.isSignedByAudience()` method and
        the `IsSignedByAudienceOptions` interface, which check whether
        a request is signed by an actor in the audience of an object, e.g.,
        in the authorization predicate of an object dispatcher.  Custom
        implementations of the `RequestContext` interface need to implement
        the method.  [[#1153], [#1183]]

     -  Collection dispatchers now serve the collections of portable actors
        through the gateway endpoint, e.g.,
        `GET /.well-known/apgateway/did:key:z6Mk.../users/alice/outbox`, if
        the actor is a portable actor under the requested DID whose
        corresponding property refers to the collection.  A collection that
        is not paginated always has `totalItems`, so that consumers can tell
        an empty one from other objects.  Added
        the `CustomCollectionCallbackSetters.mapPortableOwner()` method and
        the `PortableCollectionOwnerMapper` type, which tie a custom
        collection to its portable owner.  [[#1111], [#1142]]

     -  Added `Federatable.setHashlinkMediaDispatcher()` and
        the `HashlinkMediaRequest` interface, which serve resources that
        portable objects refer to with SHA-256 hashlinks, e.g.,
        `GET /.well-known/apgateway/hl:zQm...`.  Fedify does not verify the
        dispatcher's response against the digest.  Added `hashlink_media` to
        the values of the `fedify.endpoint` metric attribute.
        [[#838], [#1080]]

     -  Inbox listeners now accept deliveries to portable inboxes through
        the gateway endpoint, e.g.,
        `POST /.well-known/apgateway/did:key:z6Mk.../users/alice/inbox`, if
        the actor dispatcher returns a portable actor whose `inbox` is
        the requested inbox and whose `gateways` include this server.
        [[#839], [#1092]]

     -  Fedify now forwards an activity delivered to a portable inbox to
        the actor's other gateways at most once, as FEP-ef61 recommends, if
        the activity is authenticated by its own proof or Linked Data
        Signature and the `KvStore` supports `cas()`.  Forwarded requests are
        signed with this server's RSA gateway key for the actor if the key
        pairs dispatcher returns one, and are sent unsigned otherwise.  An
        activity is not forwarded back to the gateway that forwarded it if
        Fedify can identify that gateway by its gateway key signature on the
        delivery.  Added the `FederationOptions.portableInboxForwarding` and
        `FederationKvPrefixes.portableInboxForwarding` options.
        [[#839], [#1092], [#1100], [#1101], [#1104], [#1110]]

     -  `Context.sendActivity()` and `InboxContext.forwardActivity()` now
        deliver to portable inboxes through the recipient's gateways, or else
        the `@gateway` location hints of the inbox, trying at most five of
        them until one accepts the activity.  Previously, such a delivery
        failed with `UrlError: Unsupported protocol: ap+ef61:`.  Queue
        workers of older Fedify versions deliver such queued activities only
        through the first gateway, so upgrade them before the servers that
        enqueue deliveries.  [[#1147], [#1180]]

     -  Added the `ActorCallbackSetters.mapPortableActorId()` method and
        the `PortableActorIdMapper` type.  For an actor that the callback
        maps to a portable ID, `Context.getActorKeyPairs()` identifies its key
        pairs by the actor's compatible identifier on this server, e.g.,
        `https://example.com/.well-known/apgateway/did:key:z6Mk.../users/alice#main-key`,
        so that they serve as this server's *gateway keys* for the actor, which
        sign HTTP requests made on behalf of the actor, but never make Object
        Integrity Proofs or Linked Data Signatures.  [[#840], [#1099]]

     -  HTTP Signature verification now accepts a gateway key of a portable
        actor if the actor document at the key ID has a valid proof by
        the actor's DID, embeds the key in its `assertionMethod`, or else in
        its `publicKey`, and lists the gateway in its `gateways`.  Such a key
        is owned by the portable actor, so
        `RequestContext.getSignedKeyOwner()`, `getKeyOwner()`, and
        `doesActorOwnKey()` return or match the actor.  Keys at compatible
        identifiers are cached apart for each purpose, for an hour at most.
        [[#840], [#1095], [#1099], [#1105], [#1119], [#1123], [#1164]]
        A key at an `ap:` key ID is accepted likewise if an actor document
        fetched through the key ID's location hints vouches for it.
        [[#1096], [#1132], [#1134], [#1165]]

     -  Inboxes accept an activity of a portable actor, or an activity with
        a portable ID, only if it has a valid proof made by the DID of that
        ID; an HTTP Signature or a Linked Data Signature does not
        authenticate it, and such an activity is rejected with
        `401 Unauthorized`.  [[#840], [#1099]]

     -  Inboxes independently verify each portable actor, activity, and
        object embedded in a compound document, e.g., the `Note` in
        a `Create`, against its own proof before dispatch, following Fedify's
        interim *map-local* profile, since neither FEP-8b32 nor Verifiable
        Credential Data Integrity defines the boundaries of embedded proofs
        yet.  A valid outer proof does not authenticate an unsigned or invalid
        embedded portable object.  Documents with proof sets, or that exceed
        the traversal limits, are rejected.  A key embedded in a verified
        portable actor needs no proof of its own if the key's ID is the actor's
        ID plus a fragment.  This profile may change in Fedify 3.0.
        [[#938], [#1041], [#1094], [#1102], [#1133], [#1138]]

     -  `Context.sendActivity()` gives an activity that contains portable
        objects at most one proof: an activity that already has one is sent
        as is, and a portable activity is signed only by the key whose ID is
        a DID URL for its DID.  An activity of a portable actor has to have
        a portable ID or a compatible identifier of the actor's DID, and never
        gets a Linked Data Signature.  Otherwise, `sendActivity()` rejects with
        a `TypeError` before anything is delivered or queued.  So does a
        non-portable activity that embeds portable objects, including ones with
        compatible identifiers, when several Ed25519 keys are available, and an
        activity with portable objects in which any map carries a proof set.
        Sign portable activities with `signObject()` beforehand, or pass the
        DID's key as an explicit sender key.
        [[#840], [#1041], [#1045], [#1073], [#1099]]

     -  Your portable actors and objects may have compatible identifiers as
        their IDs, e.g.,
        `https://example.com/.well-known/apgateway/did:key:z6Mk.../actor`,
        for interoperability with software that cannot handle portable IDs.
        Fedify treats them as portable wherever it serves or sends them, and
        warns if such an ID is malformed or is not on the owner's first
        gateway, as FEP-ef61 requires.  Build them with `toCompatibleEf61Id()`
        before signing the documents.  [[#1106], [#1109], [#1155], [#1188]]

     -  The WebFinger endpoint now serves portable actors: the domain of
        the actor's address comes from the first gateway in its `gateways`,
        and its `self` link is its compatible identifier on that gateway.
        WebFinger resources can be portable IDs, which are passed to
        `mapAlias()`.  `Context.lookupObject()` resolves the handles of
        portable actors on other servers.  [[#837], [#1082], [#1106], [#1109]]

     -  Fedify logs a warning if an actor dispatcher returns a portable actor
        whose `gateways` are invalid, or whose collections are not the
        portable IDs or compatible identifiers that the corresponding
        `Context.getPortable*Uri()` methods build, instead of warning that
        a portable actor's ID or collections do not match the URIs that
        `Context.getActorUri()` and the like build.
        [[#837], [#1082], [#1111], [#1142], [#1148], [#1178]]

     -  `Context.routeActivity()` routes a portable activity that has no
        valid proof only if all of its actors have the same DID as
        the activity, comparing [FEP-fe34] origins, where the origin of
        a portable ID or a compatible identifier is its DID.  [[#1146], [#1171]]

     -  Outbox listeners compare the `actor` of a posted activity with
        a portable outbox owner by their canonical portable IDs, so that
        the actor can be referred to with `@gateway` location hints, another
        URI scheme, or as a compatible identifier on another gateway.
        [[#1159], [#1189]]

 -  Changed Fedify to treat documents whose IDs are [FEP-ef61] compatible
    identifiers, such as
    `https://gw.example/.well-known/apgateway/did:key:z6Mk.../actor`, as
    the portable objects they stand for, as FEP-ef61 requires, instead of
    trusting them by the web origin that served them.  Previously, any server
    could act as
    `https://evil.example/.well-known/apgateway/did:key:z6MkAlice/actor`
    without a proof by Alice's DID.  Some implementations, e.g., tootik,
    identify their portable actors this way.  [[#288], [#1093], [#1105]]

     -  Inboxes now reject an activity of an actor whose ID is a compatible
        identifier with `401 Unauthorized` unless it has a valid Object
        Integrity Proof made by the actor's DID.  Activities of actors that
        publish compatible identifiers without signing them, or whose DIDs
        use key types Fedify does not support, are no longer accepted.

     -  `verifyObject()` never authenticates an attribution or actor whose ID
        is a compatible identifier by a key at an ordinary URL.

     -  HTTP Signature verification rejects a key at a compatible identifier
        unless the actor document has a valid proof by the actor's DID and
        vouches for the key.  A key at an ordinary URL that claims a portable
        actor as its owner or controller is no longer that actor's key, and
        `getKeyOwner()` and `doesActorOwnKey()` no longer resolve portable
        actors by web origin.

 -  Changed property accessors to verify the [FEP-ef61] portable objects that
    they dereference when a `Context` is passed as their options, e.g.,
    `await create.getObject(ctx)`, since the new `Context.verifyPortableObject`
    property has the same name as their `verifyPortableObject` option.  This
    also applies to objects with ordinary HTTP(S) IDs: their references to
    compatible identifiers are now verified as portable objects instead of
    being trusted because of their origin.  In inbox listeners, accessors do
    so even without options.  [[#288], [#1107], [#1120]]

 -  Fixed `signObject()` so that a signed object keeps verifying after it is
    assigned to a typed parent and the parent is serialized.  `signObject()`
    now captures the secured JSON document its proof covers, and nested
    serialization embeds that document verbatim instead of rebuilding the
    child under the parent's JSON-LD context.  Producing a compound document,
    such as a signed `Note` in a signed [FEP-ef61] portable `Create`, with
    `signObject()` no longer requires assembling the JSON by hand.
    [[#288], [#1041], [#1044], [#1051]]

     -  The captured document is a snapshot: `clone()` does not carry it, and
        mutating a signed object in place does not change it.  Sign a clone
        again when it has to be embedded as a secured child.
     -  Serialization falls back to the previous behavior for objects parsed
        with `fromJsonLd()`, objects that already carried a proof, and
        `toJsonLd()` calls whose `context` option could hide the internal
        placeholder.
     -  Outgoing JSON-LD compatibility normalization now leaves a nested
        self-contained secured document untouched while signing and sending,
        so it cannot rewrite bytes that the child's own proof covers.
        Inbound verification is unaffected.
     -  Fanout delivery now reuses the document the activity was already
        serialized into instead of reparsing and reserializing it, which
        previously invalidated an embedded signed child and the outer proof
        that covered it.

[FEP-ef61]: https://w3id.org/fep/ef61
[portable objects]: https://fedify.dev/manual/portable
[FEP-8b32]: https://w3id.org/fep/8b32
[FEP-fe34]: https://w3id.org/fep/fe34
