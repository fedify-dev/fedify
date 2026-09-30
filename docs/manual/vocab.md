---
description: >-
  The Activity Vocabulary is a collection of type-safe objects that represent
  the Activity Vocabulary and the vendor-specific extensions.  This section
  explains the key features of the objects.
---

Vocabulary
==========

One of the key features of Fedify library is that it provides a collection of
type-safe objects that represent the Activity Vocabulary and the vendor-specific
extensions.

There are tons of objects in the Activity Vocabulary, and it's not practical to
list all of them here.  Instead, we'll show a few examples of the objects that
are available in the library: `Create`, `Note`, and `Person`.  For the full
list of the objects, please refer to the [API reference].

> [!CAUTION]
>
> Some classes in the Activity Vocabulary have the same name as the built-in
> JavaScript classes.  For example, the `Object` class in the Activity
> Vocabulary is different from the built-in [`Object`] class.  Therefore, you
> should be careful when importing the classes in the Activity Vocabulary so
> that you don't unintentionally shadow the built-in JavaScript classes.
>
> Here's a list of the classes in the Activity Vocabulary that have the same
> name as the built-in JavaScript classes:
>
>  -  `Image`
>  -  `Object`
>
> In order to avoid the conflict, you can alias the classes in the Activity
> Vocabulary when importing them.  For example, you can alias the `Object`
> class as `ASObject` as follows:
>
> ~~~~ typescript twoslash
> import { Object as ASObject } from "@fedify/vocab";
> ~~~~
>
> Or, you can import the classes from the Activity Vocabulary with a prefix as
> follows:
>
> ~~~~ typescript
> import * as vocab from "@fedify/vocab";
> ~~~~

[API reference]: https://jsr.io/@fedify/vocab/doc/~
[`Object`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object


Installation
------------

The `@fedify/vocab` package is available on [JSR] and [npm].  You can install
it using the following command:

::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/vocab
~~~~

~~~~ bash [npm]
npm add @fedify/vocab
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/vocab
~~~~

~~~~ bash [Yarn]
yarn add @fedify/vocab
~~~~

~~~~ bash [Bun]
bun add @fedify/vocab
~~~~

:::

[JSR]: https://jsr.io/@fedify/vocab
[npm]: https://www.npmjs.com/package/@fedify/vocab


Instantiation
-------------

You can instantiate an object by calling the constructor function with an object
that contains the properties of the object.  The following shows an example of
instantiating a `Create` object:

~~~~ typescript twoslash
import { Create, Note } from "@fedify/vocab";

const create = new Create({
  id: new URL("https://example.com/activities/123"),
  actor: new URL("https://example.com/users/alice"),
  object: new Note({
    id: new URL("https://example.com/notes/456"),
    content: "Hello, world!",
    published: Temporal.Instant.from("2024-01-01T00:00:00Z"),
  }),
});
~~~~

Note that every URI is represented as a [`URL`] object.  This is for
distinguishing the URIs from the other strings.

> [!TIP]
> You can instantiate an object from a JSON-LD document by calling the
> `fromJsonLd()` method of the object.  See the [*JSON-LD* section](#json-ld)
> for details.

[`URL`]: https://developer.mozilla.org/en-US/docs/Web/API/URL


Properties
----------

Every object in the Activity Vocabulary has a set of properties.  The properties
are categorized into the following types:

 -  Functional or non-functional
 -  Scalar or non-scalar

<dfn>Functional properties</dfn> are the properties that contain zero or
a single value, while <dfn>non-functional</dfn> properties are the properties
that contain zero or multiple values.

<dfn>Scalar properties</dfn> can contain only [scalar values](#scalar-types)
(e.g., string, number, boolean, URI), while <dfn>non-scalar properties</dfn>
can contain both scalar and non-scalar values. Objects like `Create`, `Note`,
and `Person` are non-scalar values.  Non-scalar properties can contain either
objects or URIs (object ID) of the objects.

Depending on the category of the property, the accessors of the property are
different.  The following table shows examples of the accessors:

|            | Functional                            | Non-functional                                                                         |
| ---------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| Scalar     | `Object.published`                    | `Object.name`/`~Object.names`                                                          |
| Non-scalar | `Person.inboxId`/`~Person.getInbox()` | `Activity.actorId`/`~Activity.actorIds`/`~Activity.getActor()`/`~Activity.getActors()` |

Some non-functional properties have both singular and plural accessors for
the sake of convenience.  In such cases, the singular accessors return the first
value of the property, while the plural accessors return all values of the
property.

> [!NOTE]
> Some of the properties in Activity Vocabulary have been renamed in Fedify:
>
> | Original name                | Accessor in Fedify                                                                                                                      |
> | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
> | [`alsoKnownAs`]              | `Application.getAliases()`/`Group.getAliases()`/`Organization.getAliases()`/`Person.getAliases()`/`Service.getAliases()`                |
> | [`anyOf`]                    | `Question.getInclusiveOptions()`                                                                                                        |
> | [`attributedTo`]             | `Object.getAttributions()`                                                                                                              |
> | [`hasNumericalValue`]        | `Measure.numericalValue`                                                                                                                |
> | [`hasUnit`]                  | `Measure.unit`                                                                                                                          |
> | [`hreflang`]                 | `Link.language`                                                                                                                         |
> | [`inLanguage`]               | `Translation.language`                                                                                                                  |
> | [`inReplyTo`]                | `Object.getReplyTargets()`                                                                                                              |
> | [`isBasedOn`]                | `Translation.basis`                                                                                                                     |
> | [`isCat`]                    | `Application.cat`/`Group.cat`/`Organization.cat`/`Person.cat`/`Service.cat`                                                             |
> | [`movedTo`]                  | `Application.getSuccessor()`/`Group.getSuccessor()`/`Organization.getSuccessor()`/`Person.getSuccessor()`/`Service.getSuccessor()`      |
> | [`oneOf`]                    | `Question.getExclusiveOptions()`                                                                                                        |
> | [`orderedItems`]             | `OrderedCollection.getItems()`                                                                                                          |
> | [`publicKeyMultibase`]       | `Multikey.publicKey`                                                                                                                    |
> | [`publicKeyPem`]             | `CryptographicKey.publicKey`                                                                                                            |
> | [`quoteUri`]                 | `Article.quoteUrl`/`ChatMessage.quoteUrl`/`Note.quoteUrl`/`Question.quoteUrl`                                                           |
> | [`translationOfWork`]        | `Translation.original`                                                                                                                  |
> | [`votersCount`]              | `Question.voters`                                                                                                                       |
> | [`_misskey_followedMessage`] | `Application.followedMessage`/`Group.followedMessage`/`Organization.followedMessage`/`Person.followedMessage`/`Service.followedMessage` |
> | [`_misskey_quote`]           | `Article.quoteUrl`/`ChatMessage.quoteUrl`/`Note.quoteUrl`/`Question.quoteUrl`                                                           |

> [!NOTE]
>
> Fedify exposes both the legacy `quoteUrl` compatibility surface and the
> newer [FEP-044f] `quote` surface for quote posts.
>
>  -  `Article.quoteUrl`, `ChatMessage.quoteUrl`, `Note.quoteUrl`, and
>     `Question.quoteUrl` map to the legacy `quoteUrl`, `quoteUri`, and
>     `_misskey_quote` properties.
>  -  `Article.quoteId`/`Article.getQuote()`, `ChatMessage.quoteId`/
>     `ChatMessage.getQuote()`, `Note.quoteId`/`Note.getQuote()`, and
>     `Question.quoteId`/`Question.getQuote()` represent the
>     [FEP-044f] `quote` property.

[`alsoKnownAs`]: https://www.w3.org/TR/did-core/#dfn-alsoknownas
[`anyOf`]: https://www.w3.org/TR/activitystreams-vocabulary/#dfn-anyof
[`attributedTo`]: https://www.w3.org/TR/activitystreams-vocabulary/#dfn-attributedto
[`hasNumericalValue`]: http://www.ontology-of-units-of-measure.org/resource/om-2/hasNumericalValue
[`hasUnit`]: http://www.ontology-of-units-of-measure.org/resource/om-2/hasUnit
[`hreflang`]: https://www.w3.org/TR/activitystreams-vocabulary/#dfn-hreflang
[`inLanguage`]: https://schema.org/inLanguage
[`inReplyTo`]: https://www.w3.org/TR/activitystreams-vocabulary/#dfn-inreplyto
[`isBasedOn`]: https://schema.org/isBasedOn
[`isCat`]: https://misskey-hub.net/ns#iscat
[`movedTo`]: https://swicg.github.io/miscellany/#movedTo
[`oneOf`]: https://www.w3.org/TR/activitystreams-vocabulary/#dfn-oneof
[`orderedItems`]: https://www.w3.org/TR/activitystreams-vocabulary/#dfn-items
[`publicKeyMultibase`]: https://www.w3.org/TR/controller-document/#dfn-publickeymultibase
[`publicKeyPem`]: https://web.archive.org/web/20221218063101/https://web-payments.org/vocabs/security#publicKey
[`quoteUri`]: https://github.com/fedibird/mastodon?tab=readme-ov-file#quotes
[`translationOfWork`]: https://schema.org/translationOfWork
[`votersCount`]: https://docs.joinmastodon.org/spec/activitypub/#poll-specific-properties
[`_misskey_followedMessage`]: https://misskey-hub.net/ns#_misskey_followedmessage
[`_misskey_quote`]: https://misskey-hub.net/ns#_misskey_quote
[FEP-044f]: https://w3id.org/fep/044f


FEP-ef61 portable objects
-------------------------

*This section is applicable since Fedify 2.4.0.*

Fedify accepts [FEP-ef61] portable ActivityPub IRIs in JSON-LD input.  Both
the `ap:` and `ap+ef61:` schemes are accepted.  DID delimiters in the authority
can be percent-encoded for URL-safe input, as in
`ap+ef61://did%3Akey%3A.../actor`.  Fedify stores these IRIs as `URL` objects
with a URL-safe authority internally, and serializes them as canonical
`ap+ef61:` IRIs with the decoded DID authority.  This is one of the deliberate
choices of the FEP-ef61 profile that Fedify supports; see the [*Portable
objects* chapter](./portable.md) for the profile as a whole.

When comparing portable object IDs, use `canonicalizePortableUri()` or
`arePortableUrisEqual()` from `@fedify/vocab-runtime`; these helpers remove
the query, including [location hints](#location-hints), according to
FEP-ef61.  Pass raw URI strings to these comparison helpers, because
JavaScript `URL` objects normalize opaque path segments before Fedify can
compare them.  Serialization keeps the query intact.

Portable IDs whose paths contain a `.` or `..` segment cannot be represented
by Fedify's `URL`-based APIs: JavaScript and HTTP URL parsers remove these
segments, including percent-encoded spellings such as `%2e%2e`.  Fedify
rejects raw portable and compatible ID strings with such paths rather than
mistaking `/a/../b` for `/b`.  This includes JSON-LD input, portable URI
helpers, compatible ID conversion, and portable lookups.  Raw strings can
still be compared with `canonicalizePortableUri()` or
`arePortableUrisEqual()`, which preserve the opaque path.  A `URL` object
passed to Fedify may already have lost the original path before Fedify sees
it, so keep the original string when checking an untrusted identifier.  No
portable object with a dot-segment ID can be reliably served or fetched
through the FEP-ef61 HTTP gateway path.

Portable IDs also participate in Fedify's origin-based security model.  An
`ap:` or `ap+ef61:` URI is owned by the DID in its authority component, and a
DID URL such as `did:key:z...#z...` is owned by its DID component.  See the
[*Origin-based security model* section](#origin-based-security-model) for how
this affects property access.

Actor classes expose the FEP-ef61 `gateways` term as an ordered list:

~~~~ typescript twoslash
import { Person } from "@fedify/vocab";

const actor = new Person({
  id: new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor"),
  gateways: [
    new URL("https://server1.example/"),
    new URL("https://server2.example/"),
  ],
});
~~~~

Each gateway must be an HTTP(S) base URI with no path, query, or fragment.

Software that does not understand portable IRIs can still refer to portable
objects through *compatible identifiers*: HTTP(S) URLs under a gateway's
fixed `/.well-known/apgateway/` path.  Use `toCompatibleEf61Id()` to build
one from a portable ID and a gateway origin, which should be the first item in
the actor's `gateways`, and `fromCompatibleEf61Id()` to get the portable ID
back:

~~~~ typescript twoslash
import {
  canonicalizePortableUri,
  fromCompatibleEf61Id,
  toCompatibleEf61Id,
} from "@fedify/vocab-runtime";

const compatibleId = toCompatibleEf61Id(
  "ap+ef61://did:key:z6Mkabc/objects/1",
  "https://server1.example",
);
// https://server1.example/.well-known/apgateway/did:key:z6Mkabc/objects/1

const portableId = fromCompatibleEf61Id(compatibleId);
if (portableId != null) {
  canonicalizePortableUri(portableId.href);
  // ap+ef61://did:key:z6Mkabc/objects/1
}
~~~~

`toCompatibleEf61Id()` removes location hints (`@gateway` query parameters,
and the legacy `gateways` parameter) from the query, because FEP-ef61 forbids
them in compatible identifiers.
`fromCompatibleEf61Id()` returns `null` for URLs that are not compatible
identifiers, and throws a `TypeError` for compatible identifiers that are
malformed or carry location hints.  Arbitrary gateway paths are not supported
yet.

> [!WARNING]
>
> A compatible identifier only tells you which portable object it *claims* to
> be.  Anyone can serve a compatible identifier for any DID from their own
> server, so the gateway's host is neither the object's origin nor authorized
> to act for the DID.  Verify the object's Object Integrity Proof against the
> DID before trusting it.

[FEP-ef61]: https://w3id.org/fep/ef61

### Location hints

A portable ID says nothing about where the object can be retrieved.  So when
an object refers to a portable actor, e.g., in its `attributedTo` or `to`,
FEP-ef61 recommends adding the actor's gateways to the reference as
`@gateway` query parameters, which are called *location hints*:

~~~~ text
ap://did:key:z6Mk.../actor?@gateway=https%3A%2F%2Fserver1.example&@gateway=https%3A%2F%2Fserver2.example
~~~~

Use `withGatewayHints()` from `@fedify/vocab-runtime` to add them, rather
than editing the query by hand.  It takes a portable ID and gateways, such as
the actor's `gateways`, and returns a copy of the ID with the hints:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
import { type Actor, Note } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const did = "did:key:z6Mk...";
const recipient = null as unknown as Actor;
// ---cut-before---
import { withGatewayHints } from "@fedify/vocab-runtime";

// The gateways of the local actor, i.e., its `gateways` property:
const gateways = [new URL("https://example.com")];

const note = new Note({
  // The object's own ID has no hints:
  id: ctx.getPortableObjectUri(Note, { id: "1" }, did),
  // ap+ef61://did:key:z6Mk.../users/alice?@gateway=https%3A%2F%2Fexample.com
  attribution: withGatewayHints(
    ctx.getPortableActorUri("alice", did),
    gateways,
  ),
  // A remote portable actor, with the gateways from its actor document:
  to: withGatewayHints(recipient.id!, recipient.gateways),
  content: "Hello!",
});
~~~~

`withGatewayHints()` replaces the hints that the ID already has, keeps its
other query parameters and fragment, and drops duplicate gateways.  Each
gateway has to be an HTTP(S) origin with no path, query, or fragment.
`withoutGatewayHints()` removes the hints, and `getGatewayHints()` returns
the valid gateways in them.  All three accept only `ap:` and `ap+ef61:` URIs,
and throw a `TypeError` for anything else, including compatible identifiers,
which FEP-ef61 forbids to have hints.

Keep the following in mind:

 -  Put hints on references to portable actors: `actor`, `attributedTo`,
    `to`, `cc`, `bto`, `bcc`, `inReplyTo`, the `object` of an activity such
    as `Follow`, the `href` of a `Mention`, and an `ap:` key ID in an HTTP
    Signature (see the [*Portable actors and WebFinger*
    section](./actor.md#portable-actors-and-webfinger)).  Do not put them on an
    object's own `id`, nor on the `inbox`, `outbox`, and collections in a
    portable actor's own document, where its `gateways` already tells where to
    retrieve them.  Hints do not change what a portable ID identifies, but
    software that does not canonicalize portable IDs would see a hinted ID as
    another object.
 -  Add hints while constructing an object, before signing it.  Its Object
    Integrity Proof covers its references too, so adding hints to a signed
    object invalidates the proof.
 -  Fedify follows at most five hints of a reference, and at most three of
    a key ID, so list the preferred gateways first.  `withGatewayHints()`
    itself does not limit the number of hints.
 -  Fedify does not add hints by itself; the application decides which
    references get which gateways.
 -  Pass a raw string, not a `URL`, if the ID's path may have `.` or `..`
    segments.  The `URL` class would resolve them and change the ID, so
    `withGatewayHints()` throws a `TypeError` for such paths instead.

### Dereferencing portable references

A portable object is not served from its ID, but from *gateways*: servers
that expose it under their */.well-known/apgateway/* path.  Property accessors
such as `Create.getObject()` fetch a portable reference through gateways when
you tell them how to verify what the gateways return:

~~~~ typescript twoslash
import type { Create } from "@fedify/vocab";
declare const create: Create;
// ---cut-before---
import { verifyPortableObject } from "@fedify/fedify";

const note = await create.getObject({
  gateways: ["https://server1.example", "https://server2.example"],
  verifyPortableObject,
});
~~~~

The accessor asks each gateway in order for the compatible identifier of the
referenced object, with an `Accept` header that asks for the ActivityStreams
JSON-LD profile, and returns the first object that passes two checks:

 -  Its `@id` must identify the same portable object as the reference.  IDs
    are compared in their canonical form, so the `ap:` and `ap+ef61:` schemes,
    percent-encoded DIDs, and query parameters do not matter.  A document
    without an `@id` is left to `verifyPortableObject`, and
    `verifyPortableObjectProof()` rejects it.
 -  The `verifyPortableObject` function must accept it.
    `verifyPortableObject()` from `@fedify/fedify` checks that the object has
    a valid [FEP-8b32] Object Integrity Proof made by the DID of its portable
    ID, and applies the gateway trust policy to collections without proofs
    (see [*Portable collections*](#portable-collections) below).
    `verifyPortableObjectProof()` checks proofs only, so it rejects every
    collection without a proof.

A gateway that responds with `404 Not Found`, any other error, or an object
that fails either check is skipped, and the next gateway is tried.  If one or
more gateways returned objects but none of them passed the checks, the
accessor logs a warning and returns `null`, or throws an error if
`crossOrigin: "throw"` is set.  If every gateway failed with an error, the
accessor throws it (or an `AggregateError` for multiple gateways), unless
`suppressError: true` is set.  Note that `crossOrigin: "trust"` does not skip
these checks.

The `gateways` option lists gateway origins such as `https://server.example`;
gateways with a path are not supported.  If you omit it, the accessor uses
the `@gateway` location hints in the reference, e.g.,
`ap://did:key:z6Mk.../actor?@gateway=https%3A%2F%2Fserver1.example`.  Since
hints come from the document that contains the reference, only the first five
are used.  An explicit `gateways` list replaces the hints, and an empty list
turns them off.  When there is no gateway to try, the accessor passes the
portable ID itself to the document loader, which lets a custom document loader
retrieve portable objects in its own way.  The two checks above apply in that
case as well.

Requests to gateways go through the document loader, so an authenticated
document loader signs them, which lets you fetch non-public portable objects
that gateways serve only to their audience:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
import type { Create } from "@fedify/vocab";
declare const ctx: Context<void>;
declare const create: Create;
// ---cut-before---
import { verifyPortableObject } from "@fedify/fedify";

const documentLoader = await ctx.getDocumentLoader({ identifier: "alice" });
const note = await create.getObject({
  documentLoader,
  gateways: ["https://server.example"],
  verifyPortableObject,
});
~~~~

Portable references cannot be dereferenced without `verifyPortableObject`:
the accessor throws a `TypeError` (or returns `null` with
`suppressError: true`) before sending any request.  The options apply to that
call only, except for `verifyPortableObject`, which the returned object uses by
default if the accessor fetched it (see
[*Default verifiers*](#default-verifiers) below).  So pass the other options
again when you dereference references in the returned object.  As with other
dereferenced objects, a verified object is cached in its parent object, and
later calls return it without fetching it again.  A portable object embedded in
a portable object with the same DID is trusted as embedded, since the parent's
proof covers it; other embedded portable objects are handled as described below.

#### Default verifiers

A `Context` has a `~Context.verifyPortableObject` property, which is
`verifyPortableObject()` with the context's document loader and context
loader.  Since it has the same name as the option, passing a `Context` as the
options of an accessor applies the policy:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
import type { Create } from "@fedify/vocab";
declare const ctx: Context<void>;
declare const create: Create;
// ---cut-before---
const note = await create.getObject(ctx);
~~~~

An object that an accessor fetches uses the verifier of that call by default.
So if `create` refers to its object by its ID, you do not need to pass the
verifier again for the next hop:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
import type { Create } from "@fedify/vocab";
declare const ctx: Context<void>;
declare const create: Create;
// ---cut-before---
const note = await create.getObject(ctx);
// Uses ctx.verifyPortableObject by default:
const author = await note?.getAttribution();
~~~~

An object can also remember a verifier to use by default.  Pass
`verifyPortableObject` to its constructor or to its `fromJsonLd()` method
(a `Context` works as the options here too), and its accessors use it when
you do not give them one.  A child object gets its default when it is parsed:

 -  An object that an accessor fetches gets the verifier given to that call,
    or the parent's default if the call gives none.
 -  An object embedded in the JSON-LD document that its parent was parsed from
    gets the parent's default, whichever verifier an accessor call gives.
 -  Objects that you pass to a constructor or to `clone()` as property values
    keep their own defaults, if any.
 -  A fetched object is cached in its parent, and later calls return it as
    is, with the default it got when it was fetched, even if they give
    another verifier.

A default verifier is only a policy for dereferencing references later; having
one does not mean that the object itself was verified.

If a verifier is meant for a single call only, e.g., one that accepts
everything, pass `inheritPortableObjectVerifier: false` along with it.
Objects that the call fetches then get the parent's own default, if any,
instead.  The option applies to that call only; it is not passed on.

Objects that Fedify parses for you already
have `~Context.verifyPortableObject` as their default: activities that inboxes
receive, including queued ones, objects that `~Context.lookupObject()` returns,
and the activities passed to the `onOutboxError` callback. So
`create.getObject()` in an inbox listener verifies portable objects even
without options.  A clone does not inherit the default; pass
`verifyPortableObject` to `clone()` if you need it.

#### Compatible identifiers

A reference can also be a compatible identifier (see above), e.g.,
`https://server1.example/.well-known/apgateway/did:key:z6Mk.../objects/1`, which
software without portable IRI support uses in place of a portable ID.  Its
host does not vouch for the object, since anyone can serve a compatible
identifier for any DID.  Therefore, when you pass `verifyPortableObject`, an
accessor dereferences a compatible identifier as the portable object it stands
for: it asks the gateway that the identifier names first, and then the
gateways in the `gateways` option, if any, and applies the checks above to the
object.  Even `gateways: []` does not keep it from asking the gateway that the
identifier names.  A malformed compatible identifier, such as one with
a `@gateway` location hint, is rejected without a request, like an object that
fails the checks.

In the same way, the portable object policy applies wherever a document turns
out to stand for a portable object:

 -  If a document fetched from an ordinary HTTP(S) URL is served from
    a compatible identifier after redirects, or has a portable `@id`, it is
    checked as the portable object it claims to be, instead of being trusted
    because of its origin.  Its final URL decides which object it has to be,
    so a document whose `@id` claims another object is rejected.
 -  An embedded object whose `@id` is a compatible identifier, or a portable
    ID with a DID other than the parent's, is not trusted as embedded, even
    with `crossOrigin: "trust"`.  The accessor dereferences and verifies it by
    its `@id` instead.

These rules also apply without `verifyPortableObject` to references from
portable objects, i.e., objects whose IDs are portable IDs or compatible
identifiers, and objects that were obtained from portable objects.  An object
whose ID is a malformed compatible identifier counts as a portable object too,
so that its references are not trusted by their origin.  Such an accessor
throws a `TypeError` (or returns `null` with `suppressError: true`) for
a portable reference or a compatible identifier, just as for a portable ID,
while it still fetches ordinary HTTP(S) references, verifying them only if
they turn out to be portable objects.  Otherwise, without
`verifyPortableObject`, compatible identifiers are fetched as ordinary HTTP(S)
URLs as before, so the result is not verified as a portable object.  Such
a result is not cached in the parent object, so a later call with
`verifyPortableObject` still verifies it.

> [!NOTE]
>
> Having a portable ID or a compatible identifier does not make an object
> verified; it only changes how its accessors dereference its references.
> An object parsed from arbitrary JSON-LD, e.g., with `fromJsonLd()`, is not
> verified just because of its ID.  Accessors verify only what they
> dereference, not objects that are already embedded or cached in the parent
> object, and giving them a stricter verifier later does not verify those
> objects again.  Likewise, `verifyPortableObject()` may accept an unsigned
> collection because a gateway that its owner lists serves it, which
> authenticates nothing in the collection.

[FEP-8b32]: https://w3id.org/fep/8b32

### Portable collections

[FEP-ef61] lets gateways serve portable collections, such as an actor's
outbox, without Object Integrity Proofs.  Such an *unsecured* collection is
trusted only if it comes from a gateway that its owner lists in the
`gateways` property of its actor document.  `verifyPortableObject()` applies
this policy when accessors fetch a portable collection or collection page
without a proof, and accepts it only if all of the following hold:

 -  The response's final URL is the compatible identifier of the same
    collection under a gateway's */.well-known/apgateway/* path.  The
    gateway is taken from this URL, not from the request or the collection's
    `@id`, so a redirect to anywhere else is not trusted.
 -  The owner is determined unambiguously.  It is the actor whose `inbox`,
    `outbox`, `followers`, `following`, or `liked` property you dereferenced,
    or else the single actor in the collection's `attributedTo`.  They must
    agree if both are present, and the owner must have the same DID as the
    collection.
 -  The owner's actor document has a valid proof and lists the collection as
    its `inbox`, `outbox`, `followers`, `following`, or `liked`.  If you
    dereferenced the collection from an actor that was itself fetched and
    verified through gateways, that actor document is used; otherwise the
    owner is fetched through the same `gateways` option (or its location
    hints).
 -  The gateway that served the collection is one of the owner's `gateways`.

A collection with a proof is verified by its proof instead, and a collection
with an invalid proof is rejected rather than treated as unsecured.
A collection that fails the policy is handled like any other portable object
that fails verification: the accessor tries the next gateway, and returns
`null` if none of them serves an acceptable one.

~~~~ typescript twoslash
import type { Person } from "@fedify/vocab";
declare const person: Person;
// ---cut-before---
import { verifyPortableObject } from "@fedify/fedify";
import { traverseCollection } from "@fedify/vocab";

const options = {
  gateways: ["https://server1.example", "https://server2.example"],
  verifyPortableObject,
};
const outbox = await person.getOutbox(options);
if (outbox != null) {
  for await (const activity of traverseCollection(outbox, options)) {
    console.log(activity.id?.href);
  }
}
~~~~

Collection pages are checked the same way, each against the gateway that
served it.  A page inherits the owner of the collection that you reached it
from through `first`, `last`, `current`, `next`, or `prev`, so the owner is
not fetched again for every page, but a page that names another collection
in its `partOf`, another owner in its `attributedTo`, or has another DID is
rejected.  Pass the same options to `traverseCollection()` as to the
accessor, since it fetches pages and items through accessors.

Accepting an unsecured collection only means that its owner trusts the
gateway; nothing in it is cryptographically verified.  Therefore, accessors
do not trust objects embedded in it, even with the same DID and even with
`crossOrigin: "trust"`: they fetch and verify each embedded object that has
an `@id` on its own, and drop embedded objects without an `@id`.

> [!NOTE]
>
> This policy has some limitations for now:
>
>  -  Only an actor's `inbox`, `outbox`, `followers`, `following`, and
>     `liked` collections can be unsecured.  Other unsecured collections,
>     such as the `replies` of a portable object, are rejected.
>  -  The owner's `gateways` are taken from whichever validly signed actor
>     document is retrieved, which might be older than the latest one.

### Portable media

Links and media/document objects expose `digestMultibase` for the integrity
digest required when portable objects reference external resources.  Use
`computeDigestMultibase()` to compute the SHA-256 multihash and
`createHashlink()` to construct a metadata-free `hl:` URI:

~~~~ typescript twoslash
import { Image } from "@fedify/vocab";
import {
  computeDigestMultibase,
  createHashlink,
  verifyDigestMultibase,
  verifyHashlink,
} from "@fedify/vocab-runtime";

const bytes = new TextEncoder().encode("image data");
const digestMultibase = await computeDigestMultibase(bytes);
const hashlink = createHashlink(digestMultibase);

const image = new Image({
  url: new URL(hashlink),
  mediaType: "image/png",
  digestMultibase,
});

await verifyDigestMultibase(bytes, digestMultibase);  // true
await verifyHashlink(bytes, hashlink);  // true
~~~~

The vocabulary layer stores and serializes the `digestMultibase` value exactly
as provided.  The verification helpers return `false` when the bytes do not
match.  `parseDigestMultibase()` and `parseHashlink()` validate values when the
decoded digest or hashlink components are needed.  These helpers accept only
SHA-256 digests and simple `hl:` URIs without metadata; malformed values,
unsupported hash algorithms, metadata-bearing hashlinks, and legacy `?hl=`
URLs cause a `TypeError`.

Use `fetchPortableMedia()` to retrieve a portable object's external media and
receive it only after its digest has been verified.  Supply the owner's
gateways in their advertised order for a hashlink:

~~~~ typescript twoslash
import { Image } from "@fedify/vocab";
import { fetchPortableMedia } from "@fedify/vocab-runtime";

declare const image: Image;
declare const ownerGateways: URL[];
// ---cut-before---
const response = await fetchPortableMedia(image, {
  gateways: ownerGateways,
});
const verifiedBytes = new Uint8Array(await response.arrayBuffer());
~~~~

For an HTTP(S) resource, `fetchPortableMedia(image)` uses its `url` and
`digestMultibase` directly.  A URL can also be passed with its expected digest
in the options.  The digest is required for both HTTP(S) URLs and hashlinks;
the hashlink's digest must agree with `digestMultibase`.  The function buffers
at most 16 MiB by default, rejects any resource above that limit, and never
returns bytes that fail verification.  Use `maxBytes` to choose another limit.
It tries each gateway in order after a failed response or digest mismatch.

The fetch uses the same private-address validation as document loaders by
default, including on redirects.  `allowPrivateAddress` overrides that policy
for trusted local deployments.  DNS resolution and the subsequent HTTP
connection are separate operations, so this check does not fully prevent DNS
rebinding.  Retrieval has a 10-second overall timeout and a 3-second timeout
per gateway by default; use `timeout` and `gatewayTimeout` to change them.
Only the verified response body and its server-provided `Content-Type` are
returned.  The content type is metadata, not covered by the digest.


Object IDs and remote objects
-----------------------------

Every object in the Activity Vocabulary has an `id` property, which is the URI
of the object.  It is used to identify and dereference the object.

For example, the following two objects are equivalent (where dereferencing URI
*https://example.com/notes/456* returns the `Note` object):

~~~~ typescript twoslash
import { Create, Note } from "@fedify/vocab";
// ---cut-before---
const a = new Create({
  id: new URL("https://example.com/activities/123"),
  actor: new URL("https://example.com/users/alice"),
  object: new Note({
    id: new URL("https://example.com/notes/456"),
    content: "Hello, world!",
    published: Temporal.Instant.from("2024-01-01T00:00:00Z"),
  }),
});
const b = new Create({
  actor: new URL("https://example.com/users/alice"),
  object: new URL("https://example.com/notes/456"),
});
~~~~

How are the two objects equivalent?  Because for the both objects,
`~Activity.getObject()` returns the equivalent `Note` object.  Such `get*()`
methods for non-scalar properties are called <dfn>dereferencing accessors</dfn>.
Under the hood, the `get*()` methods fetch the remote object from the URI
and return the object if no cache hit.  In the above example, the
`await a.getObject()` immediately returns the `Note` object because it's already
instantiated, while the `await b.getObject()` fetches the remote object from
the URI and returns the `Note` object.

If you only need the object ID without fetching the remote object, you can use
the `*Id`/`*Ids` accessors instead of dereferencing accessors.  In the same
manner, both `a.objectId` and `b.objectId` return the equivalent URI.

> [!TIP]
> Dereferencing accessors take option `documentLoader` to specify the method
> to fetch the remote object.  By default, it uses the default document loader
> which utilizes the [`fetch()`] API.
>
> If you want to implement your own document loader, see the `DocumentLoader`
> interface in the API reference.
>
> See the
> [*Getting a `DocumentLoader`* section](./context.md#getting-a-documentloader)
> for details.

[`fetch()`]: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API


Property hydration
------------------

The `get*()` accessor methods for non-scalar properties automatically populate
the property with the remote object when the methods are called even if
the property internally contains only the URI of the object.  This is called
<dfn>property hydration</dfn>.

For example, the following code hydrates the `object` property of the `Create`
object:

~~~~ typescript twoslash
import { Create } from "@fedify/vocab";
// ---cut-before---
const create = new Create({
  object: new URL(
    "https://hollo.social/@fedify/0191e4f3-6b08-7003-9d33-f07d1e33d7b4",
  ),
});

// Hydrates the `object` property:
const note = await create.getObject();

// Returns the hydrated `object` property; therefore, the following code does
// not make any HTTP request:
const note2 = await create.getObject();
~~~~

Hydrating the property also affects the JSON-LD representation of the object.

For example, since the following code does not hydrate the `object` property,
the JSON-LD representation of the `Create` object has the `object` property
with the URI of the object:

~~~~ typescript twoslash
import { Create } from "@fedify/vocab";
// ---cut-before---
const create = new Create({
  object: new URL(
    "https://hollo.social/@fedify/0191e4f3-6b08-7003-9d33-f07d1e33d7b4",
  ),
});

const jsonLd = await create.toJsonLd();
console.log(JSON.stringify(jsonLd));
~~~~

The above code outputs the following JSON-LD document (`"@context"` is
simplified for readability):

~~~~ json
{
  "@context": ["https://www.w3.org/ns/activitystreams"],
  "type": "Create",
  "object": "https://hollo.social/@fedify/0191e4f3-6b08-7003-9d33-f07d1e33d7b4"
}
~~~~

However, if the property is once hydrated, the JSON-LD representation of the
object has the `object` property with the full object:

~~~~ typescript twoslash
import { Create } from "@fedify/vocab";
const create = new Create({ });
// ---cut-before---
// Hydrates the `object` property:
await create.getObject();

const jsonLd = await create.toJsonLd();
console.log(JSON.stringify(jsonLd));
~~~~

The above code outputs the following JSON-LD document (`"@context"` and some
attributes are simplified or omitted for readability):

~~~~ json
{
  "type": "Create",
  "@context": ["https://www.w3.org/ns/activitystreams"],
  "object": {
    "id": "https://hollo.social/@fedify/0191e4f3-6b08-7003-9d33-f07d1e33d7b4",
    "type": "Note",
    "attributedTo": "https://hollo.social/@fedify",
    "content": "<p>...</p>\n",
    "published": "2024-09-12T06:37:23.593Z",
    "sensitive": false,
    "tag": [],
    "to": "as:Public",
    "url": "https://hollo.social/@fedify/0191e4f3-6b08-7003-9d33-f07d1e33d7b4"
  }
}
~~~~


Immutability
------------

Every object in the Activity Vocabulary is represented as an immutable object.
This means that you cannot change the properties of the object after the object
is instantiated.  This is for ensuring the consistency of the objects and the
safety of the objects in the concurrent environment.

In order to change the properties of the object, you need to clone the object
with the new properties.  Fortunately, the objects have a `clone()` method that
takes an object with the new properties and returns a new object with the new
properties.  The following shows an example of changing the `~Object.content`
property of a `Note` object:

~~~~ typescript{8-10} twoslash
import { Note } from "@fedify/vocab";
import { LanguageString } from "@fedify/vocab-runtime";

const noteInEnglish = new Note({
  id: new URL("https://example.com/notes/123"),
  content: new LanguageString("Hello, world!", "en"),
  published: Temporal.Now.instant(),
});
const noteInChinese = noteInEnglish.clone({
  content: new LanguageString("你好，世界！", "zh"),
});
~~~~

Parameters of the `clone()` method share the same type with parameters of
the constructor.


Looking up remote objects
-------------------------

See the [*Looking up remote objects*
section](./context.md#looking-up-remote-objects) in the *Context* docs.


Traversing remote collections
-----------------------------

See the [*Traversing remote collections*
section](./context.md#traversing-remote-collections) in the *Context* docs.


JSON-LD
-------

Under the hood, every object in the Activity Vocabulary is represented as a
[JSON-LD] document.  The JSON-LD document is a JSON object that contains the
properties of the object.  The following shows an example of the JSON-LD
representation of the `Create` object:

~~~~ json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "id": "https://example.com/activities/123",
  "actor": "https://example.com/users/alice",
  "object": {
    "type": "Note",
    "id": "https://example.com/notes/456",
    "content": "Hello, world!",
    "published": "2024-01-01T00:00:00Z"
  }
}
~~~~

If you want to instantiate an object from a JSON-LD document, you can use the
`fromJsonLd()` method of the object.  The following shows an example of
instantiating a `Create` object from the JSON-LD document:

~~~~ typescript twoslash
import { Create } from "@fedify/vocab";

const create = await Create.fromJsonLd({
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "id": "https://example.com/activities/123",
  "actor": "https://example.com/users/alice",
  "object": {
    "type": "Note",
    "id": "https://example.com/notes/456",
    "content": "Hello, world!",
    "published": "2024-01-01T00:00:00Z"
  }
});
~~~~

Note that the `fromJsonLd()` method can parse a subtype as well.  For example,
since `Create` is a subtype of `Activity`, the `Activity.fromJsonLd()` method
can parse a `Create` object as well:

~~~~ typescript twoslash
import { Activity } from "@fedify/vocab";

const create = await Activity.fromJsonLd({
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "id": "https://example.com/activities/123",
  "actor": "https://example.com/users/alice",
  "object": {
    "type": "Note",
    "id": "https://example.com/notes/456",
    "content": "Hello, world!",
    "published": "2024-01-01T00:00:00Z"
  }
});
~~~~

On the other way around, you can use the `toJsonLd()` method to get the JSON-LD
representation of the object:

~~~~ typescript twoslash
import { Create } from "@fedify/vocab";
const create = new Create({});
// ---cut-before---
const jsonLd = await create.toJsonLd();
~~~~

By default, the `toJsonLd()` method returns the JSON-LD document which is
neither compacted nor expanded.  Instead, it processes the JSON-LD document
without the proper JSON-LD processor for efficiency.

The `toJsonLd()` method takes some options to customize the JSON-LD document.
For example, you can compact the JSON-LD document with a custom context.
In this case, the `toJsonLd()` method returns the compacted JSON-LD document
which is processed by the proper JSON-LD processor:

~~~~ typescript twoslash
import { Create } from "@fedify/vocab";
const create = new Create({});
// ---cut-before---
const jsonLd = await create.toJsonLd({
  format: "compact",
  context: "https://example.com/context",
});
~~~~

> [!TIP]
> Why are the `fromJsonLd()` and `toJsonLd()` methods asynchronous?  Because
> both methods may fetch remote documents under the hood in order to
> [compact/expand a JSON-LD document].  In fact, like the dereferencing
> accessors, both `fromJsonLd()` and `toJsonLd()` methods take option
> `documentLoader` to specify the method to fetch the remote document.
>
> See the
> [*Getting a `DocumentLoader`* section](./context.md#getting-a-documentloader)
> for details.

[JSON-LD]: https://json-ld.org/
[compact/expand a JSON-LD document]: https://www.youtube.com/watch?v=Tm3fD89dqRE


Scalar types
------------

The Activity Vocabulary has a few scalar types that are used as the values of
the properties.  The following table shows the scalar types and their
corresponding TypeScript types:

| Scalar type              | TypeScript type                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `xsd:boolean`            | `boolean`                                                                                                     |
| `xsd:integer`            | `number`                                                                                                      |
| `xsd:nonNegativeInteger` | `number`                                                                                                      |
| `xsd:float`              | `number`                                                                                                      |
| `xsd:decimal`            | `Decimal`                                                                                                     |
| `xsd:string`             | `string`                                                                                                      |
| `xsd:anyURI`             | [`URL`]                                                                                                       |
| `xsd:dateTime`           | [`Temporal.Instant`]                                                                                          |
| `xsd:duration`           | [`Temporal.Duration`]                                                                                         |
| `rdf:langString`         | `LanguageString`                                                                                              |
| `w3id:cryptosuiteString` | `"eddsa-jcs-2022"`                                                                                            |
| `w3id:multibase`         | [`Uint8Array`]                                                                                                |
| Language tag ([BCP 47])  | [`Intl.Locale`]                                                                                               |
| Public key PEM           | [`CryptoKey`]                                                                                                 |
| Public key Multibase     | [`CryptoKey`]                                                                                                 |
| Proof purpose            | `"assertionMethod" \| "authentication" \| "capabilityInvocation" \| "capabilityDelegation" \| "keyAgreement"` |
| Units                    | `"cm" \| "feet" \| "inches" \| "km" \| "m" \| "miles" \| URL`                                                 |

`Decimal` values come from `@fedify/vocab-runtime` as a branded string type.
Use `isDecimal()` when you need to check whether a string is already in the
normalized `xsd:decimal` lexical form, and use `canParseDecimal()` or
`parseDecimal()` when you need XML Schema whitespace normalization before
validation:

~~~~ typescript twoslash
import type { Decimal } from "@fedify/vocab-runtime";
import {
  canParseDecimal,
  isDecimal,
  parseDecimal,
} from "@fedify/vocab-runtime";

const raw = " 12.50 ";

isDecimal(raw); // false
canParseDecimal(raw); // true

const price: Decimal = parseDecimal(raw);
price; // "12.50"
~~~~

`Decimal` keeps the original string at runtime instead of converting it to
JavaScript `number`, which avoids floating-point precision loss for exact
decimal values such as prices and measurements.  `parseDecimal()` normalizes
XML Schema whitespace before returning the branded value, so the runtime
representation always uses the normalized lexical form.

A property range must not combine `xsd:string` and `xsd:decimal`.  Both map to
runtime strings, so the generated encoder cannot distinguish them reliably
during JSON-LD serialization and Fedify rejects such schema definitions at code
generation time.

[`Temporal.Instant`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Instant
[`Temporal.Duration`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Duration
[`Uint8Array`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array
[BCP 47]: https://www.rfc-editor.org/info/bcp47
[`Intl.Locale`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale
[`CryptoKey`]: https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey


Origin-based security model
---------------------------

*This section is applicable since Fedify 1.9.0.*

Fedify implements an origin-based security model following [FEP-fe34] to protect
against content spoofing attacks and maintain secure federation practices.
This security model ensures that objects and their properties respect origin
boundaries, preventing malicious actors from impersonating content from other
servers.

For ordinary HTTP(S) object IDs, the origin is the web origin: scheme, host,
and port.  For FEP-ef61 portable IDs, Fedify uses the cryptographic origin
defined by the portable identifier.

[FEP-fe34]: https://w3id.org/fep/fe34

### Same-origin policy for properties

When accessing properties of ActivityPub objects, Fedify enforces same-origin
policy rules.  Even if an object appears to be embedded in the JSON-LD
representation, property accessors will automatically perform hydration (remote
fetching) if the embedded object's `@id` has a different origin than its parent
object.

For example, consider this JSON-LD representation:

~~~~ json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "id": "https://example.com/activities/123",
  "actor": "https://example.com/users/alice",
  "object": {
    "type": "Note",
    "id": "https://different-origin.com/notes/456",
    "content": "This is from a different origin"
  }
}
~~~~

In this case, when you access the `object` property of the `Create` activity,
Fedify will not trust the embedded `Note` object because its `@id` has a
different origin (`different-origin.com`) than the parent activity's origin
(`example.com`).  Instead, it will fetch the `Note` object directly from
`https://different-origin.com/notes/456` to verify its authenticity.

The same rule applies to cryptographic origins.  For example,
`ap+ef61://did:key:zAlice/actor` and `did:key:zAlice#zAlice` share the
`did:key:zAlice` origin, but `ap+ef61://did:key:zBob/actor` is a different
origin.

### Metadata identifiers

*This exception is applicable since Fedify 2.4.0.*

An embedded metadata value's ID does not always establish trust in its
properties.  Types whose vocabulary schema sets `trustEmbeddedObjects: false`,
such as `Translation`, can carry an ID without identifying an independently
fetched resource.  Using that ID for same-origin trust would let a publisher
choose an ID that makes a forged embedded actor appear trustworthy.

For these types, accessors for their own entity-valued properties fetch
untrusted embedded objects with IDs even when those IDs share the metadata
value's origin.  This does not
cause the metadata value itself to be fetched.  Values supplied locally or
already trusted through fetching remain trusted, and `crossOrigin: "trust"`
explicitly bypasses the check.  Objects without IDs cannot be fetched, so their
embedded data is not independently verified by these checks.

`trustEmbeddedObjects` is a vocabulary schema setting, not a runtime accessor
option.  See the
[translation credit example](./pragmatics.md#reading-credit-safely) for how to
handle unresolved or unverified actors.

### Controlling origin checks

You can control this behavior using the `crossOrigin` option when calling
property accessors:

~~~~ typescript twoslash
import { Create } from "@fedify/vocab";
const create = {} as unknown as Create;
// ---cut-before---
// Default behavior: ignore untrusted embedded objects (recommended)
const objectDefault = await create.getObject();

// Throw an error when encountering cross-origin objects
const objectStrict = await create.getObject({ crossOrigin: "throw" });

// Bypass origin checks (not recommended, potential security risk)
const objectBypass = await create.getObject({ crossOrigin: "trust" });
~~~~

The `crossOrigin` option accepts the following values:

`"ignore"` (default)
:   Ignore untrusted embedded objects and fetch from origin

`"throw"`
:   Throw an error when encountering cross-origin embedded objects

`"trust"`
:   Trust embedded objects regardless of origin (⚠️ security risk)

> [!WARNING]
> Using `crossOrigin: "trust"` can expose your application to security
> vulnerabilities, including content spoofing attacks.  Only use this option
> if you fully understand the security implications and have implemented
> additional validation measures.

### Trust tracking

Internally, Fedify maintains trust information for each property value.  Objects
that are constructed locally, fetched directly from their authoritative source,
or explicitly validated are marked as trusted.  This trust information is used
to determine whether property accessors need to perform additional validation
or fetching.


Extending the vocabulary
------------------------

While Fedify's vocabulary API offers many advantages, it has a limitation due to
its implementation through code generation: it is difficult to extend with
custom types or custom properties that are not included in the Activity
Vocabulary and major vendor extensions provided by Fedify.  This means that
adding custom types or properties at runtime is challenging, and if you want to
add new types or properties, you need to contribute to the Fedify upstream
repository.

Fortunately, Fedify's vocabulary API is very open to external contributions,
and technically, adding new types or properties to the vocabulary API is not
difficult.

The Fedify project accepts contributions to the vocabulary API almost
unconditionally if any of the following conditions are met:

 -  The type or property is specified in some form as a [FEP] (Fediverse
    Enhancement Proposal) or equivalent specification document
 -  The type or property is already adopted and used by widely-used
    implementations in the fediverse such as Mastodon, Pleroma, etc.
 -  The type or property has been sufficiently discussed in the Fedify
    community ([Matrix], [GitHub Discussions], etc.)

If you want to contribute to Fedify's vocabulary API, the process is
straightforward.  The _\*.yaml_ files located in the *packages/vocab/src/*
directory of the Fedify repository serve as the source data for code generation.
To add a new type, you simply need to add a new *.yaml* file, and to add a new
property, you need to define the new property in the `properties` section of an
existing *.yaml* file.

For detailed information on how to contribute to the vocabulary API, please
refer to the [*Contributing guide*](../contribute.md) and the existing YAML
files in the *packages/vocab/src/* directory for examples.

[FEP]: https://w3id.org/fep/
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[GitHub Discussions]: https://github.com/fedify-dev/fedify/discussions
