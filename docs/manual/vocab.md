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


Instantiation
-------------

You can instantiate an object by calling the constructor function with an object
that contains the properties of the object.  The following shows an example of
instantiating a `Create` object:

~~~~ typescript twoslash
import { Temporal } from "@js-temporal/polyfill";
// ---cut-before---
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
|------------|---------------------------------------|----------------------------------------------------------------------------------------|
| Scalar     | `Object.published`                    | `Object.name`/`~Object.names`                                                          |
| Non-scalar | `Person.inboxId`/`~Person.getInbox()` | `Activity.actorId`/`~Activity.actorIds`/`~Activity.getActor()`/`~Activity.getActors()` |

Some non-functional properties have both singular and plural accessors for
the sake of convenience.  In such cases, the singular accessors return the first
value of the property, while the plural accessors return all values of the
property.

> [!NOTE]
> Some of the properties in Activity Vocabulary have been renamed in Fedify:
>
> | Original name                | Accessor in Fedify                |
> |------------------------------|-----------------------------------|
> | [`alsoKnownAs`]              | `Application.getAliases()`/`Group.getAliases()`/`Organization.getAliases()`/`Person.getAliases()`/`Service.getAliases()` |
> | [`anyOf`]                    | `Question.getInclusiveOptions()`  |
> | [`attributedTo`]             | `Object.getAttributions()`        |
> | [`hreflang`]                 | `Link.language`                   |
> | [`inReplyTo`]                | `Object.getReplyTargets()`        |
> | [`isCat`]                    | `Application.cat`/`Group.cat`/`Organization.cat`/`Person.cat`/`Service.cat` |
> | [`movedTo`]                  | `Application.getSuccessor()`/`Group.getSuccessor()`/`Organization.getSuccessor()`/`Person.getSuccessor()`/`Service.getSuccessor()` |
> | [`oneOf`]                    | `Question.getExclusiveOptions()`  |
> | [`orderedItems`]             | `OrderedCollection.getItems()`    |
> | [`publicKeyMultibase`]       | `Multikey.publicKey`              |
> | [`publicKeyPem`]             | `CryptographicKey.publicKey`      |
> | [`quoteUri`]                 | `Article.quoteUrl`/`ChatMessage.quoteUrl`/`Note.quoteUrl`/`Question.quoteUrl` |
> | [`votersCount`]              | `Question.voters`                 |
> | [`_misskey_followedMessage`] | `Application.followedMessage`/`Group.followedMessage`/`Organization.followedMessage`/`Person.followedMessage`/`Service.followedMessage` |
> | [`_misskey_quote`]           | `Article.quoteUrl`/`ChatMessage.quoteUrl`/`Note.quoteUrl`/`Question.quoteUrl` |

[`alsoKnownAs`]: https://www.w3.org/TR/did-core/#dfn-alsoknownas
[`anyOf`]: https://www.w3.org/TR/activitystreams-vocabulary/#dfn-anyof
[`attributedTo`]: https://www.w3.org/TR/activitystreams-vocabulary/#dfn-attributedto
[`hreflang`]: https://www.w3.org/TR/activitystreams-vocabulary/#dfn-hreflang
[`inReplyTo`]: https://www.w3.org/TR/activitystreams-vocabulary/#dfn-inreplyto
[`isCat`]: https://misskey-hub.net/ns#iscat
[`movedTo`]: https://swicg.github.io/miscellany/#movedTo
[`oneOf`]: https://www.w3.org/TR/activitystreams-vocabulary/#dfn-oneof
[`orderedItems`]: https://www.w3.org/TR/activitystreams-vocabulary/#dfn-items
[`publicKeyMultibase`]: https://www.w3.org/TR/controller-document/#dfn-publickeymultibase
[`publicKeyPem`]: https://web.archive.org/web/20221218063101/https://web-payments.org/vocabs/security#publicKey
[`quoteUri`]: https://github.com/fedibird/mastodon?tab=readme-ov-file#quotes
[`votersCount`]: https://docs.joinmastodon.org/spec/activitypub/#poll-specific-properties
[`_misskey_followedMessage`]: https://misskey-hub.net/ns#_misskey_followedmessage
[`_misskey_quote`]: https://misskey-hub.net/ns#_misskey_quote


Object IDs and remote objects
-----------------------------

Every object in the Activity Vocabulary has an `id` property, which is the URI
of the object.  It is used to identify and dereference the object.

For example, the following two objects are equivalent (where dereferencing URI
*https://example.com/notes/456* returns the `Note` object):

~~~~ typescript twoslash
import { Create, Note } from "@fedify/vocab";
import { Temporal } from "@js-temporal/polyfill";
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
import { Temporal } from "@js-temporal/polyfill";
// ---cut-before---
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

| Scalar type              | TypeScript type                                   |
|--------------------------|---------------------------------------------------|
| `xsd:boolean`            | `boolean`                                         |
| `xsd:integer`            | `number`                                          |
| `xsd:nonNegativeInteger` | `number`                                          |
| `xsd:float`              | `number`                                          |
| `xsd:string`             | `string`                                          |
| `xsd:anyURI`             | [`URL`]                                           |
| `xsd:dateTime`           | [`Temporal.Instant`]                              |
| `xsd:duration`           | [`Temporal.Duration`]                             |
| `rdf:langString`         | `LanguageString`                                  |
| `w3id:cryptosuiteString` | `"eddsa-jcs-2022"`                                |
| `w3id:multibase`         | [`Uint8Array`]                                    |
| Language tag ([BCP 47])  | [`Intl.Locale`]                                   |
| Public key PEM           | [`CryptoKey`]                                     |
| Public key Multibase     | [`CryptoKey`]                                     |
| Proof purpose            | `"assertionMethod" \| "authentication" \| "capabilityInvocation" \| "capabilityDelegation" \| "keyAgreement"` |
| Units                    | `"cm" \| "feet" \| "inches" \| "km" \| "m" \| "miles" \| URL` |

[`URL`]: https://developer.mozilla.org/en-US/docs/Web/API/URL
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
    community ([Discord], [Matrix], [GitHub Discussions], etc.)

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
[Discord]: https://discord.gg/bhtwpzURwd
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[GitHub Discussions]: https://github.com/fedify-dev/fedify/discussions
