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
import { Note } from "@fedify/vocab";
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
type only if both of the following hold:

 -  Its ID canonically equals the requested portable ID, e.g., an `ap:` ID is
    equivalent to an `ap+ef61:` one.  Otherwise, including when the dispatcher
    returns an object with an HTTP(S) ID or `null`, Fedify responds with
    `404 Not Found`, as the object is not stored on this server.
 -  It satisfies the FEP-ef61 proof policy: a portable actor, activity, or
    object needs an [Object Integrity Proof](./send.md#object-integrity-proofs)
    made with a key of the DID in its ID.  A portable collection may be served
    without proofs.  Otherwise, Fedify logs an error and responds with
    `500 Internal Server Error`, as serving the object would be a bug of
    the application.

A malformed portable ID in the request path results in `400 Bad Request`.

> [!WARNING]
> The DID in `~RequestContext.portableRequest` comes from the request path,
> so anyone can make a request with any DID.  It is not evidence that this
> server stores objects for the DID; look up the object by the DID as well as
> the other values.  Proofs keep an object from being served under another
> DID, but an unsigned collection is served as the dispatcher returns it.

The `~Context.getPortableObjectUri()` method takes the DID as its third
argument.  It can be omitted only while handling a portable object request,
in which case the DID of the requested object is used.  The returned `URL`
keeps the DID percent-encoded, e.g.,
`ap+ef61://did%3Akey%3Az6Mk.../users/alice/notes/123`, as the `URL` class
cannot represent the canonical form; `formatIri()` from
`@fedify/vocab-runtime` returns the canonical string, and generated
vocabulary classes serialize it in the canonical form.

If the object dispatcher has an [authorization predicate](./access-control.md),
it is also applied to portable object requests.  [FEP-ef61] requires that
a non-public portable object be served only to a request signed by an actor
in its audience, so check the signature in the predicate, e.g., with
`~RequestContext.getSignedKeyOwner()`.  Without a predicate, the object is
served to anyone.

Note that only object dispatchers serve portable objects for now.  Actor
dispatchers, collection dispatchers, and inboxes are not reachable through
the gateway endpoint.  Also, a route of your own that matches
the `/.well-known/apgateway/...` path, e.g., `/{+path}`, takes precedence over
the gateway endpoint.

[FEP-ef61]: https://w3id.org/fep/ef61
[DID]: https://www.w3.org/TR/did-core/
