---
description: >-
  Fedify provides a way to register outbox listeners so that you can handle
  client-to-server `POST` requests to actor outboxes.  This section explains
  how to register an outbox listener and how to federate posted activities.
---

Outbox listeners
================

Fedify can route `POST` requests to an actor's outbox through typed listeners.
This is useful when you want to accept ActivityPub client-to-server activities
from your own clients without exposing a separate non-standard API.

This guide covers `POST /outbox`.  To serve `GET /outbox`, use the
[*Collections*][collections-outbox] guide.

[collections-outbox]: ./collections.md#outbox


Registering an outbox listener
------------------------------

With Fedify, you can register outbox listeners per activity type, just like
inbox listeners.  The following shows how to register a listener for `Create`
activities:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Activity, Create, Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
const myKnownRecipients: Person[] = [];
async function verifyAccessToken(
  authorization: string | null,
): Promise<{ identifier: string } | null> {
  authorization;
  return null;
}
async function savePostedActivity(
  identifier: string,
  activity: Activity,
): Promise<void> {
  identifier;
  activity;
}
// ---cut-before---
federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Create, async (ctx, activity) => {
    await savePostedActivity(ctx.identifier, activity);
    await ctx.sendActivity(
      { identifier: ctx.identifier },
      myKnownRecipients,
      activity,
    );
  })
  .authorize(async (ctx, identifier) => {
    const session = await verifyAccessToken(
      ctx.request.headers.get("authorization"),
    );
    return session?.identifier === identifier;
  });
~~~~

The `~Federatable.setOutboxListeners()` method registers the outbox path, and
the `~OutboxListenerSetters.on()` method registers a listener for a specific
activity type.  The `~OutboxListenerSetters.authorize()` hook runs before the
listener and can reject unauthorized requests with `401 Unauthorized`.

Fedify also rejects a posted activity if its `actor` does not match the local
actor who owns the addressed outbox.

> [!TIP]
> If you need to handle every activity type, register a listener for the
> `Activity` class.  Unsupported activity types can also be left unhandled,
> in which case Fedify responds with `202 Accepted` without dispatching a
> listener.

> [!NOTE]
> The URI Template syntax supports different expansion types like
> `{identifier}` (simple expansion) and `{+identifier}` (reserved expansion).
> If your identifiers contain URIs or special characters, you may need to use
> `{+identifier}` to avoid double-encoding issues.  See the
> [*URI Template* guide][uri-template-guide] for details.

[uri-template-guide]: ./uri-template.md


Looking at `OutboxContext.identifier`
-------------------------------------

The `~OutboxContext.identifier` property contains the identifier from the
matched outbox route.  Fedify does not infer anything more specific than that.

~~~~ typescript twoslash
import { type OutboxListenerSetters } from "@fedify/fedify";
import { Create } from "@fedify/vocab";
(0 as unknown as OutboxListenerSetters<void>)
// ---cut-before---
.on(Create, async (ctx, activity) => {
  console.log(ctx.identifier);
  console.log(activity.id?.href);
});
~~~~


Federating posted activities
----------------------------

Fedify does not federate client-posted activities automatically.  If you want
to deliver a posted activity, call `~Context.sendActivity()` or
`~OutboxContext.forwardActivity()` explicitly inside your outbox listener.

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Create, Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
const recipients: Person[] = [];
// ---cut-before---
federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Create, async (ctx, activity) => {
    await ctx.sendActivity(
      { identifier: ctx.identifier },
      recipients,
      activity,
    );
  });
~~~~

If the client already signed the posted JSON-LD with Linked Data Signatures or
Object Integrity Proofs and you want to preserve that payload verbatim, use
`~OutboxContext.forwardActivity()` instead of round-tripping through Fedify's
vocabulary objects:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Activity, Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
const recipients: Person[] = [];
// ---cut-before---
federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx) => {
    await ctx.forwardActivity(
      { identifier: ctx.identifier },
      recipients,
      { skipIfUnsigned: true },
    );
  });
~~~~

If a listener returns without calling one of these delivery methods, Fedify
logs a runtime warning.  The `@fedify/lint` package also provides a lint rule
for the same mistake; see [*Linting*][linting-guide] for details.

> [!TIP]
> Explicit delivery keeps outbox listeners symmetric with inbox listeners:
> Fedify never guesses the recipient list for you, so applications can reuse
> their own caches and delivery policies.

[linting-guide]: ./lint.md


Handling errors
---------------

You can attach an error handler to outbox listeners.  It receives the outbox
context along with the thrown error:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Activity } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async () => {
    throw new Error("Something went wrong.");
  })
  .onError(async (ctx, error) => {
    console.error(ctx.identifier, error);
  });
~~~~


Current scope
-------------

Outbox listeners currently provide the routing and authorization surface for
client-to-server posting, but the rest of the server-side behavior remains
application-defined.

In particular, Fedify does not currently do the following for you:

 -  Persist the posted activity in your outbox collection
 -  Generate IDs or `Location` headers for newly posted activities
 -  Wrap non-`Activity` objects in `Create` automatically
 -  Federate anything unless your listener calls `ctx.sendActivity()` or
    `ctx.forwardActivity()`

If you need full `GET /outbox` support as well, combine this guide with the
[*Collections*][collections-outbox] guide.
