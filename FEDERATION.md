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
 -  [FEP-8fcf][]: Followers collection synchronization across servers
 -  [FEP-9091][]: Export Actor service
 -  [FEP-f1d5][]: NodeInfo in Fediverse Software
 -  [FEP-8b32][]: Object Integrity Proofs
 -  [FEP-521a][]: Representing actor's public keys
 -  [FEP-5feb][]: Search indexing consent for actors
 -  [FEP-fe34][]: Origin-based security model
 -  [FEP-c0e0][]: Emoji reactions
 -  [FEP-e232][]: Object Links

[FEP-67ff]: https://w3id.org/fep/67ff
[FEP-8fcf]: https://w3id.org/fep/8fcf
[FEP-9091]: https://w3id.org/fep/9091
[FEP-f1d5]: https://w3id.org/fep/f1d5
[FEP-8b32]: https://w3id.org/fep/8b32
[FEP-521a]: https://w3id.org/fep/521a
[FEP-5feb]: https://w3id.org/fep/5feb
[FEP-fe34]: https://w3id.org/fep/fe34
[FEP-c0e0]: https://w3id.org/fep/c0e0
[FEP-e232]: https://w3id.org/fep/e232


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
 -  [`Listen`]
 -  [`Move`]
 -  [`Offer`]
 -  [`Question`]
 -  [`Read`]
 -  [`Reject`]
 -  [`Remove`]
 -  [`TentativeAccept`]
 -  [`TentativeReject`]
 -  [`Travel`]
 -  [`Undo`]
 -  [`Update`]
 -  [`View`]

[`Accept`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Accept
[`Add`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Add
[`Announce`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Announce
[`Arrive`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Arrive
[`Block`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Block
[`ChatMessage`]: https://jsr.io/@fedify/fedify/doc/vocab/~/ChatMessage
[`Create`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Create
[`Delete`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Delete
[`Dislike`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Dislike
[`EmojiReact`]: https://jsr.io/@fedify/fedify/doc/vocab/~/EmojiReact
[`Flag`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Flag
[`Follow`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Follow
[`Ignore`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Ignore
[`Invite`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Invite
[`Join`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Join
[`Leave`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Leave
[`Like`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Like
[`Listen`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Listen
[`Move`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Move
[`Offer`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Offer
[`Question`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Question
[`Read`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Read
[`Reject`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Reject
[`Remove`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Remove
[`TentativeAccept`]: https://jsr.io/@fedify/fedify/doc/vocab/~/TentativeAccept
[`TentativeReject`]: https://jsr.io/@fedify/fedify/doc/vocab/~/TentativeReject
[`Travel`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Travel
[`Undo`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Undo
[`Update`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Update
[`View`]: https://jsr.io/@fedify/fedify/doc/vocab/~/View

### Actor types

 -  [`Application`]
 -  [`Group`]
 -  [`Organization`]
 -  [`Person`]
 -  [`Service`]

[`Application`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Application
[`Group`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Group
[`Organization`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Organization
[`Person`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Person
[`Service`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Service

### Object types

 -  [`Article`]
 -  [`Audio`]
 -  [`Document`]
 -  [`Event`]
 -  [`Image`]
 -  [`Note`]
 -  [`Page`]
 -  [`Place`]
 -  [`Profile`]
 -  [`Tombstone`]
 -  [`Video`]

[`Article`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Article
[`Audio`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Audio
[`Document`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Document
[`Event`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Event
[`Image`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Image
[`Note`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Note
[`Page`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Page
[`Place`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Place
[`Profile`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Profile
[`Tombstone`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Tombstone
[`Video`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Video

### Collection types

 -  [`Collection`]
 -  [`CollectionPage`]
 -  [`OrderedCollection`]
 -  [`OrderedCollectionPage`]

[`Collection`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Collection
[`CollectionPage`]: https://jsr.io/@fedify/fedify/doc/vocab/~/CollectionPage
[`OrderedCollection`]: https://jsr.io/@fedify/fedify/doc/vocab/~/OrderedCollection
[`OrderedCollectionPage`]: https://jsr.io/@fedify/fedify/doc/vocab/~/OrderedCollectionPage

### Link types

 -  [`Link`]
 -  [`Mention`]

[`Link`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Link
[`Mention`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Mention

### Extended types

 -  [`Emoji`] (Mastodon extension)
 -  [`Hashtag`]
 -  [`PropertyValue`] (Schema.org)
 -  [`Relationship`]

[`Emoji`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Emoji
[`Hashtag`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Hashtag
[`PropertyValue`]: https://jsr.io/@fedify/fedify/doc/vocab/~/PropertyValue
[`Relationship`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Relationship

### Cryptographic types

 -  [`Key`]
 -  [`Multikey`]
 -  [`DataIntegrityProof`]

[`Key`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Key
[`Multikey`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Multikey
[`DataIntegrityProof`]: https://jsr.io/@fedify/fedify/doc/vocab/~/DataIntegrityProof

### Service types

 -  [`DidService`]
 -  [`Endpoints`]

[`DidService`]: https://jsr.io/@fedify/fedify/doc/vocab/~/DidService
[`Endpoints`]: https://jsr.io/@fedify/fedify/doc/vocab/~/Endpoints
