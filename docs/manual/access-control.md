---
description: >-
  Fedify provides a flexible access control system that allows you to control
  who can access your resources.  This section explains how to use the access
  control system.
---

Access control
==============

*This API is available since Fedify 0.7.0.*

Fedify provides a flexible access control system that allows you to control who
can access your resources through the method named [authorized fetch], which is
popularized by Mastodon.  The method requires HTTP Signatures to be attached to
even `GET` requests, and Fedify automatically verifies the signatures and
derives the actor from the signature.

> [!NOTE]
> Although the method is popularized by Mastodon, it is not a part of the
> ActivityPub specification, and clients are not required to use the method.
> Turning this feature on may limit the compatibility with some clients.

[authorized fetch]: https://swicg.github.io/activitypub-http-signature/#authorized-fetch


Enabling authorized fetch
-------------------------

To enable authorized fetch, you need to register an `AuthorizePredicate`
callback with `ActorCallbackSetters.authorize()` or
`CollectionCallbackSetters.authorize()`, or `ObjectAuthorizePredicate` callback
with `ObjectCallbackSetters.authorize()`.  The below example shows how to enable
authorized fetch for the actor dispatcher:

~~~~ typescript{9-11} twoslash
// @noErrors: 2307 2345
import type { Federation } from "@fedify/fedify";
import type { Actor } from "@fedify/vocab";
/**
 * A hypothetical `Federation` instance.
 */
const federation = null as unknown as Federation<void>;
/**
 * A hypothetical function that checks if the user blocks the actor.
 * @param userId The ID of the user to check if the actor is blocked.
 * @param signedKeyOwner The actor who signed the request.
 * @returns `true` if the actor is blocked; otherwise, `false`.
 */
async function isBlocked(userId: string, signedKeyOwner: Actor): Promise<boolean> {
  return false;
}
// ---cut-before---
import { federation } from "./your-federation.ts";
import { isBlocked } from "./your-blocklist.ts";

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    // Omitted for brevity; see the related section for details.
  })
  .authorize(async (ctx, identifier) => {
    const signedKeyOwner = await ctx.getSignedKeyOwner();
    if (signedKeyOwner == null) return false;
    return !await isBlocked(identifier, signedKeyOwner);
  });
~~~~

The equivalent method is available for collections as well:

~~~~ typescript{9-11} twoslash
// @noErrors: 2307 2345
import type { Federation } from "@fedify/fedify";
import type { Actor } from "@fedify/vocab";
/**
 * A hypothetical `Federation` instance.
 */
const federation = null as unknown as Federation<void>;
/**
 * A hypothetical function that checks if the user blocks the actor.
 * @param userId The ID of the user to check if the actor is blocked.
 * @param signedKeyOwner The actor who signed the request.
 * @returns `true` if the actor is blocked; otherwise, `false`.
 */
async function isBlocked(userId: string, signedKeyOwner: Actor): Promise<boolean> {
  return false;
}
// ---cut-before---
import { federation } from "./your-federation.ts";
import { isBlocked } from "./your-blocklist.ts";

federation
  .setOutboxDispatcher("/users/{identifier}/outbox", async (ctx, identifier) => {
    // Omitted for brevity; see the related section for details.
  })
  .authorize(async (ctx, identifier) => {
    const signedKeyOwner  = await ctx.getSignedKeyOwner();
    if (signedKeyOwner == null) return false;
    return !await isBlocked(identifier, signedKeyOwner);
  });
~~~~

If the predicate returns `false`, the request is rejected with a
`401 Unauthorized` response.


Fine-grained access control
---------------------------

You may not want to block everything from an unauthorized user, but only filter
some resources.  For example, you may want to show some private posts to
a specific group of users.  In such cases, you can use the
`RequestContext.getSignedKeyOwner()` method inside the dispatcher
to get the actor who signed the request and make a decision based on the actor.

The method returns the `Actor` object who signed the request (more precisely,
the owner of the key that signed the request, if the key is associated with an
actor).  The below pseudo code shows how to filter out private posts:

~~~~ typescript{7} twoslash
// @noErrors: 2307
import type { Federation } from "@fedify/fedify";
import type { Actor, Create } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
interface Post {
  /**
   * A hypothetical method that checks if the post is visible to the actor.
   * @param actor The actor who wants to access the post.
   * @returns `true` if the post is visible; otherwise, `false`.
   */
  isVisibleTo(actor: Actor): boolean;
}
/**
 * A hypothetical function that gets posts from the database.
 * @param userId The ID of the user to get posts.
 * @returns The posts of the user.
 */
async function getPosts(userId: string): Promise<Post[]> {
  return [];
}
/**
 * A hypothetical function that converts a model object to an ActivityStreams object.
 * @param post The model object to convert.
 * @returns The ActivityStreams object.
 */
function toCreate(post: Post): Create {
  return {} as unknown as Create;
}
// ---cut-before---
import { federation } from "./your-federation.ts";
import { getPosts, toCreate } from "./your-model.ts";

federation
  .setOutboxDispatcher("/users/{identifier}/outbox", async (ctx, identifier) => {
    const posts = await getPosts(identifier);  // Get posts from the database
    const keyOwner = await ctx.getSignedKeyOwner();  // Get the actor who signed the request
    if (keyOwner == null) return { items: [] };  // Return an empty array if the actor is not found
    const items = posts
      .filter(post => post.isVisibleTo(keyOwner))  // [!code highlight]
      .map(toCreate);  // Convert model objects to ActivityStreams objects
    return { items };
  });
~~~~


Instance actor
--------------

When you enable authorized fetch, you need to fetch actors from other servers
to retrieve their public keys.  However, this can cause problems when the other
server also has authorized fetch enabled:

 -  *Unauthenticated appearance*: If the remote server requires a signed
    request to fetch its actor, and your server fetches it without a signature,
    the remote server returns an HTTP 401 error.  In this case,
    `~RequestContext.getSignedKeyOwner()` returns `null`, so the requester
    appears unauthenticated to your `AuthorizePredicate`—which will typically
    deny the request.

 -  *Infinite loop*: If both servers require authorized fetch, fetching the
    remote actor requires your server to be authenticated, which in turn
    requires fetching *your* actor, which requires authentication, and so on.

> [!NOTE]
> Even without the infinite loop, if the remote server requires authorized
> fetch, `~RequestContext.getSignedKeyOwner()` returns `null` for requests
> from that server (since fetching the key owner fails with HTTP 401).
> This means such requests appear unauthenticated to your
> `AuthorizePredicate`.  To properly authenticate those requests, implement
> the instance actor pattern below.

The most common way to prevent both problems is a pattern called
[instance actor], which is an actor that represents the whole instance and
exceptionally does not require authorized fetch.  You can use the instance
actor to fetch resources from other servers with a valid signature, without
causing an infinite loop.

Usually, many ActivityPub implementations name their instance actor as their
domain name, such as `example.com@example.com`.  Here is an example of how to
implement an instance actor:

~~~~ typescript{3-11,20-27} twoslash
import { type Federation } from "@fedify/fedify";
import { type Actor, Application, Person } from "@fedify/vocab";
/**
 * A hypothetical `Federation` instance.
 */
const federation = null as unknown as Federation<void>;
/**
 * A hypothetical function that checks if the user blocks the actor.
 * @param userId The ID of the user to check if the actor is blocked.
 * @param signedKeyOwner The actor who signed the request.
 * @returns `true` if the actor is blocked; otherwise, `false`.
 */
async function isBlocked(userId: string, signedKeyOwner: Actor): Promise<boolean> {
  return false;
}
// ---cut-before---
federation
  .setActorDispatcher("/actors/{identifier}", async (ctx, identifier) => {
    if (identifier === ctx.hostname) {
      // A special case for the instance actor:
      return new Application({
        id: ctx.getActorUri(identifier),
        // Omitted for brevity; other properties of the instance actor...
        // Note that you have to set the `publicKey` property of the instance
        // actor.
      });
    }

    // A normal case for a user actor:
    return new Person({
      id: ctx.getActorUri(identifier),
      // Omitted for brevity; other properties of the user actor...
    });
  })
  .authorize(async (ctx, identifier) => {
    // Allow the instance actor to access any resources:
    if (identifier === ctx.hostname) return true;
    // Create an authenticated document loader behalf of the instance actor:
    const documentLoader = await ctx.getDocumentLoader({
      identifier: ctx.hostname,
    });
    // Get the actor who signed the request:
    const signedKeyOwner = await ctx.getSignedKeyOwner({ documentLoader });
    if (signedKeyOwner == null) return false;
    return !await isBlocked(identifier, signedKeyOwner);
  });
~~~~

[instance actor]: https://swicg.github.io/activitypub-http-signature/#instance-actor

<!-- cSpell: ignore blocklist -->
