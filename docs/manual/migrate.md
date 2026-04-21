---
description: >-
  How to migrate an existing federated service to Fedify from another
  JavaScript ActivityPub library — activitypub-express, @activity-kit,
  hand-rolled Express code, and activitystrea.ms.
---

Migrating from other libraries
==============================

If you already run a federated service on another JavaScript ActivityPub
library, this guide helps you move it to Fedify without losing your existing
followers.  The hard part of any such migration is not rewriting the
handlers — it is preserving the bits of state that remote servers have cached
about you.  A migration survives silently only when three things stay stable
across the switch:

 -  The actor IRIs that remote servers already follow (e.g.
    `https://example.com/u/alice`).
 -  The public keys those remote servers have cached alongside each actor.
 -  The HTTP Signature format on outbound deliveries (Fedify defaults to
    draft-cavage for backward compatibility, which matches every library in
    this guide).

Pick the section that matches your stack:

 -  [From `activitypub-express` (apex)](#apex) —
    the Express middleware backed by MongoDB.
 -  [From `@activity-kit/*` (ActivityKit)](#activity-kit) —
    the TypeScript-first, spec-oriented framework on the `@activity-kit`
    npm scope.
 -  [From hand-rolled Express code](#hand-rolled) —
    custom Express apps that sign outbound requests with the `node:crypto`
    module, typically descended from Darius Kazemi's `express-activitypub`
    reference.
 -  [From `activitystrea.ms`](#activity-streams) —
    a vocabulary-only migration where federation is handled elsewhere.

Each section follows the same shape: *When to migrate*, *Mental-model
mapping*, *Code migration*, *Data migration*, *Common pitfalls*, and a small
worked example.  Read the one that matches and skip the rest.


From `activitypub-express` (apex) {#apex}
-----------------------------------------

[`activitypub-express`] (apex) is Express middleware backed by MongoDB and is
the most common non-Fedify stack in the Node.js fediverse today, powering
[Immers Space] and [Guppe Groups] among others.

[`activitypub-express`]: https://github.com/immers-space/activitypub-express
[Immers Space]: https://github.com/immers-space/immers
[Guppe Groups]: https://a.gup.pe/

### When to migrate

Some concrete reasons to switch:

 -  apex pins a patched fork of the [`http-signature`] npm package.  The fork
    does not install under Bun, and pulling it in under Deno requires special
    handling.  If you want to run on anything other than Node.js, this alone
    is enough.
 -  The server never exposes its own `sharedInbox` endpoint; it only delivers
    to remote shared inboxes.  As the fediverse consolidates on shared
    inboxes for large-fanout activities, serving one yourself becomes a
    scaling requirement.
 -  JSON-LD validation rejects some legitimate Akkoma/LitePub and Mastodon
    posts (bare `Note` announces, Litepub vocabulary), so parts of the
    fediverse silently stop delivering to you.
 -  Delivery runs in-process via `setTimeout` with no worker model.  Graceful
    shutdown can drop in-flight activities; there is no way to scale delivery
    horizontally.
 -  Core dependencies (`request`, `request-promise-native`, the MongoDB v4
    driver) are long-deprecated.

Fedify addresses all five: it runs on Deno, Node.js, and Bun; exposes a shared
inbox by default when you opt in; speaks draft-cavage HTTP Signatures,
RFC 9421 HTTP Message Signatures, Linked Data Signatures, and Object Integrity
Proofs; and ships durable queue backends via [`@fedify/postgres`],
[`@fedify/redis`], and [`@fedify/amqp`].

[`http-signature`]: https://www.npmjs.com/package/http-signature
[`@fedify/postgres`]: https://jsr.io/@fedify/postgres
[`@fedify/redis`]: https://jsr.io/@fedify/redis
[`@fedify/amqp`]: https://jsr.io/@fedify/amqp

### Mental-model mapping

| apex                                                                 | Fedify                                                                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ActivitypubExpress({ routes, store, endpoints })`                   | `createFederation({ kv, queue })` plus the `FederationBuilder`                               |
| Mounting routes with `app.route(routes.inbox).post(...)`             | `setInboxListeners("/u/{identifier}/inbox", "/inbox")`                                       |
| `apex.createActor(username, name, summary, icon)`                    | `setActorDispatcher("/u/{identifier}", (ctx, id) => new Person({ ... }))`                    |
| `actor._meta.privateKey` (PEM, stored on the actor object)           | `setKeyPairsDispatcher((ctx, id) => [{ privateKey, publicKey }])` returning `CryptoKey`s     |
| `app.on("apex-inbox", ({ activity, actor, recipient }))`             | `setInboxListeners(...).on(Follow, async (ctx, follow) => { ... })`, one handler per type    |
| `apex.buildActivity(...)` + `apex.addToOutbox(actor, act)`           | `ctx.sendActivity({ identifier }, recipient, activity)`                                      |
| `apex.store` (Mongo) with `deliveryQueue` collection                 | `KvStore` plus `MessageQueue` (see [*Key–value store*](./kv.md), [*Message queue*](./mq.md)) |
| Followers as activity rows in `streams` tagged by `_meta.collection` | `setFollowersDispatcher("/u/{identifier}/followers", ...)` over your own schema              |

### Code migration

The five sections below cover every apex handler a typical deployment has
wired up.  All *before* snippets are straight from the apex README; all
*after* snippets are type-checked.

#### App bootstrap

apex wires every route explicitly on the Express app and stores state in
MongoDB:

~~~~ javascript
const express = require("express");
const { MongoClient } = require("mongodb");
const ActivitypubExpress = require("activitypub-express");

const app = express();
const routes = {
  actor: "/u/:actor",
  object: "/o/:id",
  activity: "/s/:id",
  inbox: "/u/:actor/inbox",
  outbox: "/u/:actor/outbox",
  followers: "/u/:actor/followers",
  following: "/u/:actor/following",
  liked: "/u/:actor/liked",
  collections: "/u/:actor/c/:id",
  blocked: "/u/:actor/blocked",
  rejections: "/u/:actor/rejections",
  rejected: "/u/:actor/rejected",
  shares: "/s/:id/shares",
  likes: "/s/:id/likes",
};
const apex = ActivitypubExpress({
  name: "Example",
  version: "1.0.0",
  domain: "example.com",
  actorParam: "actor",
  objectParam: "id",
  activityParam: "id",
  routes,
});

const mongo = new MongoClient("mongodb://localhost:27017");
app.use(express.json({ type: apex.consts.jsonldTypes }), apex);
app.route(routes.inbox).post(apex.net.inbox.post);
app.route(routes.outbox).post(apex.net.outbox.post);
app.get(routes.actor, apex.net.actor.get);
app.get(routes.followers, apex.net.followers.get);
app.get("/.well-known/webfinger", apex.net.webfinger.get);

await mongo.connect();
apex.store.db = mongo.db("example");
await apex.store.setup();
app.listen(8080);
~~~~

Fedify keeps the routes implicit — registering the actor dispatcher enables
WebFinger, and registering inbox listeners wires both the personal and shared
inbox:

~~~~ typescript twoslash
// @noErrors: 2345
import express from "express";
import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { integrateFederation } from "@fedify/express";

const federation = createFederation<void>({
  kv: new MemoryKvStore(), // Swap for PostgresKvStore in production.
});

// Register dispatchers and listeners on `federation` — see the sections below.

const app = express();
app.set("trust proxy", true);
app.use(integrateFederation(federation, () => undefined));
app.listen(8080);
~~~~

For production, replace `MemoryKvStore` with one of the database-backed
stores — see the [*Key–value store*](./kv.md) section for options.

#### Actor dispatcher

apex creates actors imperatively and stores them in Mongo:

~~~~ javascript
const actor = await apex.createActor(
  "alice",
  "Alice",
  "An example actor.",
  { type: "Image", url: "https://example.com/alice.png" },
);
await apex.store.saveObject(actor);
~~~~

Fedify reverses the direction: you register one dispatcher that answers an
HTTP request for any actor by looking the record up in your own database:

~~~~ typescript twoslash
// @noErrors: 2345
import type { Federation } from "@fedify/fedify";
import { Image, Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
interface User {
  username: string;
  name: string;
  summary: string;
  iconUrl: string;
}
async function getUserByUsername(_: string): Promise<User | null> {
  return null;
}
// ---cut-before---
federation.setActorDispatcher("/u/{identifier}", async (ctx, identifier) => {
  const user = await getUserByUsername(identifier);
  if (user == null) return null;
  const keys = await ctx.getActorKeyPairs(identifier);
  return new Person({
    id: ctx.getActorUri(identifier),
    preferredUsername: user.username,
    name: user.name,
    summary: user.summary,
    icon: new Image({ url: new URL(user.iconUrl) }),
    inbox: ctx.getInboxUri(identifier),
    outbox: ctx.getOutboxUri(identifier),
    followers: ctx.getFollowersUri(identifier),
    publicKey: keys[0]?.cryptographicKey,
    assertionMethods: keys.map((k) => k.multikey),
  });
});
~~~~

Keeping the path pattern at `/u/{identifier}` ensures existing remote
followers keep resolving the same URIs after the migration.

#### Key-pair continuity

apex generates an RSA key pair inside `createActor` and stores the PEM-encoded
private key at `actor._meta.privateKey`.  Fedify decouples the key pairs from
the actor record and asks you for them through `setKeyPairsDispatcher`:

~~~~ typescript twoslash
// @noErrors: 2345
import type { Federation } from "@fedify/fedify";
import { importJwk } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
async function getJwksByUsername(
  _: string,
): Promise<{ rsa: { privateKey: JsonWebKey; publicKey: JsonWebKey } }> {
  return { rsa: { privateKey: {}, publicKey: {} } };
}
// ---cut-before---
federation
  .setActorDispatcher("/u/{identifier}", async (ctx, identifier) => {
    // Omitted for brevity; see the previous example.
    return null;
  })
  .setKeyPairsDispatcher(async (ctx, identifier) => {
    const jwks = await getJwksByUsername(identifier);
    if (jwks == null) return [];
    return [{
      privateKey: await importJwk(jwks.rsa.privateKey, "private"),
      publicKey: await importJwk(jwks.rsa.publicKey, "public"),
    }];
  });
~~~~

The accompanying data-migration script (see [*Data migration*](#data-migration))
converts apex's PEM private keys into the JWK format this dispatcher expects
in a single pass.

#### Inbox handler

apex centralises every incoming activity into one event.  A typical
Follow/Accept handler looks like this:

~~~~ javascript
app.on("apex-inbox", async ({ actor, activity, recipient }) => {
  if (activity.type === "Follow") {
    const accept = await apex.buildActivity("Accept", recipient.id, actor.id, {
      object: activity,
    });
    await apex.addToOutbox(recipient, accept);
  }
});
~~~~

Fedify splits one handler per activity type and turns the Accept into a
`Context.sendActivity` call — signature verification, key dereferencing, and
delivery scheduling happen automatically:

~~~~ typescript twoslash
// @noErrors: 2345
import type { Federation } from "@fedify/fedify";
import { Accept, Follow } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation
  .setInboxListeners("/u/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    if (follow.objectId == null) return;
    const parsed = ctx.parseUri(follow.objectId);
    if (parsed?.type !== "actor") return;
    const follower = await follow.getActor(ctx);
    if (follower == null) return;
    await ctx.sendActivity(
      { identifier: parsed.identifier },
      follower,
      new Accept({ actor: follow.objectId, object: follow }),
    );
  });
~~~~

The second argument to `setInboxListeners` (`"/inbox"`) also registers a
shared inbox at that path — something apex never exposed.  Omit it if you
want to preserve the old behaviour exactly; re-enable it later when you are
ready to advertise `endpoints.sharedInbox` on your actor documents.

#### Sending activities

apex stores activities and publishes them in one call:

~~~~ javascript
const note = await apex.buildObject("Note", actor.id, [actor.followers[0]], {
  content: "Hello, fediverse!",
});
const create = await apex.buildActivity(
  "Create",
  actor.id,
  [actor.followers[0]],
  { object: note },
);
await apex.addToOutbox(actor, create);
~~~~

Fedify replaces both steps with one `Context.sendActivity` call — the queue
takes care of persistence, signing, retries, and fan-out:

~~~~ typescript twoslash
// @noErrors: 2345
import type { Context } from "@fedify/fedify";
import { Create, Note } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const identifier = "alice";
// ---cut-before---
const note = new Note({
  id: new URL(`https://example.com/o/${crypto.randomUUID()}`),
  attribution: ctx.getActorUri(identifier),
  content: "Hello, fediverse!",
  to: ctx.getFollowersUri(identifier),
});
await ctx.sendActivity(
  { identifier },
  "followers",
  new Create({
    id: new URL(`https://example.com/s/${crypto.randomUUID()}`),
    actor: ctx.getActorUri(identifier),
    object: note,
    to: ctx.getFollowersUri(identifier),
  }),
  { preferSharedInbox: true },
);
~~~~

The recipient form `"followers"` asks Fedify to dereference the actor's
followers collection (see
[*Sending to followers*](./send.md#sending-to-followers)).

#### Followers collection

apex exposes the followers collection automatically by registering
`app.get(routes.followers, apex.net.followers.get)`, and the data is stored
as `Follow` activity rows in Mongo's `streams` collection tagged by
`_meta.collection`.  Fedify makes you own the query:

~~~~ typescript twoslash
// @noErrors: 2345
import type { Federation } from "@fedify/fedify";
import type { Recipient } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
async function getFollowers(
  _id: string,
): Promise<{ uri: string; inboxUri: string }[]> {
  return [];
}
// ---cut-before---
federation.setFollowersDispatcher(
  "/u/{identifier}/followers",
  async (ctx, identifier, cursor) => {
    const followers = await getFollowers(identifier);
    const items: Recipient[] = followers.map((f) => ({
      id: new URL(f.uri),
      inboxId: new URL(f.inboxUri),
    }));
    return { items };
  },
);
~~~~

For production traffic you will usually want pagination, covered in the
[*Collections*](./collections.md) section.

### Data migration

Three things need to move from Mongo to whatever storage your Fedify app
uses: actor key pairs, followers, and anything else your application stored
on the actor record (display name, summary, icon URL).  Everything else —
the `deliveryQueue` collection, `contexts` cache, `streams` entries other
than followers — does not need to be migrated and should not be.

The safest cutover procedure is:

1.  Take the apex instance offline, or at least stop accepting new activities.
2.  Let the in-flight `deliveryQueue` drain naturally — apex retries
    deliveries on exponential backoff for up to about five months, so what
    matters is that you do not switch Fedify on over the same hostname while
    apex is still actively signing outbound requests, or remote servers will
    see two actors publishing from the same IRI with different HTTP
    Signatures.
3.  Run the export script below against the stopped Mongo database.
4.  Start Fedify pointed at the new storage.

The script converts each local actor's PEM private key to a JWK that
`importJwk` can consume, and writes the followers list out in whatever shape
your `setFollowersDispatcher` query expects.  Adapt the destination writes
to your application's tables:

~~~~ typescript twoslash
// @noErrors: 2307 2305 2345 2322 7006
import { createPrivateKey, createPublicKey } from "node:crypto";
import { MongoClient } from "mongodb";

interface ApexActor {
  id: string;
  preferredUsername: string;
  name?: string;
  summary?: string;
  icon?: { type: string; url: string } | undefined;
  followers: string[];
  _meta: { privateKey: string }; // PEM, pkcs8
  publicKey: { id: string; owner: string; publicKeyPem: string };
}

interface ApexFollow {
  actor: string;
  object: string;
  type: "Follow";
  _meta: { collection: string };
}

// Replace these with real writes against your Fedify-side storage:
async function saveActor(_: {
  username: string;
  name?: string;
  summary?: string;
  iconUrl?: string;
  rsaPrivateKey: JsonWebKey;
  rsaPublicKey: JsonWebKey;
}) {}
async function saveFollower(_: {
  username: string;
  followerActorUri: string;
}) {}

const mongo = new MongoClient("mongodb://localhost:27017");
await mongo.connect();
const db = mongo.db("example");

const actors = db.collection<ApexActor>("objects").find({
  type: "Person",
  "_meta.privateKey": { $exists: true },
});

for await (const actor of actors) {
  const username = actor.preferredUsername;

  // apex stores the PEM private key; convert to JWK + add the `alg` hint
  // that `importJwk` expects.
  const privJwk = createPrivateKey({
    key: actor._meta.privateKey,
    format: "pem",
  }).export({ format: "jwk" });
  const pubJwk = createPublicKey({
    key: actor.publicKey.publicKeyPem,
    format: "pem",
  }).export({ format: "jwk" });
  privJwk.alg = "RS256";
  pubJwk.alg = "RS256";

  await saveActor({
    username,
    name: actor.name,
    summary: actor.summary,
    iconUrl: actor.icon?.url,
    rsaPrivateKey: privJwk,
    rsaPublicKey: pubJwk,
  });

  const follows = db.collection<ApexFollow>("streams").find({
    type: "Follow",
    "_meta.collection": actor.followers[0],
  });
  for await (const follow of follows) {
    await saveFollower({ username, followerActorUri: follow.actor });
  }
}

await mongo.close();
~~~~

Existing remote followers then keep working unchanged: apex's default route
`/u/:actor` lines up with the Fedify dispatcher path `/u/{identifier}`, the
actor IRI is identical, and the RSA public key matches what those remote
servers already have cached.

For long-term resilience, generate a second Ed25519 key pair per actor and
return it alongside the RSA pair from `setKeyPairsDispatcher` — Ed25519 is
required for [Object Integrity Proofs](./send.md#object-integrity-proofs).

### Common pitfalls

 -  *keyId encoding.*  apex sometimes signs outbound requests with a bare
    actor IRI as the `keyId`, whereas Fedify uses the fragment form
    `<actor>#main-key`.  Remote implementations accept both because they
    re-fetch the key document on cache miss, but any application code you
    wrote that compared `keyId` strings by equality needs to be relaxed.
 -  *Shared inbox exposure.*  The second argument to `setInboxListeners`
    enables a shared inbox on your server.  apex never had one; if you are
    migrating cautiously, leave the second argument off for the first
    deploy and add it once you are happy with the rest of the rewrite.
 -  *Delivery-queue port.*  The `deliveryQueue` collection is tightly coupled
    to apex's in-process publisher.  Do not port it to Fedify's
    [message queue](./mq.md) — let apex finish its retries on the old
    instance and start Fedify with an empty queue.
 -  *Follower pagination.*  apex paginates followers via MongoDB `ObjectId`
    cursors; Fedify cursors are opaque strings you define.  Do not try to
    preserve the cursor format — remote servers re-fetch the collection
    from the start when the cursor does not validate.
 -  *`Content-Type` defaults.*  apex distinguishes `application/activity+json`
    and the JSON-LD form via `apex.consts.jsonldTypes`; Fedify sets the
    appropriate `Content-Type` automatically on every outbound request.  Any
    reverse-proxy rule you wrote to force the ActivityPub media type can be
    removed.

### Worked example

A minimal apex-style Follow/Accept bot in Fedify fits in about 60 lines,
including the HTTP signing and inbox verification that apex also provides:

~~~~ typescript twoslash
// @noErrors: 2345
import express from "express";
import {
  createFederation,
  InProcessMessageQueue,
  MemoryKvStore,
} from "@fedify/fedify";
import { integrateFederation } from "@fedify/express";
import { Accept, Follow, Person } from "@fedify/vocab";

interface User {
  username: string;
  name: string;
}
const users = new Map<string, User>([
  ["alice", { username: "alice", name: "Alice" }],
]);

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});

federation
  .setActorDispatcher("/u/{identifier}", async (ctx, identifier) => {
    const user = users.get(identifier);
    if (user == null) return null;
    const keys = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: user.username,
      name: user.name,
      inbox: ctx.getInboxUri(identifier),
      outbox: ctx.getOutboxUri(identifier),
      followers: ctx.getFollowersUri(identifier),
      publicKey: keys[0]?.cryptographicKey,
      assertionMethods: keys.map((k) => k.multikey),
    });
  })
  .setKeyPairsDispatcher(async (_ctx, _id) => {
    // Load previously generated JWKs from your database; see the
    // data-migration section for a conversion script.
    return [];
  });

federation
  .setInboxListeners("/u/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    const parsed = follow.objectId == null
      ? null
      : ctx.parseUri(follow.objectId);
    if (parsed?.type !== "actor") return;
    const follower = await follow.getActor(ctx);
    if (follower == null) return;
    await ctx.sendActivity(
      { identifier: parsed.identifier },
      follower,
      new Accept({ actor: follow.objectId!, object: follow }),
    );
  });

const app = express();
app.set("trust proxy", true);
app.use(integrateFederation(federation, () => undefined));
app.listen(8080);
~~~~

The equivalent apex bot is linked from the [apex README].  Dropping the
custom store, the forked `http-signature`, and the event-emitter plumbing is
what the migration buys you.

[apex README]: https://github.com/immers-space/activitypub-express#usage


From `@activity-kit/*` (ActivityKit) {#activity-kit}
----------------------------------------------------

*To be written.*


From hand-rolled Express code {#hand-rolled}
--------------------------------------------

*To be written.*


From `activitystrea.ms` {#activity-streams}
-------------------------------------------

*To be written.*
