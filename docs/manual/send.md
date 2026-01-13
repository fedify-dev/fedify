---
description: >-
  Fedify provides a way to send activities to other actors' inboxes.
  This section explains how to send activities to others.
---

Sending activities
==================

In ActivityPub, an actor can deliver an activity to another actor by
[sending an HTTP `POST` request to the recipient's inbox][1].  Fedify provides
an abstracted way to send activities to other actors' inboxes.

[1]: https://www.w3.org/TR/activitypub/#delivery


Prerequisite: actor key pairs
-----------------------------

Before sending an activity to another actor, you need to have the sender's
key pairs.  The key pairs are used to sign the activity so that the recipient
can verify the sender's identity.  The key pairs can be registered by calling
`~ActorCallbackSetters.setKeyPairsDispatcher()` method.

For more information about this topic, see [*Public keys of an `Actor`*
section](./actor.md#public-keys-of-an-actor) in the *Actor dispatcher* section.


Sending an activity
-------------------

To send an activity to another actor, you can use the `Context.sendActivity()`
method.  The following shows how to send a `Follow` activity to another actor:

~~~~ typescript{8-15} twoslash
import { type Context } from "@fedify/fedify";
import { Follow, type Recipient } from "@fedify/vocab";

async function sendFollow(
  ctx: Context<void>,
  senderId: string,
  recipient: Recipient,
) {
  await ctx.sendActivity(
    { identifier: senderId },
    recipient,
    new Follow({
      id: new URL(`https://example.com/${senderId}/follows/${recipient.id}`),
      actor: ctx.getActorUri(senderId),
      object: recipient.id,
    }),
  );
}
~~~~

> [!TIP]
> Wonder where you can acquire a `Context` object?  See the [*Where to get a
> `Context` object* section](./context.md#where-to-get-a-context-object) in
> the *Context* section.


Specifying a sender
-------------------

The first argument of the `Context.sendActivity()` method is the sender
of the activity.  It can be three types of values:

### `{ identifier: string }`

If you specify an object with the `identifier` property, the sender is
the actor with the given identifier.  The identifier is used to find the
actor's key pairs to sign the activity:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { Activity } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const activity = new Activity({});
// ---cut-before---
await ctx.sendActivity(
  { identifier: "2bd304f9-36b3-44f0-bf0b-29124aafcbb4" },  // [!code highlight]
  "followers",
  activity,
);
~~~~

### `{ username: string }`

If you specify an object with the `username` property, the sender is
the actor with the given WebFinger username.  The username is used to find
the actor's key pairs to sign the activity:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { Activity } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const activity = new Activity({});
// ---cut-before---
await ctx.sendActivity(
  { username: "john" },  // [!code highlight]
  "followers",
  activity,
);
~~~~

If you don't [decouple the username from the
identifier](./actor.md#decoupling-actor-uris-from-webfinger-usernames),
this is the same as the `{ identifier: string }` case.

### `SenderKeyPair | SenderKeyPair[]`

If you specify a `SenderKeyPair` object or an array of `SenderKeyPair` objects,
the sender is the set of the given key pairs:

~~~~ typescript twoslash
import { type Context, SenderKeyPair } from "@fedify/fedify";
import { Activity, type Actor } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const activity = new Activity({});
const recipients: Actor[] = [];
// ---cut-before---
await ctx.sendActivity(
  await ctx.getActorKeyPairs("2bd304f9-36b3-44f0-bf0b-29124aafcbb4"),  // [!code highlight]
  recipients,  // You need to specify the recipients manually
  activity,
);
~~~~

However, you probably don't want to use this option directly; instead,
you should use above two options to specify the sender.


Specifying recipients
---------------------

The second argument of the `Context.sendActivity()` method is the recipients
of the activity.  It can be multiple, and you can set them to `Recipient`
objects, or `Actor` objects (which satisfy the `Recipient` interface), or
simply `"followers"` string which is a special value that represents the
followers of the sender.

### `Actor | Actor[]`

If you specify `Actor` objects, the activity is delivered to the actors'
inboxes (or shared inboxes if some actors support it and you turn on
the `preferSharedInbox` option):

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { Activity, type Actor } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const activity = new Activity({});
const actor = {} as Actor;
// ---cut-before---
await ctx.sendActivity(
  { identifier: "2bd304f9-36b3-44f0-bf0b-29124aafcbb4" },
  actor,  // [!code highlight]
  activity,
);
~~~~

Or you can specify multiple actors:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { Activity, type Actor } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const activity = new Activity({});
const actor = {} as Actor;
const actor2 = {} as Actor;
const actor3 = {} as Actor;
// ---cut-before---
await ctx.sendActivity(
  { username: "john" },
  [actor, actor2, actor3],  // [!code highlight]
  activity,
);
~~~~

### `Recipient | Recipient[]`

If you specify any objects that satisfy the `Recipient` interface, the activity
is delivered to the recipients' inboxes (or shared inboxes if some recipients
support it and you turn on the `preferSharedInbox` option).

The `Recipient` interface is defined as follows:

~~~~ typescript twoslash
export interface Recipient {
  readonly id: URL | null;
  readonly inboxId: URL | null;
  readonly endpoints?: {
    sharedInbox: URL | null;
  } | null;
}
~~~~

Here's an example of specifying a `Recipient` object:

~~~~ typescript{3-6} twoslash
import { type Context } from "@fedify/fedify";
import { Activity, Recipient } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const activity = new Activity({});
// ---cut-before---
await ctx.sendActivity(
  { identifier: "2bd304f9-36b3-44f0-bf0b-29124aafcbb4" },
  {
    id: new URL("https://example.com/actors/1"),
    inboxId: new URL("https://example.com/actors/1/inbox"),
  } satisfies Recipient,
  activity,
);
~~~~

Or you can provide its shared inbox endpoint as well:

~~~~ typescript{6-8} twoslash
import { type Context } from "@fedify/fedify";
import { Activity, Recipient } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const activity = new Activity({});
// ---cut-before---
await ctx.sendActivity(
  { username: "john" },
  {
    id: new URL("https://example.com/actors/1"),
    inboxId: new URL("https://example.com/actors/1/inbox"),
    endpoints: {
      sharedInbox: new URL("https://example.com/inbox"),
    }
  } satisfies Recipient,
  activity,
  { preferSharedInbox: true },  // [!code highlight]
);
~~~~

### `"followers"`

> [!NOTE]
> You need to implement the [followers collection
> dispatcher](./collections.md#followers) to use this feature.

It's the most convenient way to deliver an activity to the followers of the
sender.

If you specify the `"followers"` string, the activity is delivered to the
followers of the sender.  It is a special value that represents the followers
of the sender:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { Activity } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const activity = new Activity({});
// ---cut-before---
await ctx.sendActivity(
  { identifier: "2bd304f9-36b3-44f0-bf0b-29124aafcbb4" },
  "followers",  // [!code highlight]
  activity,
);
~~~~

> [!NOTE]
> You cannot use the `"followers"` string if the sender is a `SenderKeyPair` or
> an array of `SenderKeyPair` objects.  You need to specify the recipients
> manually in this case.

> [!TIP]
> Does the `Context.sendActivity()` method take quite a long time to complete
> even if you configured the [`queue`](./federation.md#queue)?  It might be
> because the followers collection is large and the method under the hood
> invokes your [followers collection dispatcher](./collections.md#followers)
> multiple times to paginate the collection.  To improve the performance,
> you should implement the [one-short followers collection for gathering
> recipients](./collections.md#one-shot-followers-collection-for-gathering-recipients).


Specifying an activity
----------------------

The third argument of the `Context.sendActivity()` method is the activity
to send.  It can be an instance of any subclass of the `Activity` class, such
as `Follow`, `Create`, `Like`, and so on.

Every activity must have the `actor` property, which corresponds to the sender
of the activity.  [You can get the actor's URI by calling
the `Context.getActorUri()` method.](./actor.md#constructing-actor-uris)

Every activity should have the `id` property, which is a unique IRI for the
activity.  If you don't specify the `id` property, [Fedify automatically
generates a unique IRI for the activity by default](#autoidassigner)—but it is
recommended to specify the `id` property explicitly.

> [!TIP]
> The activity's `id` does not have to be necessarily dereferenceable—it's
> totally fine to use a URL with a fragment identifier, such as
> `https://example.com/123#follow/751d477f-2167-4473-ace5-4404f4760c0d`.

> [!CAUTION]
> Sometimes you may tempted to derive the activity's `id` from the actor and
> the object's `id` properties, but keep in mind that the same kind of
> activities can be made by the same actor to the same object multiple times.
>
> For example, if Alice sends a `Follow` activity to Bob, Bob accepts it,
> Alice sends an `Undo(Follow)` activity to Bob, and Alice sends a `Follow`
> activity to Bob again, the `id` of the `Follow` activity should be different
> from the previous one, even if the `actor` and the `object` are the same.
>
> If they have the same `id`, the recipient may mistakenly think that the
> activity is a duplicate of the previous one and ignore it, which is not
> what you want.
>
> To ensure the uniqueness of the activity's `id`, it is recommended to contain
> a UUID or a similar unique identifier in the `id` property.

The most of cases, an activity should have the `to` property, which corresponds
to the recipient of the activity.  If it's a public activity, you can set
the `to` property to the `PUBLIC_COLLECTION` constant, which represents
the public addressing.  There's also the `cc` property, which corresponds to
the secondary recipients of the activity.  Those two properties can be multiple,
and you can set them to `Actor` objects, `Collection` objects, or `URL` objects.

> [!TIP]
> If you want to mimic the behavior of Mastodon's post privacy settings,
> here's a table that shows how to set the `to` and `cc` properties:
>
> | Privacy setting  | `to` property               | `cc` property               |
> | ---------------- | --------------------------- | --------------------------- |
> | Public           | `PUBLIC_COLLECTION`         | `Context.getFollowersUri()` |
> | Quiet public[^1] | `Context.getFollowersUri()` | `PUBLIC_COLLECTION`         |
> | Followers-only   | `Context.getFollowersUri()` | Mentioned actors            |
> | Direct message   | Mentioned actors            |                             |

To wrap up, the following is an example of sending a `Create` activity:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { type Actor, Create, Note, PUBLIC_COLLECTION } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const senderId: string = "";
const noteId: string = "";
const content: string = "";
const recipients: Actor[] = [];
// ---cut-before---
await ctx.sendActivity(
  { identifier: senderId },
  recipients,
  new Create({
    id: new URL(`#create`, ctx.getObjectUri(Note, { id: noteId })),
    actor: ctx.getActorUri(senderId),
    object: new Note({
      id: ctx.getObjectUri(Note, { id: noteId }),
      attribution: ctx.getActorUri(senderId),
      to: PUBLIC_COLLECTION,
      cc: ctx.getFollowersUri(senderId),
      content,
    }),
  }),
);
~~~~

[^1]: Previously known as <q>Unlisted</q> in Mastodon—renamed to <q>Quiet
      public</q> in Mastodon 4.3.0. It's a public post that doesn't appear in
      the public timeline and the hashtag pages.


Enqueuing an outgoing activity
------------------------------

The delivery failure can happen for various reasons, such as network failure,
recipient server failure, and so on.  For reliable delivery, Fedify enqueues
an outgoing activity to the queue instead of immediately sending it to
the recipient's inbox if possible; the system retries the delivery on failure.

This queueing mechanism is enabled only if a [`queue`](./federation.md#queue)
option is set to the `createFederation()` function:

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
> from [`@fedify/denokv`] package or [`RedisMessageQueue`] from
> [`@fedify/redis`] package.
>
> For further information, see the [*Message queue* section](./mq.md).

The failed activities are automatically retried after a certain period of time.
By default, Fedify handles retries using exponential backoff with a maximum of
10 retries, but you can customize it by providing
an [`outboxRetryPolicy`](./federation.md#outboxretrypolicy) option to
the `createFederation()` function.

However, if your message queue backend provides native retry mechanisms
(indicated by `MessageQueue.nativeRetrial` being `true`), Fedify will skip
its own retry logic and rely on the backend to handle retries.  This avoids
duplicate retry mechanisms and leverages the backend's optimized retry features.

If the `queue` is not set, the `~Context.sendActivity()` method immediately
sends the activity to the recipient's inbox.  If the delivery fails, it throws
an error and does not retry the delivery.

[`DenoKvMessageQueue`]: https://jsr.io/@fedify/denokv/doc/mq/~/DenoKvMessageQueue
[`@fedify/denokv`]: https://github.com/fedify-dev/fedify/tree/main/packages/denokv
[`RedisMessageQueue`]: https://jsr.io/@fedify/redis/doc/mq/~/RedisMessageQueue
[`@fedify/redis`]: https://github.com/fedify-dev/fedify/tree/main/packages/redis


Optimizing activity delivery for large audiences
------------------------------------------------

*This API is available since Fedify 1.5.0.*

When sending activities to many recipients (such as when a user with thousands
of followers creates a post), the delivery process can become
performance-intensive.  Fedify optimizes this scenario by using a fan-out
mechanism that improves response times and resource utilization.

### How fan-out works

By default, when the number of recipients exceeds a threshold, Fedify uses
a two-stage delivery process:

1.  First, it creates a single consolidated message containing the activity
    payload and all recipient inboxes
2.  Then, a background worker processes this message and re-enqueues individual
    delivery tasks

This approach has several benefits:

 -  The `Context.sendActivity()` method returns more quickly
 -  Memory consumption is reduced by avoiding payload duplication
 -  The user interface remains responsive during large-scale deliveries
 -  Each delivery still maintains independent retry logic

### Customizing fan-out behavior

You can control this behavior using the `fanout` option in
the `~Context.sendActivity()` method:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
import type { Activity, Recipient } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const activity = {} as Activity;
const recipients: Recipient[] = [];
// ---cut-before---
await ctx.sendActivity(
  { identifier: "alice" },  // sender
  recipients,               // recipients
  activity,                 // activity to send
  { fanout: "auto" }        // fan-out strategy  // [!code highlight]
);
~~~~

The `fanout` option accepts the following values:

`"auto"` (default)
:   Automatically chooses the optimal strategy based on recipient count

`"skip"`
:   Always enqueues individual messages, bypassing the fan-out queue
    (use when payload needs to vary per recipient)

`"force"`
:   Always uses the fan-out queue regardless of recipient count

> [!NOTE]
> The `fanout` option is ignored when `immediate: true` is specified,
> as immediate delivery bypasses all queuing mechanisms.

### When to use each option

Use the default `"auto"` for most cases:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
import type { Activity, Recipient } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const activity = {} as Activity;
const recipients: Recipient[] = [];
// ---cut-before---
await ctx.sendActivity({ identifier: "alice" }, recipients, activity);
~~~~

Use `"skip"` when you need different content for each recipient:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
import type { Activity, Recipient } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const activity = {} as Activity;
const recipients: Recipient[] = [];
// ---cut-before---
await ctx.sendActivity(
  { identifier: "alice" },
  recipients,
  activity,
  { fanout: "skip" }  // [!code highlight]
);
~~~~

Use `"force"` to ensure fan-out behavior even with few recipients (rarely
needed):

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
import type { Activity, Recipient } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const activity = {} as Activity;
const recipients: Recipient[] = [];
// ---cut-before---
await ctx.sendActivity(
  { identifier: "alice" },
  recipients,
  activity,
  { fanout: "force" }  // [!code highlight]
);
~~~~


Immediately sending an activity
-------------------------------

Sometimes you may want to send an activity immediately without queueing it.
You can do this by calling the `~Context.sendActivity()` method with the
`immediate` option:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { Follow, type Recipient } from "@fedify/vocab";

async function sendFollow(
  ctx: Context<void>,
  senderId: string,
  recipient: Recipient,
) {
  await ctx.sendActivity(
    { identifier: senderId },
    recipient,
    new Follow({
      actor: ctx.getActorUri(senderId),
      object: recipient.id,
    }),
    { immediate: true },  // [!code highlight]
  );
}
~~~~


Shared inbox delivery
---------------------

The [shared inbox delivery] is an efficient way to deliver an activity to
multiple recipients belonging to the same server at once.  It is useful
for broadcasting activities, such as a public post.

By default, `~Context.sendActivity()` method delivers an activity to the
recipient's personal inbox.  To deliver an activity to the shared inbox,
you can pass the `preferSharedInbox` option:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { Create, Note, type Recipient, PUBLIC_COLLECTION } from "@fedify/vocab";

async function sendNote(
  ctx: Context<void>,
  senderId: string,
  recipient: Recipient,
) {
  await ctx.sendActivity(
    { identifier: senderId },
    recipient,
    new Create({
      actor: ctx.getActorUri(senderId),
      to: PUBLIC_COLLECTION,
      object: new Note({
        attribution: ctx.getActorUri(senderId),
        to: PUBLIC_COLLECTION,
      }),
    }),
    { preferSharedInbox: true },  // [!code highlight]
  );
}
~~~~

> [!TIP]
> `PUBLIC_COLLECTION` constant contains a `URL` object of
> <https://www.w3.org/ns/activitystreams#Public>, a special IRI that
> represents the public audience.  By setting the `to` property to this IRI,
> the activity is visible to everyone.  See also the
> [*Public Addressing* section] in the ActivityPub specification.

> [!NOTE]
> To deliver an activity to the shared inbox, the recipient server must support
> the shared inbox delivery.  Otherwise, Fedify silently falls back to
> the personal inbox delivery.

[shared inbox delivery]: https://www.w3.org/TR/activitypub/#shared-inbox-delivery
[*Public Addressing* section]: https://www.w3.org/TR/activitypub/#public-addressing


Followers collection synchronization
------------------------------------

*This API is available since Fedify 0.8.0, and it is optional since
Fedify 1.5.0.*

> [!NOTE]
> For efficiency, you should implement
> [filtering-by-server](./collections.md#filtering-by-server) of
> the followers collection, otherwise the synchronization may be slow.

If an activity needs to be delivered to only followers of the sender through
the shared inbox, the server of the recipients has to be aware of the list of
followers residing on the server.  However, synchronizing the followers
collection every time an activity is sent is inefficient. To solve this problem,
Mastodon, etc., use a mechanism called
[followers collection synchronization][FEP-8fcf].

The idea is to send a digest of the followers collection with the activity
so that the recipient server can check if it needs to resynchronize
the followers collection.  Fedify provides a way to include the digest
of the followers collection in the activity delivery request by specifying
the recipients parameter of the `~Context.sendActivity()` method as
the `"followers"` string and turning on
the `~SendActivityOptionsForCollection.syncCollection` option:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { Create, Note } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const senderId : string = "";
// ---cut-before---
await ctx.sendActivity(
  { identifier: senderId },
  "followers",  // [!code highlight]
  new Create({
    actor: ctx.getActorUri(senderId),
    to: ctx.getFollowersUri(senderId),
    object: new Note({
      attribution: ctx.getActorUri(senderId),
      to: ctx.getFollowersUri(senderId),
    }),
  }),
  {
    preferSharedInbox: true,  // [!code highlight]
    syncCollection: true,  // [!code highlight]
  },
);
~~~~

The `~SendActivityOptionsForCollection.syncCollection` option is only available
when you specify the `"followers"` string as the recipients parameter.  With
turning on this option, it automatically sends the activity to the sender's
followers and includes the digest of the followers collection in the payload.

> [!NOTE]
> The `to` and `cc` properties of an `Activity` and its `object` should be set
> to the followers collection IRI to ensure that the activity is visible to
> the followers.  If you set the `to` and `cc` properties to
> the `PUBLIC_COLLECTION`, the activity is visible to everyone regardless of
> the recipients parameter.

> [!NOTE]
> Some history of this feature: The followers collection synchronization was
> first introduced in Fedify 0.8.0, but it was automatically turned on when
> the recipients parameter was set to the `"followers"` string then.
> Since Fedify 1.5.0, it is optional, and you need to explicitly turn on
> the `~SendActivityOptionsForCollection.syncCollection` option to use it.

[FEP-8fcf]: https://w3id.org/fep/8fcf


Excluding same-server recipients
--------------------------------

*This API is available since Fedify 0.9.0.*

Usually, you don't want to send messages through ActivityPub to followers on
the same server because they share the same database, so there's no need to.

For example, if *@foo@example.com* creates a post, it's already stored in
the database at *example.com*, so there's no need to send a `Create(Note)`
activity to *@bar@example.com*, because *@bar@example.com* already has access
to the post in the database.

To exclude same-server recipients, you can pass the `excludeBaseUris` option
to the `~Context.sendActivity()` method:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { Activity } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const senderId: string = "";
const activity = new Activity({});
// ---cut-before---
await ctx.sendActivity(
  { identifier: senderId },
  "followers",
  activity,
  { excludeBaseUris: [ctx.getInboxUri()] },  // [!code highlight]
);
~~~~

Excluded recipients do not receive the activity, even if they are included in
the recipients parameter.

> [!NOTE]
> Only the `origin` parts of the specified URIs are compared with the
> inbox URLs of the recipients.  Even if they have `pathname` or `search` parts,
> they are ignored when comparing the URIs.


Error handling
--------------

*This API is available since Fedify 0.6.0.*

Since an outgoing activity is not immediately processed, but enqueued to the
queue, the `~Context.sendActivity()` method does not throw an error even if
the delivery fails.  Instead, the delivery failure is reported to the queue
and retried later.

If you want to handle the delivery failure, you can register an error handler
to the queue:

~~~~ typescript{6-9} twoslash
// @noErrors: 2345
import { createFederation, InProcessMessageQueue } from "@fedify/fedify";

const federation = createFederation({
  // Omitted for brevity; see the related section for details.
  queue: new InProcessMessageQueue(),
  onOutboxError: (error, activity) => {
    console.error("Failed to deliver an activity:", error);
    console.error("Activity:", activity);
  },
});
~~~~

> [!NOTE]
> The `onOutboxError` callback can be called multiple times for the same
> activity, because the delivery is retried according to the backoff schedule
> until it succeeds or reaches the maximum retry count.


HTTP Signatures
---------------

Draft cavage [HTTP Signatures] is a de facto standard for signing ActivityPub
activities.  Although it is not a finalized specification, it is still widely
used in the fediverse to verify the sender's identity and the integrity of
the activity.

Fedify automatically signs activities with the sender's private key if
the [actor keys dispatcher is set](./actor.md#public-keys-of-an-actor) and
the actor has any RSA-PKCS#1-v1.5 key pair.  If there are multiple key pairs,
Fedify selects the first RSA-PKCS#1-v1.5 key pair among them.

[HTTP Signatures]: https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures-12


HTTP Message Signatures
-----------------------

*This API is available since Fedify 1.6.0.*

[RFC 9421], also known as *HTTP Message Signatures*, is the final revision of
the HTTP Signatures specification.  Although it is the official standard,
it is not widely used in the fediverse yet.  As of May 2025, major ActivityPub
implementations, such as Mastodon, et al., still rely on the draft cavage
version of HTTP Signatures for signing portable activities.

Fedify automatically signs activities with the sender's private key if
the [actor keys dispatcher is set](./actor.md#public-keys-of-an-actor) and
the actor has any RSA-PKCS#1-v1.5 key pair.  If there are multiple key pairs,
Fedify selects the first RSA-PKCS#1-v1.5 key pair among them.

> [!NOTE]
> Although HTTP Message Signatures support other than RSA-PKCS#1-v1.5,
> Fedify currently supports only RSA-PKCS#1-v1.5 key pairs for generating
> HTTP Message Signatures.  This limitation will be lifted in the future
> releases.

[RFC 9421]: https://www.rfc-editor.org/rfc/rfc9421


Double-knocking HTTP Signatures
-------------------------------

*This API is available since Fedify 1.6.0.*

As you read above, there are two revisions of HTTP Signatures:
the [draft cavage][HTTP Signatures] version and the [RFC 9421] version.
The draft cavage version is declared as obsolete, but it is still widely used
in the fediverse, and many ActivityPub implementations still rely on it.
On the other hand, the RFC 9421 version is the official standard, but
it is not widely used yet.

To support both versions of HTTP Signatures, Fedify uses the [double-knocking]
mechanism: trying one version, then falling back to another if rejected.
If it's the first encounter with the recipient server, Fedify tries
the RFC 9421 version first, and if it fails, it falls back to the draft
cavage version.  If the recipient server accepts the RFC 9421 version,
Fedify remembers it and uses the RFC 9421 version for the next time.
If the recipient server rejects the RFC 9421 version, Fedify falls back
to the draft cavage version and remembers it for the next time.

[double-knocking]: https://swicg.github.io/activitypub-http-signature/#how-to-upgrade-supported-versions


Linked Data Signatures
----------------------

*This API is available since Fedify 1.0.0.*

[Linked Data Signatures] is a more advanced and widely used, but *obsolete*,
mechanism for signing portable ActivityPub activities.  As of November 2024,
major ActivityPub implementations, such as Mastodon, et al., still rely on
Linked Data Signatures for signing portable activities, despite they declare
that Linked Data Signatures is outdated.

It shares the similar concept with [HTTP Signatures](#http-signatures),
but unlike HTTP Signatures, it can be used for signing portable activities.
For example, it can be used for [forwarding from inbox] and several other
cases that HTTP Signatures cannot handle.

Fedify automatically includes the Linked Data Signature of activities by
signing them with the sender's private key if the [actor keys dispatcher is
set](./actor.md#public-keys-of-an-actor) and the actor has any RSA-PKCS#1-v1.5
key pair.  If there are multiple key pairs, Fedify uses the first
RSA-PKCS#1-v1.5 key pair among them.

> [!TIP]
> The combination of HTTP Signatures and Linked Data Signatures is the most
> widely supported way to sign activities in the fediverse, as of September
> 2024.  Despite Linked Data Signatures is outdated and not recommended for
> new implementations, it is still widely used in the fediverse due to Mastodon
> and other major implementations' reliance on it.
>
> However, for new implementations, you should consider using *both* [Object
> Integrity Proofs](#object-integrity-proofs) and Linked Data Signatures
> for maximum compatibility and future-proofing.  Fortunately, Fedify supports
> both Object Integrity Proofs and Linked Data Signatures simultaneously,
> in addition to HTTP Signatures.

> [!NOTE]
> If an activity is signed with both HTTP Signatures and Linked Data Signatures,
> the recipient verifies the Linked Data Signatures first when it is supported,
> and ignores the HTTP Signatures if the Linked Data Signatures are valid.
> If the recipient does not support Linked Data Signatures, it falls back to
> verifying the HTTP Signatures.

[Linked Data Signatures]: https://web.archive.org/web/20170923124140/https://w3c-dvcg.github.io/ld-signatures/
[forwarding from inbox]: https://www.w3.org/TR/activitypub/#inbox-forwarding


Object Integrity Proofs
-----------------------

*This API is available since Fedify 0.10.0.*

[Object Integrity Proofs][FEP-8b32] is a mechanism to ensure the integrity
of ActivityPub objects (not only activities!) in the fediverse.  It shares
the similar concept with [Linked Data Signatures](#linked-data-signatures),
but it has more functionalities and is more flexible.  However, as it is
relatively new, it is not widely supported yet.

Fedify automatically includes the integrity proof of activities by signing
them with the sender's private key if the [actor keys dispatcher is
set](./actor.md#public-keys-of-an-actor) and the actor has any Ed25519 key pair.
If there are multiple key pairs, Fedify creates the number of integrity proofs
equal to the number of Ed25519 key pairs.

> [!TIP]
> HTTPS Signatures, Linked Data Signatures, and Object Integrity Proofs can
> coexist in an application and be used together for maximum compatibility.
>
> If an activity is signed with HTTP Signatures, Linked Data Signatures,
> and Object Integrity Proofs, the recipient verifies the Object Integrity
> Proofs first when it is supported, and ignores the HTTP Signatures and
> Linked Data Signatures if the Object Integrity Proofs are valid.
> If the recipient does not support Object Integrity Proofs, it falls back to
> verifying the HTTP Signatures and Linked Data Signatures.
>
> To support HTTP Signatures, Linked Data Signatures, and Object Integrity
> Proofs simultaneously, you need to generate both RSA-PKCS#1-v1.5 and Ed25519
> key pairs for each actor, and store them in the database.

[FEP-8b32]: https://w3id.org/fep/8b32


Activity transformers
---------------------

*This API is available since Fedify 1.4.0.*

Activity transformers are a way to adjust activities before sending them to
the recipients.  It is useful for modifying the activity to fit the recipient's
ActivityPub implementation (which may have some quirks) or for adding some
additional information to the activity.

The activity transformers are applied before they are signed with the sender's
private key and sent to the recipients.

It can be configured by setting
the [`activityTransformers`](./federation.md#activitytransformers) option.
By default, the following activity transformers are enabled:

### `autoIdAssigner()`

This activity transformer automatically assigns a unique IRI to the activity
if the `id` property is not set.  It is useful for ensuring that
the activity has a unique IRI, which is required by the ActivityPub
specification.

The generated IRI is a URN UUID like:

~~~~
urn:uuid:12345678-1234-5678-1234-567812345678
~~~~

### `actorDehydrator()`

This activity transformer <q>dehydrates</q> the `actor` property of the activity
so that it only contains the actor's URI (rather than the full actor object
inlined).  It is useful for satisfying some ActivityPub implementations like
[Threads] that have quirks, which fail to parse the activity if the `actor`
property contains the full actor object inlined.

For example, the following activity:

~~~~ typescript{3-7} twoslash
import { Follow, Person } from "@fedify/vocab";
// ---cut-before---
new Follow({
  id: new URL("http://example.com/activities/1"),
  actor: new Person({
    id: new URL("http://example.com/actors/1"),
    name: "Alice",
    preferredUsername: "alice",
  }),
  object: new Person({
    id: new URL("http://example.com/actors/2"),
    name: "Bob",
    preferredUsername: "bob",
  }),
});
~~~~

is transformed into:

~~~~ typescript twoslash
import { Follow, Person } from "@fedify/vocab";
// ---cut-before---
new Follow({
  id: new URL("http://example.com/activities/1"),
  actor: new URL("http://example.com/actors/1"),  // [!code highlight]
  object: new Person({
    id: new URL("http://example.com/actors/2"),
    name: "Bob",
    preferredUsername: "bob",
  }),
});
~~~~

[Threads]: https://www.threads.net/

<!-- cSpell: ignore cavage -->
