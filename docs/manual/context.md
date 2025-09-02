---
description: >-
  The Context object is a container that holds the information of the current
  request.  This section explains the key features of the Context object.
---

Context
=======

The `Context` object is a container that holds the information of the current
request.  It is passed to various callback functions that are registered to
the `Federation` object, and also can be gathered from the outside of the
callbacks.

The key features of the `Context` object are as follows:

 -  Carrying [`TContextData`](./federation.md#tcontextdata)
 -  [Building the object URIs](#building-the-object-uris)
    (e.g., actor URIs, shared inbox URI)
 -  [Dispatching Activity Vocabulary objects](#dispatching-objects)
 -  Getting the current HTTP request
 -  [Enqueuing an outgoing activity](#enqueuing-an-outgoing-activity)
 -  [Getting a `DocumentLoader`](#getting-a-documentloader)
 -  [Looking up remote objects](#looking-up-remote-objects)
 -  [NodeInfo client](./nodeinfo.md#nodeinfo-client)


Where to get a `Context` object
-------------------------------

You can get a `Context` object from the first parameter of most of the callbacks
that are registered to the `Federation` object.  The following shows a few
callbacks that take a `Context` object as the first parameter:

 -  [Actor dispatcher](./actor.md)
 -  [Inbox listeners](./inbox.md)
 -  [Outbox collection dispatcher](./collections.md#outbox)
 -  [Inbox collection dispatcher](./collections.md#inbox)
 -  [Following collection dispatcher](./collections.md#following)
 -  [Followers collection dispatcher](./collections.md#followers)
 -  [Liked collection dispatcher](./collections.md#liked)
 -  [Featured collection dispatcher](./collections.md#featured)
 -  [Featured tags collection dispatcher](./collections.md#featured-tags)
 -  [NodeInfo dispatcher](./nodeinfo.md)

Those are not all; there are more callbacks that take a `Context` object.

You can also get a `Context` object from the `Federation` object by calling the
`~Federation.createContext()` method.  The following shows an example:

~~~~ typescript twoslash
// @noErrors
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
// ---cut-before---
import { federation } from "../federation.ts"; // Import the `Federation` object

export async function handler(request: Request) {
  const ctx = federation.createContext(request, undefined);  // [!code highlight]
  // Work with the `ctx` object...
};
~~~~


Getting the base URL
--------------------

*This API is available since Fedify 0.12.0.*

The `Context` object has properties to get the base URL of the current request:

| Property                  | Description                                              | Value example              |
|---------------------------|----------------------------------------------------------|----------------------------|
| `Context.hostname`        | A hostname                                               | `"example.com"`            |
| `Context.host`            | A hostname followed by an optional port                  | `"example.com:88"`         |
| `Context.origin`          | A scheme followed by a host                              | `"https://example.com:88"` |
| `Context.canonicalOrigin` | An explicitly configured `~FederationOptions.origin`[^1] | `"https://example.com"`    |

For `RequestContext`, there is an additional property named `~RequestContext.url` that
contains the full URL of the current request.

[^1]: If no canonical origin is explicitly configured, it is the same as the
      `Context.origin`.
      See also the [*Explicitly setting the canonical origin*
      section](./federation.md#explicitly-setting-the-canonical-origin) in the
      *Federation* document.


Building the object URIs
------------------------

The `Context` object has a few methods to build the object URIs.  The following
shows the methods:

 -  `~Context.getNodeInfoUri()`
 -  `~Context.getActorUri()`
 -  `~Context.getObjectUri()`
 -  `~Context.getInboxUri()`
 -  `~Context.getOutboxUri()`
 -  `~Context.getFollowingUri()`
 -  `~Context.getFollowersUri()`
 -  `~Context.getLikedUri()`
 -  `~Context.getFeaturedUri()`
 -  `~Context.getFeaturedTagsUri()`

You could hard-code the URIs, but it is better to use those methods to build
the URIs because the URIs are subject to change in the future.

Here's an example of using the `~Context.getActorUri()` method in the actor
dispatcher:

~~~~ typescript twoslash
import { type Federation, Person } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
interface User { }
const user: User | null = true ? { } : null;
// ---cut-before---
federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
  // Work with the database to find the actor by the identifier.
  if (user == null) return null;
  return new Person({
    id: ctx.getActorUri(identifier),  // [!code highlight]
    preferredUsername: identifier,
    // Many more properties...
  });
});
~~~~

On the other way around, you can use the `~Context.parseUri()` method to
determine the type of the URI and extract the identifier or other values from
the URI.


Enqueuing an outgoing activity
------------------------------

The `Context` object can enqueue an outgoing activity to the actor's outbox
by calling the `~Context.sendActivity()` method.  The following shows an
example in an [inbox listener](./inbox.md):

~~~~ typescript{12-16} twoslash
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
// ---cut-before---
import { Accept, Follow } from "@fedify/fedify";

federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    // In order to send an activity, we need the identifier of the sender actor:
    if (follow.objectId == null) return;
    const parsed = ctx.parseUri(follow.objectId);
    if (parsed?.type !== "actor") return;
    const recipient = await follow.getActor(ctx);
    if (recipient == null) return;
    await ctx.sendActivity(
      { identifier: parsed.identifier }, // sender
      recipient,
      new Accept({ actor: follow.objectId, object: follow }),
    );
  });
~~~~

For more information about this topic, see the [*Sending activities*
section](./send.md).

> [!NOTE]
> The `~Context.sendActivity()` method works only if the [key pairs dispatcher]
> is registered to the `Federation` object.  If the key pairs dispatcher is not
> registered, the `~Context.sendActivity()` method throws an error.

> [!TIP]
> Why do you need to enqueue an outgoing activity, instead of directly sending
> the activity to the recipient's inbox?  The reason is that in distributed
> systems, we need to consider the delivery failure.  If the delivery fails,
> the system needs to retry the delivery.  Delivery failure can happen for
> various reasons, such as network failure, recipient server failure, and so on.
>
> Anyway, you don't have to worry about the delivery failure because the
> Fedify handles the delivery failure by enqueuing the outgoing
> activity to the actor's outbox and retrying the delivery on failure.

[key pairs dispatcher]: ./actor.md#public-keys-of-an-actor


Dispatching objects
-------------------

*This API is available since Fedify 0.7.0.*

The `RequestContext` object has a method to dispatch an Activity Vocabulary
object from the URL arguments.  The following shows an example of using
the `RequestContext.getActor()` method:

~~~~ typescript twoslash
import { type Federation, Update } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
const request = new Request("");
const identifier: string = "";
// ---cut-before---
const ctx = federation.createContext(request, undefined);
const actor = await ctx.getActor(identifier);  // [!code highlight]
if (actor != null) {
  await ctx.sendActivity(
    { identifier },
    "followers",
    new Update({ actor: actor.id, object: actor }),
  );
}
~~~~

> [!NOTE]
> The `RequestContext.getActor()` method is only available when the actor
> dispatcher is registered to the `Federation` object.  If the actor dispatcher
> is not registered, the `RequestContext.getActor()` method throws an error.

In the same way, you can use the `RequestContext.getObject()` method to dispatch
an object from the URL arguments.  The following shows an example:

~~~~ typescript twoslash
import { type Federation, Note } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
const request = new Request("");
const identifier: string = "";
const id: string = "";
// ---cut-before---
const ctx = federation.createContext(request, undefined);
const note = await ctx.getObject(Note, { identifier, id });  // [!code highlight]
~~~~


Getting a `DocumentLoader`
--------------------------

The `Context.documentLoader` property carries a `DocumentLoader` object that
is specified in the `Federation` constructor.  It is used to load remote
documents and contexts in the JSON-LD format.  There are a few methods to take
a `DocumentLoader` as an option in vocabulary API:

 -  [`fromJsonLd()` static method](./vocab.md#json-ld)
 -  [`toJsonLd()` method](./vocab.md#json-ld)
 -  [`get*()` dereferencing accessors](./vocab.md#object-ids-and-remote-objects)
 -  [`lookupObject()` function](./vocab.md#looking-up-remote-objects)

All of those methods take options in the form of
`{ documentLoader?: DocumentLoader, contextLoader?: DocumentLoader }` which is
compatible with `Context`.  So you can just pass a `Context` object to those
methods:

~~~~ typescript twoslash
import {  type Context, Object } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
const jsonLd: unknown = {};
// ---cut-before---
const object = await Object.fromJsonLd(jsonLd, ctx);
const json = await object.toJsonLd(ctx);
~~~~


Getting an authenticated `DocumentLoader`
-----------------------------------------

*This API is available since Fedify 0.4.0.*

Sometimes you need to load a remote document which requires authentication,
such as an actor's following collection that is configured as private.
In such cases, you can use the `Context.getDocumentLoader()` method to get
an authenticated `DocumentLoader` object.  The following shows an example:

~~~~ typescript twoslash
import { type Actor, type Context, Person } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
const actor = new Person({}) as Actor;
// ---cut-before---
const documentLoader = await ctx.getDocumentLoader({
  identifier: "2bd304f9-36b3-44f0-bf0b-29124aafcbb4",
});
const following = await actor.getFollowing({ documentLoader });
~~~~

In the above example, the `getFollowing()` method takes the `documentLoader`
which is authenticated as the actor with an identifier of
`2bd304f9-36b3-44f0-bf0b-29124aafcbb4`.  If the `actor` allows
actor `2bd304f9-36b3-44f0-bf0b-29124aafcbb4` to see the following collection,
the `getFollowing()` method returns the following collection.

> [!TIP]
> Inside a personal inbox listener, the `Context.documentLoader` property is
> automatically set to an authenticated `DocumentLoader` object that is
> identified by the inbox owner's key.  So you don't need to call the
> `Context.getDocumentLoader()` method in the personal inbox listener,
> but just passing the `Context` object to dereferencing accessors is enough.
>
> See the [*`Context.documentLoader` on an inbox listener*
> section](./inbox.md#context-documentloader-on-an-inbox-listener) for details.


Document loader vs. context loader
----------------------------------

Both a document loader and a context loader are represented by `DocumentLoader`
type, but they are used for different purposes:

 -  A <dfn>document loader</dfn> is used to load remote documents,
    such as an actor's profile document, an object document, and so on.

 -  A <dfn>context loader</dfn> is used to load remote contexts,
    such as the ActivityStreams context, the W3C security context, and so on.

Sometimes a document loader needs to be authenticated to load a remote document
which requires authorization, but a context loader mostly needs to be highly
cached and doesn't require authorization.


Looking up remote objects
-------------------------

*This API is available since Fedify 0.15.0.*

> [!TIP]
> In most cases, you don't need to look up remote objects explicitly.
> Instead, you can use the dereferencing accessors to fetch the remote objects
> implicitly.
>
> For example, you can get the `object` from an `Activity` object directly:
>
> ~~~~ typescript twoslash
> import { Activity } from "@fedify/fedify";
> const activity = new Activity({});
> // ---cut-before---
> const object = await activity.getObject();
> ~~~~
>
> … instead of:
>
> ~~~~ typescript twoslash
> import { Activity, type Context } from "@fedify/fedify";
> const ctx = null as unknown as Context<void>;
> const activity = new Activity({});
> // ---cut-before---
> const object = activity.objectId == null
>   ? null
>   : await ctx.lookupObject(activity.objectId);
> ~~~~

Suppose your app has a search box that allows the user to look up a fediverse
user by the handle or a post by the URI.  In such cases, you need to look up
the object from a remote server that your app haven't interacted with yet.
The `Context.lookupObject()` method plays a role in such cases.  The following
shows an example of looking up an actor object from the handle:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const actor = await ctx.lookupObject("@hongminhee@todon.eu");
~~~~

In the above example, the `~Context.lookupObject()` method queries the remote
server's WebFinger endpoint to get the actor's URI from the handle,
and then fetches the actor object from the URI.

> [!TIP]
> The `~Context.lookupObject()` method accepts a fediverse handle without
> prefix `@` as well:
>
> ~~~~ typescript twoslash
> import { type Context } from "@fedify/fedify";
> const ctx = null as unknown as Context<void>;
> // ---cut-before---
> const actor = await ctx.lookupObject("hongminhee@todon.eu");
> ~~~~
>
> Also an `acct:` URI:
>
> ~~~~ typescript twoslash
> import { type Context } from "@fedify/fedify";
> const ctx = null as unknown as Context<void>;
> // ---cut-before---
> const actor = await ctx.lookupObject("acct:hongminhee@todon.eu");
> ~~~~

The `~Context.lookupObject()` method is not limited to the actor object.
It can look up any object in the Activity Vocabulary.  For example
the following shows an example of looking up a `Note` object from the URI:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const note = await ctx.lookupObject(
  "https://todon.eu/@hongminhee/112060633798771581"
);
~~~~

> [!NOTE]
> Some objects require authentication to look up, such as a `Note` object with
> a visibility of followers-only.  In such cases, you need to use
> the `Context.getDocumentLoader()` method to get an authenticated
> `DocumentLoader` object.  The `~Context.lookupObject()` method takes the
> `documentLoader` option to specify the method to fetch the remote object:
>
> ~~~~ typescript twoslash
> import { type Context } from "@fedify/fedify";
> const ctx = null as unknown as Context<void>;
> // ---cut-before---
> const documentLoader = await ctx.getDocumentLoader({ identifier: "john" });
> const note = await ctx.lookupObject("...", { documentLoader });
> ~~~~
>
> See the [*Getting an authenticated
> `DocumentLoader`*](#getting-an-authenticated-documentloader)
> section for details.


WebFinger lookups
-----------------

*This API is available since Fedify 1.6.0.*

The `Context` provides a dedicated method for WebFinger lookups when you need
to find information about accounts and resources across federated networks.
The `~Context.lookupWebFinger()` method allows you to query a remote server's
WebFinger endpoint directly:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const webfingerData = await ctx.lookupWebFinger("acct:fedify@hollo.social");
~~~~

If the lookup fails or the account doesn't exist, the method returns `null`.
The returned WebFinger document contains links to various resources associated
with the account, such as profile pages, ActivityPub actor URIs, and more:

~~~~ typescript twoslash
import { type Context, isLink, isOStatusSubscribeLink } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const webfingerData = await ctx.lookupWebFinger("acct:fedify@hollo.social");

// Find the ActivityPub actor URI
const activityPubActorLink = webfingerData?.links?.find(
  isLink.withCondition((link) =>
    link.rel === "self" &&
    link.type === "application/activity+json"
  ),
);

if (activityPubActorLink?.href) {
  const actor = await ctx.lookupObject(activityPubActorLink.href);
  // Work with the actor...
}

// Get subscription template URI
const activityPubSubscribeLink = webfingerData?.links?.find((link) =>
  isOStatusSubscribeLink(link)
);

if (activityPubSubscribeLink?.template) {
  // Work with remote follow URI...
}

~~~~

> [!NOTE]
> In most cases, you can use the higher-level `~Context.lookupObject()` method
> which automatically performs WebFinger lookups when given a handle.
> Use `~Context.lookupWebFinger()` when you need the raw WebFinger data or
> want more direct control over the lookup process.


Traversing remote collections
-----------------------------

*This API is available since Fedify 1.1.0.*

Sometimes you need to traverse a remote collection from the beginning
to the end, such as an actor's outbox, an actor's followers collection,
and so on.  The `Context.traverseCollection()` method plays a role in such
cases.  The following shows an example of traversing an actor's outbox:

~~~~ typescript twoslash
import { type Context, isActor } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const actor = await ctx.lookupObject("@hongminhee@fosstodon.org");
if (isActor(actor)) {
  const outbox = await actor.getOutbox();
  if (outbox != null) {
    for await (const activity of ctx.traverseCollection(outbox)) {
      console.log(activity);
    }
  }
}
~~~~


Replacing the context data
--------------------------

*This API is available since Fedify 1.6.0.*

You can replace the context data by calling the `Context.clone()` method.
This is useful when you want to create a new context based on the existing one
but with different data.  The following shows an example of replacing the
context data:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<{ foo: string; bar: number }>;
// ---cut-before---
const newCtx = ctx.clone({ ...ctx.data, foo: "new value" });
~~~~
