---
description: >-
  Fedify provides a way to register inbox listeners so that you can handle
  incoming activities from other actors.  This section explains how to
  register an inbox listener and how to handle errors.
---

Inbox listeners
===============

In ActivityPub, an [inbox] is where an actor receives incoming activities from
other actors.  Fedify provides a way to register inbox listeners so that you can
handle incoming activities from other actors.

[inbox]: https://www.w3.org/TR/activitypub/#inbox


Signature verification
----------------------

The inbox listeners automatically verify the signature of the incoming
activities with various specifications, such as:

 -  Draft cavage [HTTP Signatures]
 -  HTTP Message Signatures ([RFC 9421])
 -  [Linked Data Signatures]
 -  Object Integrity Proofs ([FEP-8b32])

You don't need to worry about the signature verification at all.  By default,
activities whose signatures/proofs cannot be verified are rejected with
`401 Unauthorized` and are not passed to inbox listeners.  If you want to see
why some activities are rejected, you can turn on [logging](./log.md) for
`["fedify", "sig"]` category.

[HTTP Signatures]: https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures-12
[RFC 9421]: https://www.rfc-editor.org/rfc/rfc9421
[Linked Data Signatures]: https://web.archive.org/web/20170923124140/https://w3c-dvcg.github.io/ld-signatures/
[FEP-8b32]: https://w3id.org/fep/8b32

### Compound portable objects

The inbox independently verifies every JSON map with an [FEP-ef61] portable
`id` or `@id`, i.e., an `ap:` or `ap+ef61:` URI or a compatible identifier,
including embedded collections, with the
[map-local compound-proof profile](./send.md#compound-portable-objects).  A
valid proof on the outer activity does not authenticate an unsigned or invalid
portable object embedded within it.  The gateway trust allowance for an
unsigned top-level portable collection does not apply inside a compound
document; an embedded portable collection needs its own proof and `@context`.
The only maps exempt from this are keys embedded in the `publicKey` or
`assertionMethod` of a verified portable actor whose IDs are the actor's
compatible identifiers plus fragments, such as its gateway keys, which the
actor's proof covers.

This check uses the received JSON after the normal outer authentication and
actor ownership checks.  Since a Linked Data Signature is made after the
Object Integrity Proofs, the check excludes the top-level `signature` property,
whatever its value, from every proof input, as the verification of the
activity's own proof does.  A `signature` property of an embedded map stays
part of the input of that map's proof.  Fedify consumes a deferred
signature nonce only after the entire compound document passes verification.
It also verifies the complete result before dispatching the activity through a
queue, route, or listener.  Unsupported proof shapes and documents that exceed
the inspection or verification limits receive `401 Unauthorized`.  Fedify does
not dispatch any part of those documents to application code.

[FEP-ef61]: https://w3id.org/fep/ef61

### Portable actors

*This behavior is available since Fedify 2.4.0.*

An activity whose actor is an [FEP-ef61] portable actor, i.e., has an `ap:` or
`ap+ef61:` ID, or a [compatible identifier] such as
`https://example.com/.well-known/apgateway/did:key:z6Mk.../actor`, is accepted
only if its Object Integrity Proof made by the actor's DID is valid.  An HTTP
Signature or a Linked Data Signature does not authenticate it, not even an HTTP
Signature made with one of the actor's
[gateway keys](./actor.md#gateway-keys-of-portable-actors), which only tells
which gateway sent the request.  Such an activity without a valid proof is
rejected with `401 Unauthorized`.  Conversely, an activity with a valid proof
is accepted even if the gateway that sent it did not sign the request with
a key the actor lists.

The same goes for an activity whose own ID is portable: its Object Integrity
Proof has to be made by the DID of its ID, so an activity whose ID names
a DID other than the one that signed it is rejected, even if its actor is
authenticated.  Compatible identifiers of the same portable object on
different gateways are the same object, so the gateways in an activity's ID
and its actor's ID may differ.

A compatible identifier stands for the portable object it contains, whatever
server serves it, so Fedify treats such an actor as a portable actor rather
than as an ordinary actor of the gateway's origin.  An actor that publishes
compatible identifiers without signing its activities, which FEP-ef61 does not
allow, is therefore rejected; so are actors whose DIDs use key types that
Fedify cannot verify, such as the ML-DSA-44 `did:key` DIDs that [tootik]
optionally supports.

[compatible identifier]: https://w3id.org/fep/ef61#compatible-ids
[tootik]: https://github.com/dimkr/tootik

### `Accept-Signature` challenges

*This API is available since Fedify 2.1.0.*

You can optionally enable [`Accept-Signature`] challenge emission on inbox
`401` responses by setting the `inboxChallengePolicy` option when creating
a `Federation`:

~~~~ typescript
import { createFederation } from "@fedify/fedify";

const federation = createFederation<void>({
  // ... other options ...
  inboxChallengePolicy: {
    enabled: true,
    // Optional: customize covered components (defaults shown below)
    // components: ["@method", "@target-uri", "@authority", "content-digest"],
    // Optional: require a one-time nonce for replay protection
    // requestNonce: false,
    // Optional: nonce TTL in seconds (default: 300)
    // nonceTtlSeconds: 300,
  },
});
~~~~

When enabled, if HTTP Signature verification fails, the `401` response will
include an `Accept-Signature` header telling the sender which components and
parameters to include in a new signature.  Senders that support [RFC 9421 §5]
(including Fedify 2.1.0+) will automatically retry with the requested
parameters.

Note that actor/key mismatch `401` responses are *not* challenged, since
re-signing with different parameters does not resolve an impersonation issue.

When `requestNonce` is enabled, a cryptographically random nonce is included
in each challenge and must be echoed back in the retry signature.  The nonce
is stored in the key-value store and consumed on use, providing replay
protection.  Nonces expire after `nonceTtlSeconds` (default: 5 minutes).

[`Accept-Signature`]: https://www.rfc-editor.org/rfc/rfc9421#section-5.1
[RFC 9421 §5]: https://www.rfc-editor.org/rfc/rfc9421#section-5


Handling unverified activities
------------------------------

*This API is available since Fedify 2.1.0.*

Most applications can keep the default behavior and ignore unverified inbound
activities.  However, some applications need finer control.  Typical examples
include:

 -  remote actor deletions where the `Delete` activity can still be parsed,
    but the signing key now returns `410 Gone`
 -  noisy redelivery loops from remote servers that keep retrying activities
    you have decided not to process
 -  custom logging, metrics, moderation, or quarantine flows for suspicious
    inbound traffic

For these cases, you can register
`~InboxListenerSetters.onUnverifiedActivity()`.  The callback receives the
`RequestContext`, the parsed activity, and a reason object whose `type` is one
of `"noSignature"`, `"invalidSignature"`, or `"keyFetchError"`.

If the callback returns a `Response`, Fedify uses it as-is.  If it returns
nothing (`void`), Fedify falls back to the default `401 Unauthorized`
response.

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Delete } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .onUnverifiedActivity((ctx, activity, reason) => {
    if (
      activity instanceof Delete &&
      reason.type === "keyFetchError" &&
      "status" in reason.result &&
      reason.result.status === 410
    ) {
      // For example, stop redelivery of a Delete from a permanently gone actor.
      return new Response(null, { status: 202 });
    }
  });
~~~~

Returning a custom response does not pass the activity to the inbox listeners
registered through `~InboxListenerSetters.on()`.  Verified activities continue
to flow to those listeners as usual; unverified activities remain opt-in.

The request context includes the original `Request` object, so you can inspect
details such as the `Host` header through `RequestContext.request` when making
policy decisions.


Registering an inbox listener
-----------------------------

An inbox is basically an HTTP endpoint that receives webhook requests from other
servers.  There are two types of inboxes in ActivityPub: the [shared inbox] and
the personal inbox.  The shared inbox is a single inbox that receives activities
for all actors in the server, while the personal inbox is an inbox for a
specific actor.

With Fedify, you can register an inbox listener for both types of inboxes at
a time.  The following shows how to register an inbox listener:

~~~~ typescript{7-20} twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Accept, Follow } from "@fedify/vocab";

const federation = createFederation({
  // Omitted for brevity; see the related section for details.
});

federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    if (follow.id == null || follow.objectId == null) return;
    const parsed = ctx.parseUri(follow.objectId);
    if (parsed?.type !== "actor") return;
    const recipient = await follow.getActor(ctx);
    if (recipient == null) return;
    await ctx.sendActivity(
      { identifier: parsed.identifier },
      recipient,
      new Accept({ actor: follow.objectId, object: follow.id }),
    );
  });
~~~~

In the above example, the `~Federatable.setInboxListeners()` method registers
path patterns for the personal inbox and the shared inbox, and the following
`~InboxListenerSetters.on()` method registers an inbox listener for the `Follow`
activity.  The `~InboxListenerSetters.on()` method takes a class of the activity
and a callback function that takes a `Context` object and the activity object.

Note that the `~InboxListenerSetters.on()` method can be chained to register
multiple inbox listeners for different activity types.

> [!NOTE]
> The URI Template syntax supports different expansion types like `{identifier}`
> (simple expansion) and `{+identifier}` (reserved expansion).  Use the plain
> `{identifier}` form for ordinary segment-bounded identifiers such as
> `/users/{identifier}/inbox`.  `{+identifier}` is an advanced choice reserved
> for identifiers that themselves contain slashes (such as embedded URIs);
> because it keeps `/` literal, it can consume extra path segments and overlap
> with more specific routes, so add explicit validation when you use it.  See
> the [*URI Template* guide](./uri-template.md) for details.

> [!WARNING]
> Activities of any type that are not registered with
> the `~InboxListenerSetters.on()` method are silently ignored.
> If you want to catch all types of activities anyway, add a listener
> for the `Activity` class.

> [!TIP]
> You can get a personal or shared inbox URI by calling
> the `~Context.getInboxUri()` method.  It takes an optional parameter
> `identifier` to get the personal inbox URI for the actor with the given
> identifier.  If the `identifier` parameter is not provided, the method
> returns the shared inbox URI.

[shared inbox]: https://www.w3.org/TR/activitypub/#shared-inbox-delivery


Determining the recipient of an activity
----------------------------------------

### Looking at the `to`, `cc`, `bto`, and `bcc` fields

When you receive an activity, you may want to determine the recipient of the
activity.  The recipient is usually the actor who is mentioned in
the `to`, `cc`, `bto`, or `bcc` field of the activity.  The following shows
how to determine the recipient of a `Create` activity:

~~~~ typescript twoslash
import { type InboxListenerSetters } from "@fedify/fedify";
import { Create } from "@fedify/vocab";
(0 as unknown as InboxListenerSetters<void>)
// ---cut-before---
.on(Create, async (ctx, create) => {
  if (create.toId == null) return;
  const to = ctx.parseUri(create.toId);
  if (to?.type !== "actor") return;
  const recipient = to.identifier;
  // Do something with the recipient
});
~~~~

The `to`, `cc`, `bto`, and `bcc` fields can contain multiple recipients,
so you may need to iterate over them to determine the recipient of the activity:

~~~~ typescript twoslash
import { type InboxListenerSetters } from "@fedify/fedify";
import { Create } from "@fedify/vocab";
(0 as unknown as InboxListenerSetters<void>)
// ---cut-before---
.on(Create, async (ctx, create) => {
  for (const toId of create.toIds) {
    const to = ctx.parseUri(toId);
    if (to?.type !== "actor") continue;
    const recipient = to.identifier;
    // Do something with the recipient
  }
});
~~~~

Also, the `to`, `cc`, `bto`, and `bcc` fields can contain both actor and
collection objects.  In such cases, you may need to recursively resolve the
collection objects to determine the recipients of the activity:

~~~~ typescript twoslash
import { type InboxListenerSetters } from "@fedify/fedify";
import { Collection, Create, isActor } from "@fedify/vocab";
(0 as unknown as InboxListenerSetters<void>)
// ---cut-before---
.on(Create, async (ctx, create) => {
  for await (const to of create.getTos()) {
    if (isActor(to)) {
      // `to` is a recipient of the activity
      // Do something with the recipient
    } else if (to instanceof Collection) {
      // `to` is a collection object
      for await (const actor of to.getItems()) {
        if (!isActor(actor)) continue;
        // `actor` is a recipient of the activity
        // Do something with the recipient
      }
    }
  }
});
~~~~

> [!TIP]
> It might look strange, non-scalar accessor methods for `to`, `cc`, `bto`,
> and `bcc` fields are named as `~Object.getTos()`, `~Object.getCcs()`,
> `~Object.getBtos()`, and `~Object.getBccs()`, respectively.

### Looking at the `InboxContext.recipient` property

*This API is available since Fedify 1.2.0.*

However, the `to`, `cc`, `bto`, and `bcc` fields are not always present in
an activity.  In such cases, you can determine the recipient by looking at
the `InboxContext.recipient` property.  The below example shows how to determine
the recipient of a `Follow` activity:

~~~~ typescript twoslash
import { type InboxListenerSetters } from "@fedify/fedify";
import { Follow } from "@fedify/vocab";
(0 as unknown as InboxListenerSetters<void>)
// ---cut-before---
.on(Follow, async (ctx, follow) => {
  const recipient = ctx.recipient;
  // Do something with the recipient
});
~~~~

The `~InboxContext.recipient` property is set to the identifier of the actor
who is the recipient of the activity.  If the invocation is not for a personal
inbox, but for a shared inbox, the `~InboxContext.recipient` property is set to
`null`.


`Context.documentLoader` on an inbox listener
---------------------------------------------

The `Context.documentLoader` property carries a `DocumentLoader` object that
you can use to fetch a remote document.  If a request is made to a shared inbox,
the `Context.documentLoader` property is set to the default `documentLoader`
that is specified in the `createFederation()` function.  However, if a request
is made to a personal inbox, the `Context.documentLoader` property is set to
an authenticated `DocumentLoader` object that is identified by the inbox owner's
key.

This means that you can pass the `Context` object to dereferencing accessors[^1]
inside a personal inbox listener so that they can fetch remote documents with
the correct authentication.

[^1]: See the [*Object IDs and remote objects*
      section](./vocab.md#object-ids-and-remote-objects) if you are not familiar
      with dereferencing accessors.

### Shared inbox key dispatcher

*This API is available since Fedify 0.11.0.*

> [!TIP]
> We highly recommend configuring the shared inbox key dispatcher to avoid
> potential incompatibility issues with ActivityPub servers that require
> [authorized fetch] (i.e., secure mode).

If you want to use an authenticated `DocumentLoader` object as
the `Context.documentLoader` for a shared inbox, you can set the identity
for the authentication using `~InboxListenerSetters.setSharedKeyDispatcher()`
method.  For example, the following shows how to implement the [instance actor]
pattern:

~~~~ typescript{5-9,13-18} twoslash
import type { Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
// ---cut-before---
import { Application, Person } from "@fedify/vocab";

federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  // The following line assumes that there is an instance actor named `~actor`
  // for the server.  The leading tilde (`~`) is just for avoiding conflicts
  // with regular actor handles, but you don't have to necessarily follow this
  // convention:
  .setSharedKeyDispatcher((_ctx) => ({ identifier: "~actor" }));

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    if (identifier === "~actor") {
      // Returns an Application object for the instance actor:
      return new Application({
        // ...
      });
    }

    // Fetches the regular actor from the database and returns a Person object:
    return new Person({
      // ...
    });
  });
~~~~

Or you can manually configure the key pair instead of referring to an actor
by its identifier:

~~~~ typescript{11-18} twoslash
// @noErrors: 2391
import type { Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
/**
 * A hypothetical type that represents an instance actor.
 */
interface InstanceActor {
  /**
   * The private key of the instance actor in JWK format.
   */
  privateKey: JsonWebKey;
  /**
   * The URI of the public key of the instance actor.
   */
  publicKeyUri: string;
}
/**
 * A hypothetical function that fetches information about the instance actor
 * from a database or some other storage.
 * @returns Information about the instance actor.
 */
function getInstanceActor(): InstanceActor;
// ---cut-before---
import { importJwk } from "@fedify/fedify";

interface InstanceActor {
  privateKey: JsonWebKey;
  publicKeyUri: string;
}

federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .setSharedKeyDispatcher(async (_ctx) => {
    // The following getInstanceActor() is just a hypothetical function that
    // fetches information about the instance actor from a database or some
    // other storage:
    const instanceActor: InstanceActor = await getInstanceActor();
    return {
      privateKey: await importJwk(instanceActor.privateKey, "private"),
      keyId: new URL(instanceActor.publicKeyUri),
    };
  });
~~~~

> [!NOTE]
> If a shared inbox key dispatcher returns `null`, the default `documentLoader`,
> which is not authenticated, is used for the shared inbox.

[authorized fetch]: https://swicg.github.io/activitypub-http-signature/#authorized-fetch
[instance actor]: https://seb.jambor.dev/posts/understanding-activitypub-part-4-threads/#the-instance-actor


Making inbox listeners non-blocking
-----------------------------------

*This API is available since Fedify 0.12.0.*

Usually, processes inside an inbox listener should be non-blocking because
they may involve long-running tasks.  Fortunately, you can easily turn inbox
listeners into non-blocking by providing a [`queue`](./federation.md#queue)
option to `createFederation()` function:

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation, InProcessMessageQueue } from "@fedify/fedify";

const federation = createFederation({
  // Omitted for brevity; see the related section for details.
  queue: new InProcessMessageQueue(),  // [!code highlight]
});
~~~~

> [!NOTE]
> The `InProcessMessageQueue` is a simple in-memory message queue that is
> suitable for development and testing.  For production use, you should
> consider using a more robust message queue, such as [`DenoKvMessageQueue`]
> from [`@fedify/denokv`] package, [`RedisMessageQueue`] from
> [`@fedify/redis`] package, or [`MysqlMessageQueue`] from
> [`@fedify/mysql`] package.
>
> For more information, see the [*Message queue* section](./mq.md).

If it is not present, incoming activities are processed immediately and block
the response to the sender until the processing is done.

While the `queue` option is not mandatory, it is highly recommended to use it
in production environments to prevent the server from being overwhelmed by
incoming activities.

With the `queue` enabled, the failed activities are automatically retried
after a certain period of time.  By default, Fedify handles retries using
exponential backoff with a maximum of 10 retries, but you can customize it
by providing an [`inboxRetryPolicy`](./federation.md#inboxretrypolicy) option
to the `createFederation()` function.

However, if your message queue backend provides native retry mechanisms
(indicated by `MessageQueue.nativeRetrial` being `true`), Fedify will skip
its own retry logic and rely on the backend to handle retries.  This avoids
duplicate retry mechanisms and leverages the backend's optimized retry features.

> [!NOTE]
> Activities with invalid signatures/proofs are not queued and are not passed
> to inbox listeners.  If
> `~InboxListenerSetters.onUnverifiedActivity()` is configured, the hook runs
> before the default `401 Unauthorized` response is returned.

> [!TIP]
> If your inbox listeners are mostly I/O-bound, consider parallelizing
> message processing by using the `ParallelMessageQueue` class.  For more
> information, see the [*Parallel message processing*
> section](./mq.md#parallel-message-processing).
>
> If your inbox listeners are CPU-bound, consider running multiple nodes of
> your application so that each node can process messages in parallel with
> the shared message queue.

[`DenoKvMessageQueue`]: https://jsr.io/@fedify/denokv/doc/mq/~/DenoKvMessageQueue
[`@fedify/denokv`]: https://github.com/fedify-dev/fedify/tree/main/packages/denokv
[`RedisMessageQueue`]: https://jsr.io/@fedify/redis/doc/mq/~/RedisMessageQueue
[`@fedify/redis`]: https://github.com/fedify-dev/fedify/tree/main/packages/redis
[`MysqlMessageQueue`]: https://jsr.io/@fedify/mysql/doc/mq/~/MysqlMessageQueue
[`@fedify/mysql`]: https://github.com/fedify-dev/fedify/tree/main/packages/mysql


Activity idempotency
--------------------

*This API is available since Fedify 1.9.0.*

In ActivityPub, the same activity might be delivered multiple times to your
inbox for various reasons, such as network failures, server restarts, or
federation protocol retries.  To prevent processing the same activity multiple
times, Fedify provides idempotency mechanisms that detect and skip duplicate
activities.

### Idempotency strategies

Fedify supports three built-in idempotency strategies:

`"per-inbox"` (default)
:   Activities are deduplicated per inbox.  The same activity ID can be
    processed once per inbox, allowing the same activity to be delivered to
    multiple inboxes independently.  This follows standard ActivityPub behavior
    and is the default strategy since Fedify 2.0.0.

`"per-origin"`
:   Activities are deduplicated per receiving server's origin.  The same
    activity ID will be processed only once on each receiving server,
    but can be processed separately on different receiving servers.
    This had been the default behavior in Fedify 1.x versions.

`"global"`
:   Activities are deduplicated globally across all inboxes and origins.
    The same activity ID will be processed only once, regardless of
    which inbox receives it or which server sent it.

You can configure the idempotency strategy using the
`~InboxListenerSetters.withIdempotency()` method:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Follow } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .withIdempotency("per-inbox")  // Standard ActivityPub behavior
  .on(Follow, async (ctx, follow) => {
    // Handle the follow activity
  });
~~~~

### Custom idempotency strategy

If the built-in strategies don't meet your needs, you can implement a custom
idempotency strategy by providing a callback function.  The callback receives
the inbox context and the activity, and should return a unique cache key for
the activity, or `null` to skip idempotency checking for that activity:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Follow } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .withIdempotency(async (ctx, activity) => {
    // Skip idempotency for Follow activities
    if (activity instanceof Follow) return null;

    // Use per-inbox strategy for other activities
    const inboxId
      = ctx.recipient == null
      ? "shared"
      : `actor\n${ctx.recipient}`;
    return `${ctx.origin}\n${activity.id?.href}\n${inboxId}`;
  })
  .on(Follow, async (ctx, follow) => {
    // This Follow activity will not be deduplicated
  });
~~~~

### Idempotency cache

Processed activities are cached for 24 hours to detect duplicates.  The cache
uses the same [key–value store](./kv.md) that you provided to
the `createFederation()` function.  Cache keys are automatically namespaced to
avoid conflicts with other data.


Error handling
--------------

Since an incoming activity can be malformed or invalid, you may want to handle
such cases.  Also, your listener itself may throw an error.
The `~InboxListenerSetters.onError()` method registers a callback
function that takes a `Context` object and an error object.  The following shows
an example of handling errors:

~~~~ typescript{6-8} twoslash
import { type Federation } from "@fedify/fedify";
import { Follow } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    // Omitted for brevity
  })
  .onError(async (ctx, error) => {
    console.error(error);
  });
~~~~

> [!NOTE]
> Activities with invalid signatures/proofs are not passed to the error
> handler.  If you need to inspect them, use
> `~InboxListenerSetters.onUnverifiedActivity()` instead.


Forwarding activities to another server
---------------------------------------

*This API is available since Fedify 1.0.0.*

Sometimes, you may want to forward incoming activities to another server.
For example, you may want to forward `Flag` activities to a moderation server.
Or you may want to forward `Create` activities which reply to your server to
your followers so that they can see the replies.

The problem is that the recipients of the forwarded activities will not trust
the forwarded activities unless they are signed by the original sender, not by
you.  You might think that you can just `~Context.sendActivity()` the received
activity to the recipient in your inbox listener, but it doesn't work because
the signature made by the original sender is stripped when the received activity
is passed to the inbox listener, and `~Context.sendActivity()` will sign the
activity with your key.

To solve this problem, you can use the `~InboxContext.forwardActivity()` method
in your inbox listener.  It forwards the received activity without any
modification, so the signature made by the original sender is preserved
(if the activity is signed using by the original sender).

The following shows an example of forwarding `Create` activities to followers:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Create } from "@fedify/vocab";
const federation: Federation<void> = null as unknown as Federation<void>;
federation.setInboxListeners("/{identifier}/inbox", "/inbox")
// ---cut-before---
.on(Create, async (ctx, create) => {
  if (create.toId == null) return;
  const to = ctx.parseUri(create.toId);
  if (to?.type !== "actor") return;
  const forwarder = to.identifier;
  await ctx.forwardActivity({ identifier: forwarder }, "followers");
})
~~~~

> [!NOTE]
> The `~InboxContext.forwardActivity()` method does not guarantee that the
> forwarded activity is successfully delivered to the recipient, since
> the original sender might  neither sign the activity using [Linked Data
> Signatures](./send.md#linked-data-signatures) nor [Object Integrity
> Proofs](./send.md#object-integrity-proofs).  In such cases, the recipient
> probably won't trust the forwarded activity.[^2]
>
> If you don't want to forward unsigned activities, you can turn on
> the `skipIfUnsigned` option in the `~InboxContext.forwardActivity()` method:
>
> ~~~~ typescript twoslash
> import { type InboxContext } from "@fedify/fedify";
> const ctx = null as unknown as InboxContext<void>;
> // ---cut-before---
> await ctx.forwardActivity(
>   { identifier: "alice" },
>   "followers",
>   { skipIfUnsigned: true },
> );
> ~~~~

> [!NOTE]
> The `~InboxContext.forwardActivity()` method does not use a [two-stage
> delivery process](./send.md#optimizing-activity-delivery-for-large-audiences),
> because `~InboxContext.forwardActivity()` method is invoked inside inbox
> listeners, which are usually running in the background task worker.

[^2]: Some implementations may try to verify the unsigned activity by fetching
      the original object from the original sender's server even if they don't
      trust the forwarded activity. However, it is not guaranteed that all
      implementations do so.


Constructing inbox URIs
-----------------------

To construct an inbox URI, you can use the `~Context.getInboxUri()` method.
This method optionally takes an identifier of an actor and returns
a dereferenceable URI of the inbox of the actor.  If no argument is provided,
the method returns the shared inbox URI.

The following shows how to construct an inbox URI of an actor identified by
`5fefc9bb-397d-4949-86bb-33487bf233fb`:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
ctx.getInboxUri("5fefc9bb-397d-4949-86bb-33487bf233fb")
~~~~

> [!NOTE]
> The `~Context.getInboxUri()` method does not guarantee that the inbox
> actually exists.  It only constructs a URI based on the given identifier,
> which may respond with `404 Not Found`.  Make sure to check if the identifier
> is valid before calling the method.

The following shows how to construct a shared inbox URI:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
ctx.getInboxUri()
~~~~


Portable inboxes
----------------

*This API is available since Fedify 2.4.0.*

An [FEP-ef61] portable actor, whose ID is an `ap+ef61:` URI with a [DID]
instead of a host, has a portable inbox like
`ap+ef61://did:key:z6Mk.../users/alice/inbox`, and lists the servers that
store its data in its `gateways` property.  Every gateway of the actor has to
accept deliveries to the inbox through its `/.well-known/apgateway` endpoint:

~~~~ http
POST /.well-known/apgateway/did:key:z6Mk.../users/alice/inbox HTTP/1.1
Host: example.com
Content-Type: application/activity+json
~~~~

Fedify handles such a request with the same inbox listeners as ordinary
deliveries, so you do not need a separate API for portable inboxes.  The path
after the DID has to match the inbox path you passed to
`~Federatable.setInboxListeners()`, e.g., `/users/{identifier}/inbox`, and
the `~Context.getPortableInboxUri()` method builds such a portable inbox ID
for the actor dispatcher to use:

~~~~ typescript twoslash
import { type Federation, signObject } from "@fedify/fedify";
import { Follow, Person } from "@fedify/vocab";
import { parseIri } from "@fedify/vocab-runtime";
const federation = null as unknown as Federation<void>;
interface User { username: string; did: string }
async function findUser(_username: string): Promise<User | null> {
  return null;
}
async function getPortableKey(
  _did: string,
): Promise<{ privateKey: CryptoKey; keyId: URL }> {
  return null!;
}
// ---cut-before---
federation.setActorDispatcher(
  "/users/{identifier}",
  async (ctx, identifier) => {
    const user = await findUser(identifier);
    if (user == null) return null;
    const { privateKey, keyId } = await getPortableKey(user.did);
    return await signObject(
      new Person({
        // ap+ef61://did:key:z6Mk.../users/alice
        id: parseIri(`ap+ef61://${user.did}/users/${identifier}`),
        // ap+ef61://did:key:z6Mk.../users/alice/inbox
        inbox: ctx.getPortableInboxUri(identifier, user.did),
        gateways: [
          new URL("https://example.com"),
          new URL("https://other.example"),
        ],
      }),
      privateKey,
      keyId,  // e.g., did:key:z6Mk...#z6Mk...
    );
  },
);

federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    // Called for deliveries to both /users/alice/inbox and
    // /.well-known/apgateway/did:key:z6Mk.../users/alice/inbox:
    console.log(ctx.recipient);  // "alice"
  });
~~~~

Fedify accepts a delivery to a portable inbox only if the actor dispatcher,
called with the identifier in the inbox path, returns an actor such that:

 -  its ID is a portable ID, or a [compatible
    identifier](./actor.md#compatible-identifiers-as-actor-ids), with the same
    DID as the requested inbox;
 -  its `inbox` is the requested portable inbox, or a compatible identifier of
    it on any gateway; and
 -  its `gateways` include the origin of this server, i.e.,
    `~Context.canonicalOrigin`.

Otherwise, Fedify responds with `404 Not Found`, as FEP-ef61 requires of
a server that does not accept deliveries on behalf of the actor, so
applications that do not have portable actors are unaffected.  A malformed
DID or path results in `400 Bad Request`.  Only personal inboxes are
reachable through the gateway endpoint; the shared inbox is not.

The actor is looked up by the identifier alone, as for ordinary deliveries,
and the actor document is trusted as your application returns it.  So make
sure that the identifier determines a single actor regardless of the DID in
the request path, and that the actor's `gateways` list only servers you
intend to deliver to.

Once accepted, the delivery goes through the same pipeline as ordinary
deliveries: signature verification, including the FEP-ef61 proof policy for
portable activities and objects (see the [*Compound portable objects*
section](#compound-portable-objects)), [activity
idempotency](#activity-idempotency), queueing, and inbox listeners.
Activities delivered to a portable inbox do not have to be portable; an
ordinary activity signed with HTTP Signatures is accepted as well.

> [!NOTE]
> The listener idempotency described in the [*Activity idempotency*
> section](#activity-idempotency) suppresses a duplicate delivery only after
> an earlier delivery of the same activity has been processed successfully,
> and only if their idempotency keys match, e.g., the activity ID, the
> recipient, and the origin of the request with the default `"per-inbox"`
> strategy.

[DID]: https://www.w3.org/TR/did-core/

### Forwarding to other gateways

FEP-ef61 recommends that a gateway forward an activity received in a portable
inbox to the inboxes of the same actor on its other gateways, so that every
gateway stores the actor's data, but forbids forwarding an activity from
an inbox more than once.  Fedify does so automatically for an accepted
delivery, including a duplicate one and one that is queued or has no inbox
listener for its type, but not when an inbox listener fails, in which case
the sender retries it.  All of the following have to hold as well:

 -  The activity is authenticated by its own [Object Integrity
    Proof](./send.md#object-integrity-proofs) or Linked Data Signature, not
    only by HTTP Signatures, since the other gateways have to authenticate
    the activity by itself: an HTTP Signature on a forwarded request, if any,
    is made by this server, not by the activity's actor.
 -  The `~FederationOptions.skipSignatureVerification` option is not turned on.
 -  The activity has an `id`.
 -  The key–value store supports `~KvStore.cas()`.  Otherwise, Fedify logs
    a warning and does not forward any activity, since it could not ensure
    that each activity is forwarded at most once.

The activity is sent as received to the compatible inbox URL on each gateway
other than this server, e.g.,
`https://other.example/.well-known/apgateway/did:key:z6Mk.../users/alice/inbox`,
to at most 10 gateways per delivery by default.  An activity is told apart by
its canonical portable ID, so it is not forwarded again when it arrives with
a compatible identifier on another gateway instead of its `ap:` ID, or vice
versa.  With an outbox queue,
forwarding is queued like other outgoing activities and retried on failures.
Without one, the requests are made immediately, and Fedify waits for them for
up to 10 seconds by default before responding to the delivery.

Forwarded requests are signed with HTTP Signatures by this server's [gateway
key](./actor.md#gateway-keys-of-portable-actors) for the actor, as some
servers reject unsigned requests even if the activity has a valid proof.
It takes the first RSA key pair that `~Context.getActorKeyPairs()` returns for
the identifier in the inbox path, and only if
`~ActorCallbackSetters.mapPortableActorId()` maps the identifier to the same
portable actor as the recipient.  Otherwise, e.g., without a key pairs
dispatcher, a portable actor ID mapper, or an RSA key pair, the requests are
sent without HTTP Signatures.  The other gateways can verify the signature
only if the actor document they get from this server is signed by the actor's
DID, embeds the key as a `Multikey` in its `assertionMethod`, and lists this
server in its `gateways`.  They accept the activity for its proof either way.

Fedify remembers each gateway that it has forwarded an activity to for 30 days
by default under the `~FederationKvPrefixes.portableInboxForwarding` key
prefix, and
never forwards the same activity from the same inbox to the same gateway
again within that period, even if the forwarding failed.  So forwarding is
best effort; configure an [outbox queue](./mq.md) to retry transient
failures.  A gateway that the activity is forwarded back to drops it the same
way, which ends the forwarding.

The limits above can be changed with the
[`portableInboxForwarding`](./federation.md#portableinboxforwarding) option,
which can also turn off forwarding:

~~~~ typescript twoslash
import { createFederation, MemoryKvStore } from "@fedify/fedify";

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
  portableInboxForwarding: { maxTargets: 0 },  // Turns off forwarding
});
~~~~

> [!WARNING]
> Fedify tells which gateway it is by `~Context.canonicalOrigin`, which comes
> from the `Host` of the request unless you configure the
> [`origin`](./federation.md#explicitly-setting-the-canonical-origin) option.
> If you run a gateway, configure the `origin` option, or make sure that your
> server or reverse proxy validates the `Host` header.  Otherwise, a request
> with a spoofed `Host` naming another gateway of the actor can make this
> server skip forwarding to that gateway and forward the activity to itself
> instead, in which case inbox listeners may process the activity twice.


Manual routing
--------------

*This API is available since Fedify 1.3.0.*

If you want to manually route an activity to the appropriate inbox listener
with no actual HTTP request, you can use the `Context.routeActivity()` method.
The method takes an identifier of the recipient (or `null` for the shared inbox)
and an `Activity` object to route.  The point of this method is that it verifies
if the `Activity` object is made by the its actor, and unless it is, the method
silently ignores the activity.

The following code shows how to route an `Activity` object enclosed in
top-level `Announce` object to the corresponding inbox listener:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Activity, Announce } from "@fedify/vocab";

const federation = null as unknown as Federation<void>;

federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
// ---cut-before---
  .on(Announce, async (ctx, announce) => {
    // Get an object enclosed in the `Announce` object:
    const object = await announce.getObject();
    if (object instanceof Activity) {
      // Route the activity to the appropriate inbox listener (shared inbox):
      await ctx.routeActivity(ctx.recipient, object);
    }
  })
~~~~

As another example, the following code shows how to invoke the corresponding
inbox listeners for a remote actor's activities:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { Activity, isActor } from "@fedify/vocab";

async function main(context: Context<void>) {
// ---cut-before---
const actor = await context.lookupObject("@hongminhee@fosstodon.org");
if (!isActor(actor)) return;
const collection = await actor.getOutbox();
if (collection == null) return;
for await (const item of context.traverseCollection(collection)) {
  if (item instanceof Activity) {
    await context.routeActivity(null, item);
  }
}
// ---cut-after---
}
~~~~

> [!TIP]
> The `Context.routeActivity()` method trusts the `Activity` object only if
> one of the following conditions is met:
>
>  -  The `Activity` has its Object Integrity Proofs and the proofs are signed
>     by its actor.
>
>  -  The `Activity` is dereferenceable by its `~Object.id` and
>     the dereferenced object has an actor that belongs to the same origin
>     as the `Activity` object.

<!-- cSpell: ignore cavage -->
