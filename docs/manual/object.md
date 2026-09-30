---
description: >-
  You can register an object dispatcher so that Fedify can dispatch an
  appropriate object by its class and URL arguments.  This section explains
  how to register an object dispatcher.
---

Object dispatcher
=================

*This API is available since Fedify 0.7.0.*

In ActivityPub, [objects] are entities that can be attached to activities or
other objects.  Objects sometimes need to be resolved by their dereferenceable
URIs.  To let objects be resolved, you can register object dispatchers so that
Fedify can dispatch an appropriate object by its class and URL arguments.

An object dispatcher is a callback function that takes a `Context` object and
URL arguments, and returns an object.  Every object dispatcher has one or more
URL parameters that are used to dispatch the object.  The URL parameters are
specified in the path pattern of the object dispatcher, e.g., `/notes/{id}`,
`/users/{userId}/articles/{articleId}`.

The below example shows how to register an object dispatcher:

~~~~ typescript{7-19} twoslash
// @noErrors: 2345
const note: { id: string; content: string } = { id: "", content: "" };
// ---cut-before---
import { createFederation } from "@fedify/fedify";
import { Note } from "@fedify/vocab";

const federation = createFederation({
  // Omitted for brevity; see the related section for details.
});

federation.setObjectDispatcher(
  Note,
  "/users/{userId}/notes/{noteId}",
  async (ctx, { userId, noteId }) => {
    // Work with the database to find the note by the author ID and the note ID.
    if (note == null) return null;  // Return null if the note is not found.
    return new Note({
      id: ctx.getObjectUri(Note, { userId, noteId }),
      content: note.content,
      // Many more properties...
    });
  }
);
~~~~

In the above example, the `~Federatable.setObjectDispatcher()` method registers
an object dispatcher for the `Note` class and
the `/users/{userId}/notes/{noteId}` path.  This pattern syntax follows
the [URI Template] specification.

> [!NOTE]
> The URI Template syntax supports different expansion types like `{userId}`
> (simple expansion) and `{+userId}` (reserved expansion).  If your
> identifiers contain URIs or special characters, you may need to use
> `{+userId}` to avoid double-encoding issues.  See the
> [*URI Template* guide](./uri-template.md) for details.

[objects]: https://www.w3.org/TR/activitystreams-core/#object
[URI Template]: https://datatracker.ietf.org/doc/html/rfc6570


Constructing object URIs
------------------------

To construct an object URI, you can use the `Context.getObjectUri()` method.
This method takes a class and URL arguments, and returns a dereferenceable URI
of the object.

The below example shows how to construct an object URI:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { Note } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
// ---cut-before---
ctx.getObjectUri(Note, {
  userId: "2bd304f9-36b3-44f0-bf0b-29124aafcbb4",
  noteId: "9f60274d-f6c2-4e3f-8eae-447f4416c0fb",
})
~~~~

> [!NOTE]
>
> The `Context.getObjectUri()` method does not guarantee that the object
> actually exists.  It only constructs a URI based on the given class and URL
> arguments, which may respond with `404 Not Found`.  Make sure to check
> if the arguments are valid before calling the method.


Deleted objects
---------------

*This API is available since Fedify 2.4.0.*

When an object has been deleted, e.g., a post that its author deleted, its URI
should not look as if it never existed.  [ActivityPub] recommends responding
with `410 Gone` and a `Tombstone` in place of the deleted object.  To do so,
return a `Tombstone` from the object dispatcher:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Note, Tombstone } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
interface Post {
  content: string;
  deletedAt: Temporal.Instant | null;
}
async function getPost(
  _userId: string,
  _noteId: string,
): Promise<Post | null> {
  return null;
}
// ---cut-before---
federation.setObjectDispatcher(
  Note,
  "/users/{userId}/notes/{noteId}",
  async (ctx, values) => {
    const post = await getPost(values.userId, values.noteId);
    if (post == null) return null;
    if (post.deletedAt != null) {
      return new Tombstone({
        id: ctx.getObjectUri(Note, values),
        formerType: Note,
        deleted: post.deletedAt,
      });
    }
    return new Note({
      id: ctx.getObjectUri(Note, values),
      content: post.content,
    });
  },
);
~~~~

When an object dispatcher returns a `Tombstone`, Fedify responds with
`410 Gone` and the serialized tombstone body.  The [authorization
predicate](./access-control.md), if any, is applied before that, as for other
objects.  The tombstone's `id` should be the URI of the deleted object; Fedify
logs a warning if it does not match `~Context.getObjectUri()`, but responds
with `410 Gone` anyway.

Use `null` only when the object is not found at all, so that the request
falls through to the next middleware or the `onNotFound` handler.

> [!NOTE]
> This also applies to object dispatchers registered for `Tombstone` or
> `Object` itself.  Before Fedify 2.4.0, the tombstones they returned were
> served with `200 OK`.
>
> A tombstone returned for a portable object request through the gateway
> endpoint needs an Object Integrity Proof to be served with `410 Gone` (see
> the [*Deleted portable objects* section](#deleted-portable-objects)).

[ActivityPub]: https://www.w3.org/TR/activitypub/#delete-activity-outbox


Serving portable objects
------------------------

*This API is available since Fedify 2.4.0.*

[FEP-ef61] portable objects have IDs that are not tied to a server, such as
`ap+ef61://did:key:z6Mk.../users/alice/notes/123`, whose authority is
a [DID].  They are retrieved through the `/.well-known/apgateway` endpoint of
a gateway, a server that stores them:

~~~~ http
GET /.well-known/apgateway/did:key:z6Mk.../users/alice/notes/123 HTTP/1.1
Host: example.com
Accept: application/ld+json; profile="https://www.w3.org/ns/activitystreams"
~~~~

Fedify serves such a request with the object dispatcher whose path matches
the path after the DID, e.g., `/users/{userId}/notes/{noteId}`, so you do not
need a separate dispatcher for portable objects.  The
`~RequestContext.portableRequest` property of the context tells whether the
dispatcher is serving a portable object, and the
`~Context.getPortableObjectUri()` method builds the portable ID from the same
path:

~~~~ typescript twoslash
import { signObject } from "@fedify/fedify";
import { type Federation } from "@fedify/fedify";
import { Note, PUBLIC_COLLECTION } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
interface Note_ { content: string }
async function findPortableNote(
  _did: string,
  _userId: string,
  _noteId: string,
): Promise<Note_ | null> {
  return null;
}
async function getPortableKey(
  _did: string,
): Promise<{ privateKey: CryptoKey; keyId: URL }> {
  return null!;
}
// ---cut-before---
federation.setObjectDispatcher(
  Note,
  "/users/{userId}/notes/{noteId}",
  async (ctx, values) => {
    if (ctx.portableRequest == null) {
      // An ordinary request, e.g., GET /users/alice/notes/123:
      return null;  // Omitted for brevity.
    }
    // The DID comes from the request path, so make sure that this server
    // stores the note for the DID:
    const { authority } = ctx.portableRequest;
    const note = await findPortableNote(authority, values.userId, values.noteId);
    if (note == null) return null;
    const { privateKey, keyId } = await getPortableKey(authority);
    return await signObject(
      new Note({
        // ap+ef61://did:key:z6Mk.../users/alice/notes/123
        id: ctx.getPortableObjectUri(Note, values),
        to: PUBLIC_COLLECTION,
        content: note.content,
      }),
      privateKey,
      keyId,  // e.g., did:key:z6Mk...#z6Mk...
    );
  },
);
~~~~

Fedify serves the returned object with `200 OK` and the
`application/ld+json; profile="https://www.w3.org/ns/activitystreams"` media
type only if all of the following hold:

 -  Its ID canonically equals the requested portable ID, e.g., an `ap:` ID is
    equivalent to an `ap+ef61:` one.  A compatible identifier, such as
    `https://example.com/.well-known/apgateway/did:key:z6Mk.../users/alice/notes/123`,
    is equivalent to the portable ID it contains, whichever gateway it names,
    as FEP-ef61 treats objects on different gateways as instances of the same
    object.  Otherwise, including when the dispatcher returns an object with an
    ordinary HTTP(S) ID or `null`, Fedify responds with `404 Not Found`, as the
    object is not stored on this server.
 -  It satisfies the FEP-ef61 proof policy: a portable actor, activity, or
    object needs an [Object Integrity Proof](./send.md#object-integrity-proofs)
    made with a key of the DID in its ID.  A portable collection may be served
    without proofs.  Otherwise, Fedify logs an error and responds with
    `500 Internal Server Error`, as serving the object would be a bug of
    the application.
 -  It is publicly addressed, unless the dispatcher has an authorization
    predicate or the object is an actor.  Otherwise, Fedify responds with
    `404 Not Found`, as if this server did not store the object.  See the
    [*Non-public portable objects* section](#non-public-portable-objects)
    below.

A malformed portable ID in the request path results in `400 Bad Request`.

The object is served as the dispatcher returns it, so an object whose ID is
a compatible identifier keeps naming the gateway in its ID even when it is
served by another gateway.  See the [*Compatible identifiers as actor IDs*
section](./actor.md#compatible-identifiers-as-actor-ids) for when to identify
portable objects by compatible identifiers.

> [!WARNING]
> The DID in `~RequestContext.portableRequest` comes from the request path,
> so anyone can make a request with any DID.  It is not evidence that this
> server stores objects for the DID; look up the object by the DID as well as
> the other values.  Proofs keep an object from being served under another
> DID, but an unsigned collection is served as the dispatcher returns it.

The `~Context.getPortableObjectUri()` method takes the DID as its third
argument.  It can be omitted only while handling a portable object request,
in which case the DID of the requested object is used (see the [*Portable IDs*
section](./context.md#portable-ids) for more about building portable IDs).  The
returned `URL` keeps the DID percent-encoded, e.g.,
`ap+ef61://did%3Akey%3Az6Mk.../users/alice/notes/123`, as the `URL` class
cannot represent the canonical form; `formatIri()` from `@fedify/vocab-runtime`
returns the canonical string, and generated vocabulary classes serialize it in
the canonical form.

[FEP-ef61]: https://w3id.org/fep/ef61
[DID]: https://www.w3.org/TR/did-core/

### Non-public portable objects

[FEP-ef61] forbids a gateway to serve a non-public object unless the request
is signed by an actor in the object's intended audience.  A gateway may store
objects that other servers or clients have created, so Fedify does not serve
such objects to anyone by default: without an [authorization
predicate](./access-control.md), an object dispatcher serves a portable object
through the gateway endpoint only if the object is publicly addressed, i.e.,
its `to`, `cc`, `bto`, `bcc`, or `audience` has the public collection
(`PUBLIC_COLLECTION`, or `as:Public` or `Public` in the JSON-LD document).
Fedify responds to a request for any other portable object with
`404 Not Found`, as if this server did not store it, whether the request is
signed or not, and it does so before verifying the object's proofs.

Actors are exempt, as they have no audience, whether they are served by
the actor dispatcher or an object dispatcher.  Collections and tombstones are
not: give them public addressing to serve them without a predicate.

To serve a non-public portable object to its audience, set an authorization
predicate on the object dispatcher.  The predicate then decides alone who may
retrieve the dispatcher's portable objects, both public and non-public ones,
and Fedify responds to a request that it denies with `401 Unauthorized`
through the `onUnauthorized` callback.  The
`~RequestContext.isSignedByAudience()` method checks whether the request is
signed by an actor in an object's audience.  It compares portable IDs
canonically, so an addressee identified by an `ap:` URI matches a signer
identified by a compatible identifier on any gateway, and it returns `true`
for a publicly addressed object even if the request is not signed.  Fedify
cannot tell who the members of a collection such as followers are, so provide
the `isMember` option to check them:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { type Actor, Note } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
async function findPortableNote(
  _did: string,
  _userId: string,
  _noteId: string,
): Promise<Note | null> {
  return null;
}
async function isFollower(
  _followers: URL,
  _actor: Actor,
): Promise<boolean> {
  return false;
}
// ---cut-before---
federation
  .setObjectDispatcher(
    Note,
    "/users/{userId}/notes/{noteId}",
    async (ctx, values) => {
      if (ctx.portableRequest == null) return null;  // Omitted for brevity.
      return await findPortableNote(
        ctx.portableRequest.authority,
        values.userId,
        values.noteId,
      );
    },
  )
  .authorize(async (ctx, values) => {
    if (ctx.portableRequest == null) return true;  // Omitted for brevity.
    const note = await findPortableNote(
      ctx.portableRequest.authority,
      values.userId,
      values.noteId,
    );
    return note != null && await ctx.isSignedByAudience(note, {
      // Called for each addressee other than the signer, e.g., a followers
      // collection:
      isMember: (addressee, actor) => isFollower(addressee, actor),
    });
  });
~~~~

A predicate that always returns `true` serves every portable object to anyone,
contrary to [FEP-ef61], so use one only if the dispatcher never serves
non-public objects.  Also keep the following in mind:

 -  Fedify responds to a request allowed by a predicate with
    `Cache-Control: private`, as another requester may be denied the same
    object, so that shared caches do not reuse the response.  A response from
    your `onUnauthorized` or `onNotFound` callback may depend on the requester
    as well, so mark it with `Cache-Control: no-store` if a shared cache sits
    in front of the gateway.
 -  A `401 Unauthorized` response tells the requester that the object exists.
    Respond with `404 Not Found` from `onUnauthorized` if you do not want to
    reveal that.
 -  Only the object's own addressing is checked, not that of the objects
    embedded in it, e.g., a public `Create` activity serves the `Note` it
    embeds whatever the note's audience is.  Do not embed non-public objects
    in public ones.
 -  An Object Integrity Proof covers `bto` and `bcc` as well, so they cannot
    be removed from a signed object before serving it, and every actor who
    may retrieve the object sees them.
 -  This applies only to requests through the gateway endpoint.  Ordinary
    requests to the same object dispatcher, and routes of your own, are
    served as before, so do not serve non-public portable objects through
    them without checking the requester.

### Deleted portable objects

A portable object that has been deleted can be represented by a `Tombstone`
as well, but the tombstone is itself a portable object: its ID is the portable
ID of the deleted object, and it needs an Object Integrity Proof made with
a key of the DID, as anyone could otherwise claim that the DID's objects have
been deleted.  So sign the tombstone as you would sign the object:

~~~~ typescript twoslash
import { signObject } from "@fedify/fedify";
import { type Federation } from "@fedify/fedify";
import { Note, PUBLIC_COLLECTION, Tombstone } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
interface Note_ { content: string; deletedAt: Temporal.Instant | null }
async function findPortableNote(
  _did: string,
  _userId: string,
  _noteId: string,
): Promise<Note_ | null> {
  return null;
}
async function getPortableKey(
  _did: string,
): Promise<{ privateKey: CryptoKey; keyId: URL }> {
  return null!;
}
// ---cut-before---
federation.setObjectDispatcher(
  Note,
  "/users/{userId}/notes/{noteId}",
  async (ctx, values) => {
    if (ctx.portableRequest == null) return null;  // Omitted for brevity.
    const { authority } = ctx.portableRequest;
    const note = await findPortableNote(authority, values.userId, values.noteId);
    if (note == null) return null;
    const { privateKey, keyId } = await getPortableKey(authority);
    if (note.deletedAt != null) {
      return await signObject(
        new Tombstone({
          id: ctx.getPortableObjectUri(Note, values),
          to: PUBLIC_COLLECTION,
          formerType: Note,
          deleted: note.deletedAt,
        }),
        privateKey,
        keyId,
      );
    }
    return await signObject(
      new Note({
        id: ctx.getPortableObjectUri(Note, values),
        to: PUBLIC_COLLECTION,
        content: note.content,
      }),
      privateKey,
      keyId,
    );
  },
);
~~~~

Fedify serves such a tombstone with `410 Gone` and the same media type as
other portable objects, under the same conditions: its ID canonically equals
the requested portable ID, the authorization predicate allows the request (or
the tombstone is publicly addressed if there is no predicate), and its proof
is made with a key of the DID.  So give the tombstone of a public object
public addressing as in the example above; that of a non-public object is
served only to its audience, like the object itself.  If the tombstone has no
proof, e.g., because the key of a deleted actor is no longer available, Fedify
responds with `404 Not Found` instead, as if this server did not store the
object.  A tombstone with an invalid proof, or one made by another DID, results
in `500 Internal Server Error` as for other portable objects.  So is a
tombstone without a proof that has properties of another kind of object, e.g.,
`totalItems`, as the exemptions for unsigned portable collections do not apply
to tombstones.

> [!NOTE]
> [FEP-ef61] does not define tombstones; it only says that a gateway responds
> with `200 OK` to a request for an object that it stores, and with
> `404 Not Found` otherwise.  Fedify responds with `410 Gone` for signed
> tombstones anyway, for consistency with [ActivityPub] and with tombstones of
> ordinary objects.

A tombstone only tells what this gateway knows about the object; other
gateways of the same actor may still serve the object until they learn about
its deletion.  So send a `Delete` activity signed by the DID as well, and
create the signed tombstone while the key is still available, if you are
going to discard the key.

Note that only object dispatchers and the actor dispatcher (see the
[*Portable actors and WebFinger*
section](./actor.md#portable-actors-and-webfinger)) serve portable objects for
now.  Collection dispatchers are not reachable through the gateway endpoint,
whereas deliveries to portable inboxes are handled by inbox listeners (see the
[*Portable inboxes* section](./inbox.md#portable-inboxes)).
Also, a route of your own that matches the `/.well-known/apgateway/...` path,
e.g., `/{+path}`, takes precedence over the gateway endpoint.


Serving hashlink media
----------------------

*This API is available since Fedify 2.4.0.*

A [FEP-ef61] portable object refers to an external resource, such as an image
attachment, by a [hashlink], an `hl:` URI that carries the SHA-256 digest of
the resource, along with the same digest in the `digestMultibase` property:

~~~~ json
{
  "type": "Image",
  "url": "hl:zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n",
  "mediaType": "image/png",
  "digestMultibase": "zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n"
}
~~~~

A gateway that stores the resource serves it at its `/.well-known/apgateway`
endpoint followed by the hashlink:

~~~~ http
GET /.well-known/apgateway/hl:zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n HTTP/1.1
Host: example.com
~~~~

To serve such requests, register a hashlink media dispatcher with
the `~Federatable.setHashlinkMediaDispatcher()` method.  Unlike other
dispatchers, it returns a `Response` rather than an object, so that it can
stream the resource and set the response headers:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
interface StoredMedia {
  readonly mediaType: string;
  readonly size: number;
  readonly public: boolean;
  open(): ReadableStream<Uint8Array>;
}
async function findMedia(_sha256Hex: string): Promise<StoredMedia | null> {
  return null;
}
// ---cut-before---
federation.setHashlinkMediaDispatcher(async (ctx, media) => {
  // Look the file up by the raw digest, which does not depend on
  // the multibase encoding of the requested hashlink:
  const sha256Hex = Array.from(
    media.digest,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const file = await findMedia(sha256Hex);
  if (file == null || !file.public) return null;
  return new Response(
    // Do not open the file for a HEAD request:
    ctx.request.method === "HEAD" ? null : file.open(),
    {
      headers: {
        // The media type that the application decided when it stored
        // the file, not the one that the uploader claimed:
        "Content-Type": file.mediaType,
        "Content-Length": file.size.toString(),
        "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": `"${sha256Hex}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    },
  );
});
~~~~

The second parameter of the dispatcher is a `HashlinkMediaRequest` object with
the following properties:

`hashlink`
:   The requested hashlink, e.g.,
    `hl:zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n`.

`digestMultibase`
:   The multibase-encoded multihash in the hashlink as requested, e.g.,
    `zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n`, which is also the value
    of the `digestMultibase` property.  The same digest can be encoded in other
    multibase encodings, so prefer `digest` as a storage key.

`algorithm`
:   The hash algorithm, which is always `"sha2-256"` for now.

`digest`
:   The raw 32-byte SHA-256 digest as a `Uint8Array`.

`multihash`
:   The multihash decoded from `digestMultibase` as a `Uint8Array`.

Fedify validates the hashlink before calling the dispatcher, so it responds
with `400 Bad Request` to a malformed hashlink, a hashlink with metadata, or
a digest that is not SHA-256.  If the dispatcher returns `null`, Fedify
responds with `404 Not Found`; otherwise, it sends the returned response as
is.  A `HEAD` request is also passed to the dispatcher, and Fedify removes
the body from its response.  Requests with other methods get
`405 Method Not Allowed`.

> [!IMPORTANT]
> Fedify does not verify the response body against the digest, as that would
> require reading the whole body before sending it.  The dispatcher must serve
> only a resource whose complete bytes hash to the requested digest, e.g., by
> storing resources under their digests, and must not transform them.
> Clients verify the digest of a retrieved resource, so a mismatching one
> fails for them anyway.

Conditional and range requests are left to the dispatcher as well.  It can
read headers such as `If-None-Match`, `Range`, and `If-Range` from
`~RequestContext.request` and respond with, e.g., `304 Not Modified` or
`206 Partial Content`.  Note that a client cannot verify a partial response
by itself, since the digest covers the whole resource.

> [!WARNING]
> Anyone who knows the digest of a resource can retrieve it through this
> endpoint; hashlink media have no access control.  Serve only resources that
> are meant to be public, and look them up by what this server has stored
> rather than fetching them from elsewhere on a miss.
>
> The resources are served from the origin of your application, so treat them
> as untrusted content: use the media type that your application decided,
> and send `X-Content-Type-Options: nosniff` and
> `Content-Security-Policy: sandbox`, or `Content-Disposition: attachment` for
> types that browsers run, such as HTML and SVG.

As with portable objects, a route of your own that matches
the `/.well-known/apgateway/hl:...` path takes precedence over the gateway
endpoint.  Also, this is not the [media upload](./media-upload.md) endpoint;
the hashlink media dispatcher only serves resources.

[hashlink]: https://datatracker.ietf.org/doc/html/draft-sporny-hashlink-07
