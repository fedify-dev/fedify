<!-- deno-fmt-ignore-file -->

Federation
==========

Supported federation protocols and standards
--------------------------------------------

 -  [ActivityPub] (S2S)
 -  [WebFinger]
 -  [HTTP Message Signatures] (RFC 9421)
 -  [HTTP Signatures] (draft-cavage-http-signatures-12)
 -  [Linked Data Signatures]
 -  [NodeInfo]

[ActivityPub]: https://www.w3.org/TR/activitypub/
[WebFinger]: https://datatracker.ietf.org/doc/html/rfc7033
[HTTP Message Signatures]: https://www.rfc-editor.org/rfc/rfc9421
[HTTP Signatures]: https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures-12
[Linked Data Signatures]: https://web.archive.org/web/20170923124140/https://w3c-dvcg.github.io/ld-signatures/
[NodeInfo]: https://nodeinfo.diaspora.software/


Supported FEPs
--------------

 -  [FEP-67ff][]: FEDERATION.md
 -  [FEP-f228][]: Backfilling conversations
 -  [FEP-8fcf][]: Followers collection synchronization across servers
 -  [FEP-9091][]: Export Actor Service Endpoint
 -  [FEP-f1d5][]: NodeInfo in Fediverse Software
 -  [FEP-8b32][]: Object Integrity Proofs
 -  [FEP-ef61][]: Portable objects
 -  [FEP-521a][]: Representing actor's public keys
 -  [FEP-5feb][]: Search indexing consent for actors
 -  [FEP-fe34][]: Origin-based security model
 -  [FEP-c0e0][]: Emoji reactions
 -  [FEP-e232][]: Object Links
 -  [FEP-5711][]: Inverse Properties for Collections
 -  [FEP-044f][]: Consent-respecting quote posts
 -  [FEP-7aa9][]: Featuring recommendations using a dedicated collection
 -  [FEP-22cd][]: Attributing translations
 -  [FEP-0837][]: Federated Marketplace
 -  [FEP-ae0c][]: Fediverse Relay Protocols: Mastodon and LitePub
 -  [FEP-ef61][]: Portable Objects (partial; see [below][FEP-ef61 section])

[FEP-67ff]: https://w3id.org/fep/67ff
[FEP-f228]: https://w3id.org/fep/f228
[FEP-8fcf]: https://w3id.org/fep/8fcf
[FEP-9091]: https://w3id.org/fep/9091
[FEP-f1d5]: https://w3id.org/fep/f1d5
[FEP-8b32]: https://w3id.org/fep/8b32
[FEP-ef61]: https://w3id.org/fep/ef61
[FEP-521a]: https://w3id.org/fep/521a
[FEP-5feb]: https://w3id.org/fep/5feb
[FEP-fe34]: https://w3id.org/fep/fe34
[FEP-c0e0]: https://w3id.org/fep/c0e0
[FEP-e232]: https://w3id.org/fep/e232
[FEP-5711]: https://w3id.org/fep/5711
[FEP-044f]: https://w3id.org/fep/044f
[FEP-7aa9]: https://w3id.org/fep/7aa9
[FEP-22cd]: https://w3id.org/fep/22cd
[FEP-0837]: https://w3id.org/fep/0837
[FEP-ae0c]: https://w3id.org/fep/ae0c
[FEP-ef61 section]: #fep-ef61


FEP-ef61
--------

Fedify supports a profile of [FEP-ef61] portable objects: it accepts `ap:`
and `ap+ef61:` IDs with `did:key` DIDs of Ed25519 keys, verifies their
[FEP-8b32] proofs, dereferences them through gateways, and acts as a gateway
that serves portable actors, objects, collections, and hashlink media and
accepts deliveries to portable inboxes.  It deliberately differs from the
current FEP text in two ways, which may change in Fedify 3.0:

 -  Fedify canonicalizes and serializes portable IDs with the `ap+ef61:`
    scheme instead of `ap:`, but accepts both and compares them as equal.
 -  Fedify verifies proofs nested in compound documents, such as a signed
    `Note` in a signed `Create`, with a map-local profile of its own, since
    FEP-8b32 does not define the boundaries of embedded proofs yet.

Fedify does not implement the [FEP-ae97] gateway endpoints, gateway
discovery, synchronization across gateways, key rotation, built-in
resolution of DID methods other than `did:key`, or gateways with paths.
Interoperability with other implementations is still being tested.  See the
[*Portable objects* chapter][portable objects] of the manual for the full
profile.

[FEP-ae97]: https://w3id.org/fep/ae97
[portable objects]: https://fedify.dev/manual/portable


FEP-ef61 interoperability
-------------------------

Fedify accepts the portable `Application` actor captured from tootik v0.25.4
(commit `5ce4b7fe074d7c385808be387ffcda7040842a19`), including its HTTPS
compatible identifier and `eddsa-jcs-2022` Object Integrity Proof. The actor
omits the JSON-LD mapping for `gateways`; Fedify reads that list and requires
JCS proofs to authenticate the original JSON. The unchanged response and
capture procedure are recorded in the [tootik fixture].

In a separate local HTTPS test, a freshly registered portable tootik `Person`
sent a `Follow` to a Fedify inbox. Fedify independently verified the original
Cavage RSA HTTP Signature, returned HTTP 202, and dispatched the activity to
the `Follow` listener. The inbox authenticated the activity's original
`eddsa-jcs-2022` proof; proof-authenticated delivery does not itself check the
HTTP Signature. The exact request, actor response, and procedure are recorded
in the [tootik Follow fixture]. Offline replay uses the captured time to check
the HTTP Signature's freshness; the live request used the normal current-time
check.

In the reverse direction, tootik v0.25.4 accepted a Fedify-generated portable
`Create` and stored its embedded `Note` with the expected ID, author, and
content. Fedify generated the actor and object proofs and sent the activity
through `Context.sendActivity()`. The first request received HTTP 401 with
`actor is too young`; the automatic retry received HTTP 202, followed by
database confirmation of processing. Changing the embedded note's content
without updating its proofs received HTTP 401. The [Fedify to tootik fixture]
records the original output, responses, and stored note.

This reverse test used HTTPS gateway origins without explicit ports: tootik
v0.25.4 does not recognize compatible actor IDs with an explicit port. Its
inbox authenticated the activity through its proof and skipped HTTP Signature
verification. The request carried a gateway RSA signature, but this result
does not establish independent acceptance of that signature by tootik.

Mitra v5.10.0 (commit `17340ef09d4a902f301acdcfde094f5778d72f35`) accepted
a Fedify-generated portable actor registration and processed its setup
activities. A separate portable Fedify sender, which had no registered Mitra
account, then delivered a `Create` to the registered actor's inbox. This used
native Fedify objects, default signing contexts, and `Context.sendActivity()`
with `normalizeExistingProofs: true`. Mitra returned HTTP 202 on the first RFC
9421 RSA request and its worker stored the sender's activity in the recipient's
inbox. Corrupting the HTTP Signature returned HTTP 401. This required
serializing `gateways` as origins without a trailing slash; Mitra rejected the
previous spelling with `invalid gateway URL`.

Gateway registration used a separate scratch client for Mitra's FEP-ae97
endpoint; Fedify does not provide that client. Its setup `Update` used a
compact context and Fedify's existing internal outgoing normalizer because
Mitra's embedded-object limit rejected the default actor context. This setup
workaround was separate from the native server-to-server delivery. The
[Fedify to Mitra fixture] records the results and limitations, including the
portless HTTPS gateway used for the sender because Mitra's WebFinger lookup
drops explicit gateway ports.

In the other direction, Mitra forwarded a portable `Create` submitted to its
gateway outbox by the Fedify client. Mitra signed the HTTP request with its
Cavage RSA gateway key; the activity and embedded note retained the client's
DID proofs. Fedify separately verified the HTTP Signature with the normal
current-time freshness check, returned HTTP 202 from its proof-authenticated
inbox, and dispatched the `Create` listener. The [Mitra to Fedify fixture]
records this delivery. It tests Mitra's gateway transport of client-signed
objects, rather than independent generation of DID proofs by Mitra.
Mastodon compatibility remains unverified.

[tootik fixture]: packages/fedify/test-vectors/fep-ef61/tootik-v0.25.4/README.md
[tootik Follow fixture]: packages/fedify/test-vectors/fep-ef61/tootik-v0.25.4/follow/README.md
[Fedify to tootik fixture]: packages/fedify/test-vectors/fep-ef61/tootik-v0.25.4/send/README.md
[Fedify to Mitra fixture]: packages/fedify/test-vectors/fep-ef61/mitra-v5.10.0/send/README.md
[Mitra to Fedify fixture]: packages/fedify/test-vectors/fep-ef61/mitra-v5.10.0/receive/README.md


ActivityPub
-----------

Since Fedify is a framework, what activity types it uses is up to
the application developers.  However, Fedify provides a comprehensive
set of ActivityPub vocabulary types that are commonly used in the
fediverse.

### Activity types

 -  [`Accept`]
 -  [`Add`]
 -  [`Announce`]
 -  [`AnnounceRequest`] (GoToSocial extension)
 -  [`Arrive`]
 -  [`Block`]
 -  [`ChatMessage`]
 -  [`Create`]
 -  [`Delete`]
 -  [`Dislike`]
 -  [`EmojiReact`]
 -  [`FeatureRequest`] ([FEP-7aa9])
 -  [`Flag`]
 -  [`Follow`]
 -  [`Ignore`]
 -  [`Invite`]
 -  [`Join`]
 -  [`Leave`]
 -  [`Like`]
 -  [`LikeRequest`] (GoToSocial extension)
 -  [`Listen`]
 -  [`Move`]
 -  [`Offer`]
 -  [`Question`]
 -  [`QuoteRequest`] ([FEP-044f])
 -  [`Read`]
 -  [`Reject`]
 -  [`Remove`]
 -  [`ReplyRequest`] (GoToSocial extension)
 -  [`TentativeAccept`]
 -  [`TentativeReject`]
 -  [`Travel`]
 -  [`Undo`]
 -  [`Update`]
 -  [`View`]

[`Accept`]: https://jsr.io/@fedify/vocab/doc/~/Accept
[`Add`]: https://jsr.io/@fedify/vocab/doc/~/Add
[`Announce`]: https://jsr.io/@fedify/vocab/doc/~/Announce
[`AnnounceRequest`]: https://jsr.io/@fedify/vocab/doc/~/AnnounceRequest
[`Arrive`]: https://jsr.io/@fedify/vocab/doc/~/Arrive
[`Block`]: https://jsr.io/@fedify/vocab/doc/~/Block
[`ChatMessage`]: https://jsr.io/@fedify/vocab/doc/~/ChatMessage
[`Create`]: https://jsr.io/@fedify/vocab/doc/~/Create
[`Delete`]: https://jsr.io/@fedify/vocab/doc/~/Delete
[`Dislike`]: https://jsr.io/@fedify/vocab/doc/~/Dislike
[`EmojiReact`]: https://jsr.io/@fedify/vocab/doc/~/EmojiReact
[`FeatureRequest`]: https://jsr.io/@fedify/vocab/doc/~/FeatureRequest
[`Flag`]: https://jsr.io/@fedify/vocab/doc/~/Flag
[`Follow`]: https://jsr.io/@fedify/vocab/doc/~/Follow
[`Ignore`]: https://jsr.io/@fedify/vocab/doc/~/Ignore
[`Invite`]: https://jsr.io/@fedify/vocab/doc/~/Invite
[`Join`]: https://jsr.io/@fedify/vocab/doc/~/Join
[`Leave`]: https://jsr.io/@fedify/vocab/doc/~/Leave
[`Like`]: https://jsr.io/@fedify/vocab/doc/~/Like
[`LikeRequest`]: https://jsr.io/@fedify/vocab/doc/~/LikeRequest
[`Listen`]: https://jsr.io/@fedify/vocab/doc/~/Listen
[`Move`]: https://jsr.io/@fedify/vocab/doc/~/Move
[`Offer`]: https://jsr.io/@fedify/vocab/doc/~/Offer
[`Question`]: https://jsr.io/@fedify/vocab/doc/~/Question
[`QuoteRequest`]: https://jsr.io/@fedify/vocab/doc/~/QuoteRequest
[`Read`]: https://jsr.io/@fedify/vocab/doc/~/Read
[`Reject`]: https://jsr.io/@fedify/vocab/doc/~/Reject
[`Remove`]: https://jsr.io/@fedify/vocab/doc/~/Remove
[`ReplyRequest`]: https://jsr.io/@fedify/vocab/doc/~/ReplyRequest
[`TentativeAccept`]: https://jsr.io/@fedify/vocab/doc/~/TentativeAccept
[`TentativeReject`]: https://jsr.io/@fedify/vocab/doc/~/TentativeReject
[`Travel`]: https://jsr.io/@fedify/vocab/doc/~/Travel
[`Undo`]: https://jsr.io/@fedify/vocab/doc/~/Undo
[`Update`]: https://jsr.io/@fedify/vocab/doc/~/Update
[`View`]: https://jsr.io/@fedify/vocab/doc/~/View

### Actor types

 -  [`Application`]
 -  [`Group`]
 -  [`Organization`]
 -  [`Person`]
 -  [`Service`]

[`Application`]: https://jsr.io/@fedify/vocab/doc/~/Application
[`Group`]: https://jsr.io/@fedify/vocab/doc/~/Group
[`Organization`]: https://jsr.io/@fedify/vocab/doc/~/Organization
[`Person`]: https://jsr.io/@fedify/vocab/doc/~/Person
[`Service`]: https://jsr.io/@fedify/vocab/doc/~/Service

### Object types

 -  [`AnnounceAuthorization`] (GoToSocial extension)
 -  [`Article`]
 -  [`Audio`]
 -  [`Document`]
 -  [`Event`]
 -  [`FeatureAuthorization`] ([FEP-7aa9])
 -  [`FeaturedItem`] ([FEP-7aa9])
 -  [`Image`]
 -  [`LikeAuthorization`] (GoToSocial extension)
 -  [`Note`]
 -  [`Page`]
 -  [`Place`]
 -  [`Profile`]
 -  [`Proposal`] ([FEP-0837])
 -  [`QuoteAuthorization`] ([FEP-044f])
 -  [`ReplyAuthorization`] (GoToSocial extension)
 -  [`Tombstone`]
 -  [`Video`]

[`AnnounceAuthorization`]: https://jsr.io/@fedify/vocab/doc/~/AnnounceAuthorization
[`Article`]: https://jsr.io/@fedify/vocab/doc/~/Article
[`Audio`]: https://jsr.io/@fedify/vocab/doc/~/Audio
[`Document`]: https://jsr.io/@fedify/vocab/doc/~/Document
[`Event`]: https://jsr.io/@fedify/vocab/doc/~/Event
[`FeatureAuthorization`]: https://jsr.io/@fedify/vocab/doc/~/FeatureAuthorization
[`FeaturedItem`]: https://jsr.io/@fedify/vocab/doc/~/FeaturedItem
[`Image`]: https://jsr.io/@fedify/vocab/doc/~/Image
[`LikeAuthorization`]: https://jsr.io/@fedify/vocab/doc/~/LikeAuthorization
[`Note`]: https://jsr.io/@fedify/vocab/doc/~/Note
[`Page`]: https://jsr.io/@fedify/vocab/doc/~/Page
[`Place`]: https://jsr.io/@fedify/vocab/doc/~/Place
[`Profile`]: https://jsr.io/@fedify/vocab/doc/~/Profile
[`Proposal`]: https://jsr.io/@fedify/vocab/doc/~/Proposal
[`QuoteAuthorization`]: https://jsr.io/@fedify/vocab/doc/~/QuoteAuthorization
[`ReplyAuthorization`]: https://jsr.io/@fedify/vocab/doc/~/ReplyAuthorization
[`Tombstone`]: https://jsr.io/@fedify/vocab/doc/~/Tombstone
[`Video`]: https://jsr.io/@fedify/vocab/doc/~/Video

### Collection types

 -  [`Collection`]
 -  [`CollectionPage`]
 -  [`FeaturedCollection`] ([FEP-7aa9])
 -  [`OrderedCollection`]
 -  [`OrderedCollectionPage`]

[`Collection`]: https://jsr.io/@fedify/vocab/doc/~/Collection
[`CollectionPage`]: https://jsr.io/@fedify/vocab/doc/~/CollectionPage
[`FeaturedCollection`]: https://jsr.io/@fedify/vocab/doc/~/FeaturedCollection
[`OrderedCollection`]: https://jsr.io/@fedify/vocab/doc/~/OrderedCollection
[`OrderedCollectionPage`]: https://jsr.io/@fedify/vocab/doc/~/OrderedCollectionPage

### Link types

 -  [`Link`]
 -  [`Mention`]

[`Link`]: https://jsr.io/@fedify/vocab/doc/~/Link
[`Mention`]: https://jsr.io/@fedify/vocab/doc/~/Mention

### Extended types

 -  [`Emoji`] (Mastodon extension)
 -  [`Hashtag`]
 -  [`Intent`] ([FEP-0837])
 -  [`InteractionPolicy`] (GoToSocial extension)
 -  [`InteractionRule`] (GoToSocial extension)
 -  [`Measure`] ([FEP-0837])
 -  [`PropertyValue`] (Schema.org)
 -  [`Relationship`]
 -  [`Source`]
 -  [`Translation`] ([FEP-22cd]; embedded metadata)

[`Emoji`]: https://jsr.io/@fedify/vocab/doc/~/Emoji
[`Hashtag`]: https://jsr.io/@fedify/vocab/doc/~/Hashtag
[`Intent`]: https://jsr.io/@fedify/vocab/doc/~/Intent
[`InteractionPolicy`]: https://jsr.io/@fedify/vocab/doc/~/InteractionPolicy
[`InteractionRule`]: https://jsr.io/@fedify/vocab/doc/~/InteractionRule
[`Measure`]: https://jsr.io/@fedify/vocab/doc/~/Measure
[`PropertyValue`]: https://jsr.io/@fedify/vocab/doc/~/PropertyValue
[`Relationship`]: https://jsr.io/@fedify/vocab/doc/~/Relationship
[`Source`]: https://jsr.io/@fedify/vocab/doc/~/Source
[`Translation`]: https://jsr.io/@fedify/vocab/doc/~/Translation

### Cryptographic types

 -  [`Key`]
 -  [`Multikey`]
 -  [`DataIntegrityProof`]

[`Key`]: https://jsr.io/@fedify/vocab/doc/~/Key
[`Multikey`]: https://jsr.io/@fedify/vocab/doc/~/Multikey
[`DataIntegrityProof`]: https://jsr.io/@fedify/vocab/doc/~/DataIntegrityProof

### Service types

 -  [`DidService`]
 -  [`Endpoints`]
 -  [`Export`] ([FEP-9091])

[`DidService`]: https://jsr.io/@fedify/vocab/doc/~/DidService
[`Endpoints`]: https://jsr.io/@fedify/vocab/doc/~/Endpoints
[`Export`]: https://jsr.io/@fedify/vocab/doc/~/Export
