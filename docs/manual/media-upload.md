---
description: >-
  Fedify can accept client-to-server media uploads through a dedicated endpoint
  advertised as endpoints.uploadMedia.  This section explains how to register a
  media uploader and how the framework turns its result into an HTTP response.
---

Media upload
============

Fedify can route `multipart/form-data` `POST` requests to a dedicated media
upload endpoint, implementing the [ActivityPub Media Upload extension].  This
lets your own clients upload binary media (images, videos, and so on) as part
of ActivityPub's client-to-server protocol, without exposing a separate
non-standard API.

Unlike outbox posting, media upload does not go through `POST /outbox`.
Instead, the actor advertises a separate endpoint under `endpoints.uploadMedia`,
and the client sends a request with two parts:

 -  `file`: the binary media payload.
 -  `object`: an ActivityStreams object shell (without an `id` or `url`) that
    the server finalizes.

[ActivityPub Media Upload extension]: https://www.w3.org/wiki/SocialCG/ActivityPub/MediaUpload


Registering a media uploader
----------------------------

The `~Federatable.setMediaUploader()` method takes the endpoint path and a
callback that finalizes the uploaded media.  As with outbox listeners, the
returned setter exposes an `~MediaUploaderSetters.authorize()` hook that runs
before the callback and can reject unauthorized requests with
`401 Unauthorized`:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Image } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
async function verifyAccessToken(
  authorization: string | null,
): Promise<{ identifier: string } | null> {
  authorization;
  return null;
}
async function uploadToStorage(
  file: File,
): Promise<{ uuid: string; publicUrl: string }> {
  file;
  return { uuid: "", publicUrl: "" };
}
// ---cut-before---
federation
  .setMediaUploader(
    "/users/{identifier}/media",
    async (ctx, identifier, file, object) => {
      const stored = await uploadToStorage(file);
      return new Image({
        id: ctx.getObjectUri(Image, { uuid: stored.uuid }),
        url: new URL(stored.publicUrl),
        mediaType: file.type,
        name: object.name,
      });
    },
  )
  .authorize(async (ctx, identifier) => {
    const session = await verifyAccessToken(
      ctx.request.headers.get("authorization"),
    );
    return session?.identifier === identifier;
  });
~~~~

The callback receives the request context, the matched `{identifier}`, the
uploaded `file` (a Web-standard [`File`]), and the parsed `object` shell.  Since
the client may send any subtype of `Object` and the shell lacks an `id`, the
callback receives the base `Object` class; narrow it with `instanceof` when you
need a specific subtype.

> [!NOTE]
> Fedify reads the whole `multipart/form-data` body into memory before invoking
> your callback, and it does not impose an upload size limit of its own (the
> same as the inbox and outbox).  Enforce a maximum upload size at your
> deployment layer (e.g. a reverse proxy's `client_max_body_size`) so that
> oversized uploads are rejected before they reach the endpoint.

[`File`]: https://developer.mozilla.org/en-US/docs/Web/API/File


Return value: `201 Created` versus `202 Accepted`
-------------------------------------------------

The callback's return value determines the HTTP response.  This encodes the
distinction between a resource that is ready to fetch and one that is still
being processed; it is independent of whether your callback returns
synchronously or as a `Promise` (in practice it will be asynchronous, since it
usually stores the file):

 -  Returning an `Object` (the resource is fetchable right away) makes Fedify
    respond with `201 Created`, a `Location` header pointing at the object's
    `id`, and the serialized object as the body.  The object must have an `id`
    (set it with `~Context.getObjectUri()`); a `201 Created` response cannot
    omit the `Location` header, so an object without an `id` results in
    `500 Internal Server Error`.
 -  Returning a `URL` (the resource will exist at that URL once processing
    finishes, e.g. after transcoding) makes Fedify respond with
    `202 Accepted`, a `Location` header pointing at the returned URL, and an
    empty body.

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Video } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
async function enqueueTranscoding(file: File): Promise<{ uuid: string }> {
  file;
  return { uuid: "" };
}
// ---cut-before---
federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    const { uuid } = await enqueueTranscoding(file);
    // The result is not ready yet, so return the eventual URL (202 Accepted):
    return ctx.getObjectUri(Video, { uuid });
  },
);
~~~~

In both cases the returned `id`/`URL` should be produced by
`~Context.getObjectUri()` and point at an object dispatcher route you have
registered with `~Federatable.setObjectDispatcher()`.  Fedify does not serve the
uploaded object back for you; serving that URI as a fetchable ActivityStreams
object is the application's responsibility.  If the returned value does not
match a registered object dispatcher route, Fedify logs a runtime warning (the
upload still succeeds), and the `@fedify/lint` package provides a matching lint
rule; see [*Linting*][linting-guide] for details.

[linting-guide]: ./lint.md


Advertising the endpoint
------------------------

Registering a media uploader does not by itself expose the endpoint to clients.
Advertise it in your actor's `endpoints.uploadMedia` property using
`~Context.getMediaUploaderUri()`, the same way you expose the shared inbox with
`~Context.getInboxUri()`:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Endpoints, Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    endpoints: new Endpoints({
      uploadMedia: ctx.getMediaUploaderUri(identifier),
    }),
  });
});
~~~~

If a media uploader is registered but the actor does not advertise the matching
`endpoints.uploadMedia` URI, Fedify logs a runtime warning, and `@fedify/lint`
flags the same mistake statically.


Error responses
---------------

Fedify handles malformed requests before your callback runs:

 -  A request that is not `multipart/form-data` receives
    `415 Unsupported Media Type`.
 -  A request rejected by `~MediaUploaderSetters.authorize()` receives
    `401 Unauthorized` (overridable via the `onUnauthorized` option of
    `createFederation()`, the same as outbox listeners).
 -  A request whose `{identifier}` has no actor (the actor dispatcher returns
    `null` or a `Tombstone`) receives `404 Not Found`, and the callback is not
    invoked.  Like the outbox, the media uploader treats the actor dispatcher as
    the source of valid actors, so uploads for nonexistent or deleted actors are
    never stored.
 -  A request missing the `file` part receives `400 Bad Request`.
 -  A request whose `object` part is missing or unparseable receives
    `400 Bad Request`.
 -  A non-`POST` request to the endpoint receives `405 Method Not Allowed`.


Current scope
-------------

The media uploader provides the routing, authorization, and response surface for
client-to-server media upload, but the rest of the server-side behavior remains
application-defined.

In particular, Fedify does not currently do the following for you:

 -  Store the uploaded file or generate the object's `id`
 -  Serve the uploaded object back as a fetchable ActivityStreams object (use
    `~Federatable.setObjectDispatcher()` for that)
 -  Wrap the uploaded object in a `Create` activity or publish it to the outbox
 -  Accept more than one `file` per request (the extension defines a single
    file field, so clients that need batch uploads issue multiple requests)
