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
 -  [FEP-521a][]: Representing actor's public keys
 -  [FEP-5feb][]: Search indexing consent for actors
 -  [FEP-fe34][]: Origin-based security model
 -  [FEP-c0e0][]: Emoji reactions
 -  [FEP-e232][]: Object Links
 -  [FEP-5711][]: Inverse Properties for Collections
 -  [FEP-044f][]: Consent-respecting quote posts
 -  [FEP-0837][]: Federated Marketplace
 -  [FEP-ae0c][]: Fediverse Relay Protocols: Mastodon and LitePub

[FEP-67ff]: https://w3id.org/fep/67ff
[FEP-f228]: https://w3id.org/fep/f228
[FEP-8fcf]: https://w3id.org/fep/8fcf
[FEP-9091]: https://w3id.org/fep/9091
[FEP-f1d5]: https://w3id.org/fep/f1d5
[FEP-8b32]: https://w3id.org/fep/8b32
[FEP-521a]: https://w3id.org/fep/521a
[FEP-5feb]: https://w3id.org/fep/5feb
[FEP-fe34]: https://w3id.org/fep/fe34
[FEP-c0e0]: https://w3id.org/fep/c0e0
[FEP-e232]: https://w3id.org/fep/e232
[FEP-5711]: https://w3id.org/fep/5711
[FEP-044f]: https://w3id.org/fep/044f
[FEP-0837]: https://w3id.org/fep/0837
[FEP-ae0c]: https://w3id.org/fep/ae0c


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
 -  [`OrderedCollection`]
 -  [`OrderedCollectionPage`]

[`Collection`]: https://jsr.io/@fedify/vocab/doc/~/Collection
[`CollectionPage`]: https://jsr.io/@fedify/vocab/doc/~/CollectionPage
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

[`Emoji`]: https://jsr.io/@fedify/vocab/doc/~/Emoji
[`Hashtag`]: https://jsr.io/@fedify/vocab/doc/~/Hashtag
[`Intent`]: https://jsr.io/@fedify/vocab/doc/~/Intent
[`InteractionPolicy`]: https://jsr.io/@fedify/vocab/doc/~/InteractionPolicy
[`InteractionRule`]: https://jsr.io/@fedify/vocab/doc/~/InteractionRule
[`Measure`]: https://jsr.io/@fedify/vocab/doc/~/Measure
[`PropertyValue`]: https://jsr.io/@fedify/vocab/doc/~/PropertyValue
[`Relationship`]: https://jsr.io/@fedify/vocab/doc/~/Relationship
[`Source`]: https://jsr.io/@fedify/vocab/doc/~/Source

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
