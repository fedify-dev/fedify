---
description: >-
  How to migrate an existing federated service to Fedify from another
  JavaScript ActivityPub library: activitypub-express, @activity-kit,
  hand-rolled Express code, and activitystrea.ms.
---

Migrating from other libraries
==============================

If you already run a federated service on another JavaScript ActivityPub
library, this guide helps you move it to Fedify without losing your existing
followers.  The hard part of any such migration is not rewriting the
handlers; it is preserving the bits of state that remote servers have cached
about you.  A migration survives silently only when three things stay stable
across the switch:

 -  The actor IRIs that remote servers already follow (e.g.
    `https://example.com/u/alice`).
 -  The public keys those remote servers have cached alongside each actor.
 -  The HTTP Signature format on outbound deliveries.  Fedify speaks both
    RFC 9421 HTTP Message Signatures and draft-cavage HTTP Signatures, and
    negotiates between them automatically through
    [double-knocking](./send.md#double-knocking-http-signatures), so a
    cutover does not disrupt remote servers that only know one revision.

Pick the section that matches your stack:

 -  [From `activitypub-express` (apex)](#apex),
    the Express middleware backed by MongoDB.
 -  [From `@activity-kit/*` (ActivityKit)](#activity-kit),
    the TypeScript-first, spec-oriented framework on the `@activity-kit`
    npm scope.
 -  [From hand-rolled Express code](#hand-rolled),
    custom Express apps that sign outbound requests with the `node:crypto`
    module, typically descended from Darius Kazemi's `express-activitypub`
    reference.
 -  [From `activitystrea.ms`](#activity-streams),
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

Fedify keeps the routes implicit: registering the actor dispatcher enables
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

// Register dispatchers and listeners on `federation`; see the sections below.

const app = express();
app.set("trust proxy", true);
app.use(integrateFederation(federation, () => undefined));
app.listen(8080);
~~~~

For production, replace `MemoryKvStore` with one of the database-backed
stores; see the [*Key–value store*](./kv.md) section for options.

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
`Context.sendActivity` call, with signature verification, key
dereferencing, and delivery scheduling all handled automatically:

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
shared inbox at that path, which apex never exposed.  Omit it if you
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

Fedify replaces both steps with one `Context.sendActivity` call; the queue
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
[*`"followers"`*](./send.md#followers)).

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
on the actor record (display name, summary, icon URL).  Everything else
(the `deliveryQueue` collection, `contexts` cache, and `streams` entries
other than followers) does not need to be migrated and should not be.

The safest cutover procedure is:

1.  Take the apex instance offline, or at least stop accepting new activities.
2.  Let the in-flight `deliveryQueue` drain naturally; apex retries
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
return it alongside the RSA pair from `setKeyPairsDispatcher`.  Ed25519 is
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
    [message queue](./mq.md); let apex finish its retries on the old
    instance and start Fedify with an empty queue.
 -  *Follower pagination.*  apex paginates followers via MongoDB `ObjectId`
    cursors; Fedify cursors are opaque strings you define.  Do not try to
    preserve the cursor format, because remote servers re-fetch the
    collection from the start when the cursor does not validate.
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

[ActivityKit] is a suite of npm packages under the `@activity-kit/*` scope
by Michael Puckett.  It is spec-oriented and TypeScript-first, and the
README advertises it as “aimed to be as versatile and non-opinionated as
possible.”  In practice, every package has been pinned at v0.4.57 or
v0.4.58 since 2023-11-01 with no further commits, which puts it in the
dormant bucket for production planning.

[ActivityKit]: https://github.com/michaelcpuckett/activity-kit

### When to migrate

 -  No commits in over two years; the README itself still says “this project
    is still incomplete.”
 -  There are no shipped example apps in the monorepo and no public
    production users, so community knowledge for debugging is thin.
 -  The `DbAdapter` interface assumes document-store semantics
    (`findOne(collection, match)`); changing the underlying database means
    implementing the whole 11-method interface against a new backend.
 -  The `AuthAdapter` bakes email/password user accounts into the
    federation layer.  If you want to reuse your existing auth system you
    fight the framework.
 -  HTTP signature verification lives inside the private `InboxPostEndpoint`
    class; there is no exported verification helper you can call from
    application code.
 -  Page HTML renderers (`pages.home`, `pages.login`, `pages.entity`) are
    part of the plugin config, so presentation and federation end up in the
    same module.

Fedify keeps federation and presentation separate, ships `signRequest`,
`verifyRequest`, and `verifyObject` as public functions, and lets you run
on Deno, Node.js, or Bun behind any of its framework integrations.

### Mental-model mapping

| ActivityKit                                                    | Fedify                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `activityKitPlugin({ adapters, plugins, pages })`              | `createFederation({ kv, queue })` plus the integration of your choice          |
| `adapters.db: DbAdapter` (document-store)                      | `KvStore` (key–value); keys and collections are your schema to own             |
| `adapters.crypto: CryptoAdapter`                               | built-in; keys returned from `setKeyPairsDispatcher`                           |
| `adapters.auth: AuthAdapter` (email/password baked in)         | out of scope; plug in your own auth layer                                      |
| `adapters.storage: StorageAdapter` (media uploads)             | out of scope; your existing upload route keeps working                         |
| `Plugin.handleInboxSideEffect(activity, recipient)`            | `setInboxListeners(...).on(Follow, ...)`, one handler per type                 |
| `Plugin.handleOutboxSideEffect(activity, actor)`               | `setOutboxListeners(...)` or `setOutboxDispatcher()` depending on purpose      |
| `Plugin.generateActorId(username)`                             | path parameter in `setActorDispatcher("/u/{identifier}", ...)`                 |
| Plain `AP.Person` object literal with `publicKey.publicKeyPem` | `new Person({ ... })` with `setKeyPairsDispatcher` returning `CryptoKey` pairs |
| `pages.home`, `pages.login`, `pages.entity`                    | your web framework's own routes                                                |

### Code migration

The four sections below cover the mandatory rewrites.  Auth, pages, and
media uploads are left out because they are no longer federation concerns
once you move to Fedify.

#### App bootstrap

ActivityKit drives the whole federation stack from one plugin registration
on the Express app.  The canonical example from the root README:

~~~~ javascript
import * as express from "express";
import { MongoClient } from "mongodb";
import { activityKitPlugin } from "@activity-kit/express-middleware";
import { MongoDbAdapter } from "@activity-kit/db-mongo";
import { TokenAuthAdapter } from "@activity-kit/auth-token";
import { NodeCryptoAdapter } from "@activity-kit/crypto-node";

const app = express.default();
const mongo = new MongoClient("mongodb://localhost:27017");
await mongo.connect();

app.use(activityKitPlugin({
  adapters: {
    auth: new TokenAuthAdapter(/* ... */),
    crypto: new NodeCryptoAdapter(),
    db: new MongoDbAdapter({ db: mongo.db("example") }),
    storage: /* ... */,
  },
  plugins: [/* Plugin instances */],
  routes: {},
  pages: {
    login: async () => "<html>login form</html>",
    home: async ({ actor }) => `<html>home for ${actor.preferredUsername}</html>`,
    entity: async ({ entity }) => `<html>${JSON.stringify(entity)}</html>`,
  },
}));
app.listen(8080);
~~~~

The Fedify equivalent keeps HTML rendering in your regular Express routes
and routes only federation through `integrateFederation`:

~~~~ typescript twoslash
// @noErrors: 2345
import express from "express";
import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { integrateFederation } from "@fedify/express";

const federation = createFederation<void>({
  kv: new MemoryKvStore(), // Swap for a production KvStore (PostgresKvStore, etc.).
});

// Dispatchers and inbox listeners are registered on `federation` below.

const app = express();
app.set("trust proxy", true);
app.use(integrateFederation(federation, () => undefined));
app.get("/u/:identifier", (req, res) => {
  // Serve the HTML profile here; Fedify falls through to your handler
  // when the client is not asking for ActivityPub content negotiation.
});
app.listen(8080);
~~~~

#### Actor records

ActivityKit's `createUserActor` builds a plain object with PEM public keys
embedded on the actor, and stores the private PEM separately via
`core.saveString("privateKey", uid, pem)`:

~~~~ javascript
const { publicKey, privateKey } = await this.core.generateKeyPair();

const userActor = {
  id: userId,
  type: "Person",
  preferredUsername: user.preferredUsername,
  name: user.name,
  inbox: inboxId,
  outbox: outboxId,
  followers: followersId,
  publicKey: {
    id: `${userId}#main-key`,
    owner: userId,
    publicKeyPem: publicKey,
  },
  published: new Date(),
};

await this.core.saveEntity(userActor);
await this.core.saveString("privateKey", uid, privateKey);
~~~~

Fedify never asks you to build the object literal directly; you return a
`Person` instance from the dispatcher and provide key pairs through
`setKeyPairsDispatcher`:

~~~~ typescript twoslash
// @noErrors: 2345
import type { Federation } from "@fedify/fedify";
import { importJwk } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
interface User {
  username: string;
  name: string;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}
async function getUserByUsername(_: string): Promise<User | null> {
  return null;
}
// ---cut-before---
federation
  .setActorDispatcher("/u/{identifier}", async (ctx, identifier) => {
    const user = await getUserByUsername(identifier);
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
  .setKeyPairsDispatcher(async (_ctx, identifier) => {
    const user = await getUserByUsername(identifier);
    if (user == null) return [];
    return [{
      privateKey: await importJwk(user.privateJwk, "private"),
      publicKey: await importJwk(user.publicJwk, "public"),
    }];
  });
~~~~

#### Inbox side-effects

ActivityKit users extend behaviour by writing a `Plugin` whose
`handleInboxSideEffect` fires for every incoming activity, with a
hand-written switch on `activity.type`:

~~~~ javascript
import { AP, ActivityTypes } from "@activity-kit/types";
import { isType, getId } from "@activity-kit/utilities";

export function FollowPlugin() {
  const plugin = {
    async handleInboxSideEffect(activity, recipient) {
      if (!isType(activity, ActivityTypes.FOLLOW)) return;
      const followerId = getId(activity.actor);
      if (followerId == null) return;
      // Hand-build the Accept, then publish it.
      const accept = {
        type: "Accept",
        actor: recipient.id,
        object: activity.id,
        to: [followerId.toString()],
      };
      await this.core.publishActivity(recipient, accept);
    },
  };
  return plugin;
}
~~~~

In Fedify the same logic is one `on(Follow, ...)` handler, with signature
verification, key dereferencing, and delivery scheduling handled for you:

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

The `on(Follow, …)` registration is closed over the activity type, so
there is no need to `isType(...)` on the way in and no need to hand-build
the Accept as a plain object; Fedify's vocab classes enforce the shape.

#### Outbound activities

ActivityKit exposes `core.publishActivity(actor, activity)` from inside a
plugin, and the delivery loop is driven by the middleware.  There is no
durable queue: if the Node process is restarted during fan-out, remaining
deliveries are lost.

~~~~ javascript
await this.core.publishActivity(recipient, {
  type: "Create",
  actor: recipient.id,
  object: note,
  to: [recipient.followers],
});
~~~~

Fedify routes every outbound send through
[`Context.sendActivity`](./send.md#sending-an-activity), which writes to
the `MessageQueue` first and only signs and delivers as the queue worker
drains.  Pointing the `queue` option at [`@fedify/postgres`],
[`@fedify/redis`], or [`@fedify/amqp`] gives you durable retries with
exponential backoff:

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

### Data migration

ActivityKit's MongoDB layout is thinner than apex's: actor documents live
in the `entity` collection and the private PEM is stored separately via
`saveString("privateKey", uid, pem)`.  The `uid` is the internal user
identifier assigned by `createUser`, and the `username` mapping sits in
`saveString("username", uid, preferredUsername)`.

A one-shot export script stitches those strings back onto each actor,
converts the PEM keys into JWKs that `importJwk` accepts, and writes the
result into whatever storage your Fedify app uses.  Adapt the destination
writes to your own schema:

~~~~ typescript twoslash
// @noErrors: 2307 2305 2345 2322 7006
import { createPrivateKey, createPublicKey } from "node:crypto";
import { MongoClient } from "mongodb";

interface ActivityKitActor {
  _id: string;
  type: "Person" | string;
  preferredUsername: string;
  name?: string;
  publicKey?: { publicKeyPem: string };
}

async function saveActor(_: {
  username: string;
  name?: string;
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

// ActivityKit stores `saveString("username", uid, username)` so we can
// walk the uid → username mapping.
const usernames = db.collection<{ _id: string; value: string }>(
  "username",
);
const privateKeys = db.collection<{ _id: string; value: string }>(
  "privateKey",
);
const actors = db.collection<ActivityKitActor>("entity");

for await (const mapping of usernames.find()) {
  const uid = mapping._id;
  const username = mapping.value;

  const actor = await actors.findOne({
    type: "Person",
    preferredUsername: username,
  });
  if (actor?.publicKey == null) continue;

  const priv = await privateKeys.findOne({ _id: uid });
  if (priv == null) continue;

  const privJwk = createPrivateKey({
    key: priv.value,
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
    rsaPrivateKey: privJwk,
    rsaPublicKey: pubJwk,
  });
}

// Followers are `Follow` entities in the same `entity` collection,
// linked from the actor's `followers` URL.
const follows = db.collection<{ type: string; actor: string; object: string }>(
  "entity",
).find({ type: "Follow" });
for await (const follow of follows) {
  // Map `follow.object` back to your local actor identifier via the
  // path scheme you chose.
  await saveFollower({
    username: follow.object.split("/").at(-1) ?? "",
    followerActorUri: follow.actor,
  });
}

await mongo.close();
~~~~

Because ActivityKit's actor IRIs include `preferredUsername`, you can keep
the same path pattern (`/u/{identifier}`) in `setActorDispatcher` and remote
followers stay resolved.

### Common pitfalls

 -  *Keys are PEM, not JWK, on disk.*  ActivityKit's `generateKeyPair`
    returns PEM strings and stores them as-is, whereas Fedify's
    `importJwk` only consumes JWK.  The conversion is lossless but must
    happen during the export (see the data-migration script above); do not
    try to pass a PEM straight into `importJwk` at runtime.
 -  *`AuthAdapter` has no Fedify equivalent.*  Email/password signup,
    token issuance, and session handling move into your own routes.
    The migration often means pulling out an external auth library
    (Passport, Auth.js, Lucia) rather than writing auth from scratch.
 -  *Page renderers disappear from federation config.*  `pages.home`,
    `pages.login`, and `pages.entity` become ordinary Express/Hono/Koa
    routes.  Fedify's integration middleware falls through to the next
    handler when a request is not an ActivityPub content-type, so your
    HTML routes serve the browser case without any changes.
 -  *No `declareUserActorStreams` equivalent.*  If you relied on the
    plugin hook to advertise custom `streams` on the actor document,
    populate the `streams` property directly in your
    `setActorDispatcher` return value.
 -  *Shared inbox was already exposed by ActivityKit.*  Unlike apex, the
    `/inbox` shared endpoint was live on ActivityKit servers; keep it
    on in Fedify by passing the second argument to `setInboxListeners`.

### Worked example

A minimal signup + follow-accept flow in Fedify, replacing the parts that
ActivityKit previously bundled into the middleware plus a plugin:

~~~~ typescript twoslash
// @noErrors: 2345 2322
import express from "express";
import {
  createFederation,
  exportJwk,
  generateCryptoKeyPair,
  importJwk,
  InProcessMessageQueue,
  MemoryKvStore,
} from "@fedify/fedify";
import { integrateFederation } from "@fedify/express";
import { Accept, Follow, Person } from "@fedify/vocab";

interface UserRecord {
  username: string;
  name: string;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}
const users = new Map<string, UserRecord>();

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
  .setKeyPairsDispatcher(async (_ctx, identifier) => {
    const user = users.get(identifier);
    if (user == null) return [];
    return [{
      privateKey: await importJwk(user.privateJwk, "private"),
      publicKey: await importJwk(user.publicJwk, "public"),
    }];
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
app.use(express.json());
app.use(integrateFederation(federation, () => undefined));

// Your own signup route; no AuthAdapter needed.
app.post("/signup", async (req, res) => {
  const { username, name } = req.body as { username: string; name: string };
  const pair = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
  users.set(username, {
    username,
    name,
    privateJwk: await exportJwk(pair.privateKey),
    publicJwk: await exportJwk(pair.publicKey),
  });
  res.status(201).end();
});

app.listen(8080);
~~~~

The same logic in ActivityKit would require writing an `AuthAdapter` (or
using `@activity-kit/auth-token`), a `FollowPlugin`, and a set of HTML
page renderers.  Fedify lets your existing web framework own everything
that is not federation.


From hand-rolled Express code {#hand-rolled}
--------------------------------------------

The de-facto starting point for hand-rolled Node.js ActivityPub bots is
Darius Kazemi's [`express-activitypub`] reference implementation, and most
small bots, blog-to-fediverse bridges, and single-actor services in the wild
are direct descendants; [`rss-to-activitypub`] is the best-known sibling.
Kazemi himself describes the repo as “meant as a reference implementation”
that is “not exactly hardened production code,” and that framing still
applies: the descendants inherit the same gaps around signature
verification, activity coverage, and delivery reliability.

[`express-activitypub`]: https://github.com/dariusk/express-activitypub
[`rss-to-activitypub`]: https://github.com/dariusk/rss-to-activitypub

### When to migrate

 -  *No inbound signature verification.*  Incoming `Follow` activities are
    trusted as-is; anyone can POST a forged `Follow` and add themselves as a
    follower.  Fedify verifies HTTP Signatures, HTTP Message Signatures,
    Linked Data Signatures, and Object Integrity Proofs automatically.
 -  *Only `Follow` is handled.*  `Undo(Follow)`, `Delete`, `Update(Actor)`,
    and `Block` are silently dropped, so remote actors that leave cannot
    actually leave.
 -  *No delivery queue.*  Outbound POSTs run serially inside the request
    handler; if the Node process crashes mid-fan-out, the remaining
    recipients never hear from you.  Fedify routes every send through a
    durable [message queue](./mq.md).
 -  *Deprecated `request` dependency.*  The hand-rolled snippet uses the
    `request` npm package, which has been deprecated since 2020.
 -  *No JSON-LD processing.*  Actors and activities are hand-built object
    literals; extensions (Mastodon's `featured`, `discoverable`,
    `manuallyApprovesFollowers`) require manual JSON surgery.

A typical hand-rolled bot compresses to roughly the same line count under
Fedify, and shedding the custom signing helper alone is usually worth the
move.

### Mental-model mapping

| Hand-rolled                                                  | Fedify                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `router.get("/:name", ...)` serving a JSON blob from SQLite  | `setActorDispatcher("/u/{identifier}", ...)` returning a `Person`         |
| `router.get("/", ...)` on `/.well-known/webfinger`           | automatic, enabled by `setActorDispatcher`                                |
| `router.post("/", ...)` on `/api/inbox` with no verification | `setInboxListeners(personalInbox, sharedInbox)`; verification is built in |
| `signAndSend()` helper with `crypto.createSign("sha256")`    | `Context.sendActivity(...)` with automatic HTTP Signatures                |
| `crypto.generateKeyPair("rsa", { modulusLength: 4096 })`     | `generateCryptoKeyPair("RSASSA-PKCS1-v1_5")` plus Ed25519 for [FEP-8b32]  |
| `better-sqlite3` `accounts` table                            | `@fedify/sqlite` `SqliteKvStore` + your own app schema                    |
| JSON `followers` column (array of actor IRIs)                | `setFollowersDispatcher("/u/{identifier}/followers", ...)`                |

[FEP-8b32]: https://w3id.org/fep/8b32

### Code migration

Below, each *before* snippet is trimmed from the Kazemi reference
(`dariusk/express-activitypub`, commit `41f98af3`).  Your own code is
probably shaped similarly.

#### Actor handler

The hand-rolled actor is stored as a pre-serialised JSON blob in SQLite and
served verbatim:

~~~~ javascript
router.get("/:name", function (req, res) {
  const name = req.params.name;
  const db = req.app.get("db");
  const domain = req.app.get("domain");
  const row = db
    .prepare("select actor from accounts where name = ?")
    .get(`${name}@${domain}`);
  if (row === undefined) return res.status(404).send(`No record found.`);
  const actor = JSON.parse(row.actor);
  res.set("Content-Type", "application/activity+json");
  res.json(actor);
});
~~~~

Fedify builds the actor on each request, which means the `publicKey` and
other fields can be regenerated without rewriting the DB blob:

~~~~ typescript twoslash
// @noErrors: 2345
import type { Federation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
interface Account {
  name: string;
  preferredUsername: string;
}
async function getAccount(_: string): Promise<Account | null> {
  return null;
}
// ---cut-before---
federation.setActorDispatcher("/u/{identifier}", async (ctx, identifier) => {
  const account = await getAccount(identifier);
  if (account == null) return null;
  const keys = await ctx.getActorKeyPairs(identifier);
  return new Person({
    id: ctx.getActorUri(identifier),
    preferredUsername: account.preferredUsername,
    name: account.name,
    inbox: ctx.getInboxUri(identifier),
    outbox: ctx.getOutboxUri(identifier),
    followers: ctx.getFollowersUri(identifier),
    publicKey: keys[0]?.cryptographicKey,
    assertionMethods: keys.map((k) => k.multikey),
  });
});
~~~~

#### WebFinger: drop the handler

Hand-rolled code stores a second blob and serves it from a custom route:

~~~~ javascript
router.get("/", function (req, res) {
  const resource = req.query.resource;
  if (!resource || !resource.includes("acct:")) {
    return res.status(400).send("Bad request.");
  }
  const name = resource.replace("acct:", "");
  const row = req.app.get("db")
    .prepare("select webfinger from accounts where name = ?")
    .get(name);
  if (row === undefined) return res.status(404).send("Not found.");
  res.json(JSON.parse(row.webfinger));
});
~~~~

In Fedify, registering an actor dispatcher enables WebFinger automatically.
The WebFinger route, `/.well-known/webfinger`, answers every
`acct:name@domain` handle your dispatcher can resolve.  There is no code to
write on the Fedify side; just delete the handler.

See the [*WebFinger*](./webfinger.md) section for details on customising the
mapping between handles and identifiers.

#### Inbox handler

The reference inbox handler trusts the incoming POST without verifying its
signature and covers only the `Follow` case:

~~~~ javascript
router.post("/", function (req, res) {
  const domain = req.app.get("domain");
  if (typeof req.body.object === "string" && req.body.type === "Follow") {
    const name = req.body.object.replace(`https://${domain}/u/`, "");
    sendAcceptMessage(req.body, name, domain, req, res, /* targetDomain */);
    // Append req.body.actor to the stored followers JSON.
  }
  // TODO: add "Undo" follow event
});
~~~~

Fedify verifies the signature automatically, dispatches per-activity-type
handlers, and auto-signs the Accept reply.  Handling `Undo(Follow)` is one
extra `.on(Undo, ...)` instead of a parallel hand-written branch:

~~~~ typescript twoslash
// @noErrors: 2345
import type { Federation } from "@fedify/fedify";
import { Accept, Follow, Undo } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
async function removeFollower(_: {
  identifier: string;
  followerUri: URL;
}): Promise<void> {}
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
  })
  .on(Undo, async (ctx, undo) => {
    const object = await undo.getObject(ctx);
    if (!(object instanceof Follow) || object.objectId == null) return;
    const parsed = ctx.parseUri(object.objectId);
    if (parsed?.type !== "actor" || undo.actorId == null) return;
    await removeFollower({
      identifier: parsed.identifier,
      followerUri: undo.actorId,
    });
  });
~~~~

#### Outbound signing

The hand-rolled signer builds the HTTP Signature header byte by byte:

~~~~ javascript
function signAndSend(message, name, domain, req, res, targetDomain) {
  const inbox = `${message.object.actor}/inbox`;
  const inboxFragment = inbox.replace(`https://${targetDomain}`, "");
  const privkey = req.app.get("db")
    .prepare("select privkey from accounts where name = ?")
    .get(`${name}@${domain}`).privkey;
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify(message)).digest("base64");
  const signer = crypto.createSign("sha256");
  const date = new Date().toUTCString();
  const stringToSign =
    `(request-target): post ${inboxFragment}\n` +
    `host: ${targetDomain}\n` +
    `date: ${date}\n` +
    `digest: SHA-256=${digest}`;
  signer.update(stringToSign);
  signer.end();
  const signature = signer.sign(privkey).toString("base64");
  const header = `keyId="https://${domain}/u/${name}",` +
    `headers="(request-target) host date digest",` +
    `signature="${signature}"`;
  request({
    url: inbox,
    method: "POST",
    headers: {
      Host: targetDomain,
      Date: date,
      Digest: `SHA-256=${digest}`,
      Signature: header,
    },
    json: true,
    body: message,
  }, function (err) {
    if (err) console.log("Error:", err);
  });
}
~~~~

In Fedify, sending an activity is one call; the signature, digest, and
content-type are all handled inside
[`Context.sendActivity`](./send.md#sending-an-activity):

~~~~ typescript twoslash
// @noErrors: 2345
import type { Context } from "@fedify/fedify";
import { Accept, Follow } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const identifier = "alice";
const follow = null as unknown as Follow;
const follower = null as unknown as import("@fedify/vocab").Actor;
// ---cut-before---
await ctx.sendActivity(
  { identifier },
  follower,
  new Accept({
    actor: ctx.getActorUri(identifier),
    object: follow,
  }),
);
~~~~

Fedify signs with the `#main-key` fragment of the actor IRI by default,
which matches what the hand-rolled actor already advertises in its
`publicKey.id` field.  The hand-rolled *signer* used the bare actor IRI as
the `keyId`, which remote implementations accepted only because they fetch
the actor document and re-resolve the key.  The Fedify default is the more
correct form and does not change behaviour for existing followers.

#### Account creation

The reference generates a 4096-bit RSA key pair with the async form of
`crypto.generateKeyPair` and stores both PEM halves in the `accounts` row:

~~~~ javascript
router.post("/create", function (req, res) {
  const account = req.body.account;
  const db = req.app.get("db");
  const domain = req.app.get("domain");
  crypto.generateKeyPair("rsa", {
    modulusLength: 4096,
    publicKeyEncoding:  { type: "spki",  format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  }, (err, publicKey, privateKey) => {
    const actorRecord = createActor(account, domain, publicKey);
    const webfingerRecord = createWebfinger(account, domain);
    const apikey = crypto.randomBytes(16).toString("hex");
    db.prepare(
      "insert into accounts" +
      "(name, actor, apikey, pubkey, privkey, webfinger)" +
      " values(?, ?, ?, ?, ?, ?)",
    ).run(
      `${account}@${domain}`,
      JSON.stringify(actorRecord),
      apikey,
      publicKey,
      privateKey,
      JSON.stringify(webfingerRecord),
    );
    res.status(200).json({ msg: "ok", apikey });
  });
});
~~~~

The Fedify equivalent generates RSA for HTTP Signatures plus Ed25519 for
Object Integrity Proofs, exports each pair as JWK, and stores them in your
application DB rather than inside the federation layer:

~~~~ typescript twoslash
// @noErrors: 2345
import {
  exportJwk,
  generateCryptoKeyPair,
} from "@fedify/fedify";
async function saveAccount(_: {
  username: string;
  rsa: { privateKey: JsonWebKey; publicKey: JsonWebKey };
  ed25519: { privateKey: JsonWebKey; publicKey: JsonWebKey };
}) {}
// ---cut-before---
const username = "alice";
const rsa = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
const ed25519 = await generateCryptoKeyPair("Ed25519");
await saveAccount({
  username,
  rsa: {
    privateKey: await exportJwk(rsa.privateKey),
    publicKey: await exportJwk(rsa.publicKey),
  },
  ed25519: {
    privateKey: await exportJwk(ed25519.privateKey),
    publicKey: await exportJwk(ed25519.publicKey),
  },
});
~~~~

The signup route does not live inside `federation` any more; it is just a
normal POST handler on your Express, Hono, or Koa app that writes to the
same DB the actor dispatcher reads from.

### Data migration

Because every hand-rolled schema is bespoke, this is a pattern rather than
a drop-in script.  Four things need to move:

1.  *Actor private keys.*  Read `accounts.privkey` (PEM), parse with
    `createPrivateKey`, export as JWK.
2.  *Actor public keys.*  Read `accounts.pubkey` (PEM) the same way.
3.  *Followers.*  Parse `accounts.followers` (a JSON array of actor IRIs).
4.  *Anything your bot remembers per follower* (last delivered message id,
    preferences).

Example, for `better-sqlite3` with the Kazemi schema (adapt table and
column names to your own):

~~~~ typescript twoslash
// @noErrors: 2307 2305 2345 2322 7006
import { createPrivateKey, createPublicKey } from "node:crypto";
import Database from "better-sqlite3";

interface Row {
  name: string;
  pubkey: string;
  privkey: string;
  followers: string | null;
}

async function saveAccount(_: {
  username: string;
  rsaPrivateKey: JsonWebKey;
  rsaPublicKey: JsonWebKey;
}) {}
async function saveFollower(_: {
  username: string;
  followerActorUri: string;
}) {}

const db = new Database("bot-node.db", { readonly: true });
const rows = db.prepare(
  "select name, pubkey, privkey, followers from accounts",
).all() as Row[];

for (const row of rows) {
  const [username] = row.name.split("@"); // name is `user@domain`
  const privJwk = createPrivateKey({ key: row.privkey, format: "pem" })
    .export({ format: "jwk" });
  const pubJwk = createPublicKey({ key: row.pubkey, format: "pem" })
    .export({ format: "jwk" });
  privJwk.alg = "RS256";
  pubJwk.alg = "RS256";

  await saveAccount({
    username,
    rsaPrivateKey: privJwk,
    rsaPublicKey: pubJwk,
  });

  const followers: string[] = row.followers ? JSON.parse(row.followers) : [];
  for (const followerActorUri of followers) {
    await saveFollower({ username, followerActorUri });
  }
}
~~~~

The critical preservation step is the *path scheme*.  If your actor is
served at `https://example.com/u/alice`, keep using
`setActorDispatcher("/u/{identifier}", ...)` so that the identical actor
IRI keeps resolving.  Remote servers who already have your RSA public key
cached will keep verifying your outbound activities without re-fetching.

Optionally, but recommended: generate an Ed25519 key pair for each account
while you are rewriting, and return it alongside the RSA pair from
`setKeyPairsDispatcher`.  This unlocks
[Object Integrity Proofs](./send.md#object-integrity-proofs) without breaking
compatibility with receivers that only understand RSA HTTP Signatures.

### Common pitfalls

 -  *Forged followers from the old inbox.*  Because the hand-rolled inbox
    never verified signatures, your existing followers list may contain
    rows added by someone else's `Follow`.  Before the cutover, cross-check
    each follower IRI by fetching the actor document and confirming it
    still exists.  Skip the rows that 404 or `410 Gone`.
 -  *`Content-Type` sloppiness.*  The reference sets
    `application/activity+json` on the actor GET but the hand-rolled
    outbound `request({ json: true })` sends `application/json`.  Mastodon
    is increasingly strict about this.  Fedify always sends the correct
    content type; no configuration is needed.
 -  *Single-inbox path (`/api/inbox`).*  The reference implementation uses
    one shared inbox for all accounts, which is technically a shared inbox
    without advertising itself as one.  Either keep `"/api/inbox"` as the
    second argument to `setInboxListeners` so existing deliveries land at
    the same URL, or advertise the new Fedify shared inbox
    (`endpoints.sharedInbox`) on the actor and accept some stragglers on
    the old path.
 -  *`keyId` fragment vs bare IRI.*  The hand-rolled signer uses a bare
    actor IRI as the `keyId`, while the actor document advertises
    `id: "<actor>#main-key"`.  Fedify signs with the fragment form, which
    matches what you are publishing (strictly an improvement), but any
    scripts you wrote that grep log lines for the bare IRI need to learn
    the new form.
 -  *`Undo(Follow)` coverage gap.*  Once you start verifying signatures,
    you will suddenly start seeing `Delete` and `Update(Actor)` activities
    that the old code dropped.  Handle at least `Undo(Follow)` and
    `Delete` before advertising the migration; remote servers retry
    undelivered `Delete` activities, and leaving them pending causes
    remote inboxes to back up.

### Worked example

The same Kazemi-style bot, rewritten in Fedify, replacing the custom
signing, WebFinger blob, and trust-all inbox with verified listeners and
automatic signing:

~~~~ typescript twoslash
// @noErrors: 2345
import express from "express";
import {
  createFederation,
  exportJwk,
  generateCryptoKeyPair,
  importJwk,
  InProcessMessageQueue,
  MemoryKvStore,
} from "@fedify/fedify";
import { integrateFederation } from "@fedify/express";
import { Accept, Follow, Person, Undo } from "@fedify/vocab";

interface Account {
  username: string;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  followers: Set<string>;
}
const accounts = new Map<string, Account>();

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});

federation
  .setActorDispatcher("/u/{identifier}", async (ctx, identifier) => {
    const account = accounts.get(identifier);
    if (account == null) return null;
    const keys = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      inbox: ctx.getInboxUri(identifier),
      outbox: ctx.getOutboxUri(identifier),
      followers: ctx.getFollowersUri(identifier),
      publicKey: keys[0]?.cryptographicKey,
      assertionMethods: keys.map((k) => k.multikey),
    });
  })
  .setKeyPairsDispatcher(async (_ctx, identifier) => {
    const account = accounts.get(identifier);
    if (account == null) return [];
    return [{
      privateKey: await importJwk(account.privateJwk, "private"),
      publicKey: await importJwk(account.publicJwk, "public"),
    }];
  });

federation
  .setInboxListeners("/u/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    const parsed = follow.objectId == null
      ? null
      : ctx.parseUri(follow.objectId);
    if (parsed?.type !== "actor") return;
    const account = accounts.get(parsed.identifier);
    if (account == null || follow.actorId == null) return;
    account.followers.add(follow.actorId.href);
    const follower = await follow.getActor(ctx);
    if (follower == null) return;
    await ctx.sendActivity(
      { identifier: parsed.identifier },
      follower,
      new Accept({ actor: follow.objectId!, object: follow }),
    );
  })
  .on(Undo, async (ctx, undo) => {
    const inner = await undo.getObject(ctx);
    if (!(inner instanceof Follow) || inner.objectId == null) return;
    const parsed = ctx.parseUri(inner.objectId);
    if (parsed?.type !== "actor" || undo.actorId == null) return;
    accounts.get(parsed.identifier)?.followers.delete(undo.actorId.href);
  });

const app = express();
app.set("trust proxy", true);
app.use(express.json());
app.use(integrateFederation(federation, () => undefined));

app.post("/create", async (req, res) => {
  const { account } = req.body as { account: string };
  const rsa = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
  accounts.set(account, {
    username: account,
    privateJwk: await exportJwk(rsa.privateKey),
    publicJwk: await exportJwk(rsa.publicKey),
    followers: new Set(),
  });
  res.status(201).json({ ok: true });
});

app.listen(8080);
~~~~

The reference code and this rewrite are close to the same size; the win
is that inbound signatures are verified, `Undo(Follow)` works, outbound
deliveries are queued and retried, and you are no longer maintaining an
in-tree copy of the HTTP Signatures spec.


From `activitystrea.ms` {#activity-streams}
-------------------------------------------

[`activitystrea.ms`] by James Snell and Evan Prodromou is the long-standing
JavaScript builder for ActivityStreams 2 JSON-LD documents.  Unlike the
other entries in this guide, this migration is pure code: the library does
nothing beyond constructing and parsing AS2 objects.  There is no
federation layer to swap out, no data to move, and no external state that
remote servers have cached about you.  If your code already runs its own
HTTP signing, inbox dispatch, or delivery loop around `activitystrea.ms`,
the rest of this guide (especially the [hand-rolled Express
section](#hand-rolled)) covers that part.

[`activitystrea.ms`]: https://www.npmjs.com/package/activitystrea.ms

### When to migrate

`activitystrea.ms` is *not* dormant.  Evan Prodromou revived it in 2024
under the Social Web Foundation and continues to publish releases.  The
reasons to migrate are not maintenance-driven:

 -  *Type safety.*  [`@fedify/vocab`] is TypeScript-first with generated
    classes, so every property has a type; `activitystrea.ms` is a fluent
    JavaScript builder with only hand-written typings.
 -  *Immutability.*  Fedify vocab objects cannot be mutated after
    construction, which matches how ActivityPub servers tend to think of
    activities (an activity is what it is once published).
 -  *Tooling alignment.*  If the rest of your codebase moves to Fedify,
    keeping two vocabulary libraries is friction; `@fedify/vocab` has
    feature parity for the common cases and can be used without importing
    any of the federation machinery.

If you are happy with `activitystrea.ms` and are not moving anything else
to Fedify, there is no urgent need to switch.  Think of this section as a
reference for when the rest of your stack is already Fedify.

[`@fedify/vocab`]: https://jsr.io/@fedify/vocab

### Mental-model mapping

| `activitystrea.ms`                                  | `@fedify/vocab`                                               |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `as.create()`, `as.note()`, `as.person()` factories | `new Create({...})`, `new Note({...})`, `new Person({...})`   |
| Fluent setters (`.actor(a).object(o)`)              | constructor options object: `{ actor, object }`               |
| `.publishedNow()`                                   | `published: Temporal.Now.instant()`                           |
| Mutable builder, `.get()` to freeze                 | immutable classes, `.clone({ ... })` to derive                |
| `await builder.prettyWrite()`, JSON string          | `JSON.stringify(await obj.toJsonLd(), null, 2)`               |
| `await builder.export()`, plain object              | `await obj.toJsonLd()`                                        |
| `as.import(json)`                                   | `await Create.fromJsonLd(json)` (static method on each class) |
| `as.langmap().set("en", "hi")`                      | `new LanguageString("hi", "en")` from `@fedify/vocab-runtime` |
| Strings for IRI fields                              | `URL` instances                                               |

### Code migration

#### Constructing a `Create(Note)` activity

With `activitystrea.ms`:

~~~~ javascript
const as = require("activitystrea.ms");

const doc = await as.create()
  .id("https://example.com/s/123")
  .actor("https://example.com/u/alice")
  .object(
    as.note()
      .id("https://example.com/o/456")
      .content("Hello, world!")
      .publishedNow(),
  )
  .prettyWrite();

console.log(doc);
~~~~

With `@fedify/vocab`:

~~~~ typescript twoslash
import { Temporal } from "@js-temporal/polyfill";
// ---cut-before---
import { Create, Note } from "@fedify/vocab";

const create = new Create({
  id: new URL("https://example.com/s/123"),
  actor: new URL("https://example.com/u/alice"),
  object: new Note({
    id: new URL("https://example.com/o/456"),
    content: "Hello, world!",
    published: Temporal.Now.instant(),
  }),
});

console.log(JSON.stringify(await create.toJsonLd(), null, 2));
~~~~

Two things change on the vocab side.  IRI fields take `URL` instances, not
strings; and timestamps use
[`Temporal.Instant`]
rather than `Date`, which preserves nanosecond precision and matches the
JSON-LD serialisation.

#### Serialising to JSON

`activitystrea.ms` has three terminators: `.write()` for a compact JSON
string, `.prettyWrite()` for pretty-printed JSON, and `.export()` for a
plain JavaScript object:

~~~~ javascript
const compact = await builder.write();
const pretty = await builder.prettyWrite();
const plainObject = await builder.export();
~~~~

`@fedify/vocab` returns the plain object from
[`toJsonLd()`](./vocab.md#json-ld) and leaves JSON stringification to you:

~~~~ typescript twoslash
import { Create } from "@fedify/vocab";
const create = new Create({});
// ---cut-before---
const plainObject = await create.toJsonLd();
const compact = JSON.stringify(plainObject);
const pretty = JSON.stringify(plainObject, null, 2);
~~~~

`toJsonLd()` takes options for compaction, the JSON-LD context, and
serialisation mode; see the [*Vocabulary*](./vocab.md#json-ld) section for
the full list.

#### Parsing an incoming document

`activitystrea.ms` parses with `as.import(jsonld)`:

~~~~ javascript
const as = require("activitystrea.ms");

const imported = await as.import({
  "@context": "https://www.w3.org/ns/activitystreams",
  type: "Create",
  actor: "https://example.com/u/alice",
  object: { type: "Note", content: "Hello, world!" },
});
console.log(imported.type); // "Create"
console.log(imported.actor.id); // "https://example.com/u/alice"
~~~~

`@fedify/vocab` exposes a static `fromJsonLd()` on each class.  Using the
most specific class you expect gives you the strongest typings, and falling
back to a parent class still works:

~~~~ typescript twoslash
import { Activity, Create } from "@fedify/vocab";

const specific = await Create.fromJsonLd({
  "@context": "https://www.w3.org/ns/activitystreams",
  type: "Create",
  actor: "https://example.com/u/alice",
  object: { type: "Note", content: "Hello, world!" },
});
console.log(specific.actorId?.href); // "https://example.com/u/alice"

// If you do not know the exact subtype, parse as a parent:
const any = await Activity.fromJsonLd({
  "@context": "https://www.w3.org/ns/activitystreams",
  type: "Follow",
  actor: "https://example.com/u/alice",
});
if (any instanceof Create) {
  // Narrowed at runtime.
}
~~~~

#### Language maps and multi-language strings

`activitystrea.ms` uses a dedicated `langmap` helper:

~~~~ javascript
const as = require("activitystrea.ms");

const doc = await as.note()
  .content(
    as.langmap()
      .set("en", "Hello, world!")
      .set("ko", "안녕, 세상!"),
  )
  .prettyWrite();
~~~~

`@fedify/vocab` keeps the intent but flattens the API: pass a
[`LanguageString`](./vocab.md#scalar-types) (or several) to
properties that accept multilingual content:

~~~~ typescript twoslash
import { Note } from "@fedify/vocab";
import { LanguageString } from "@fedify/vocab-runtime";

const note = new Note({
  contents: [
    new LanguageString("Hello, world!", "en"),
    new LanguageString("안녕, 세상!", "ko"),
  ],
});
~~~~

[`Temporal.Instant`]: https://tc39.es/proposal-temporal/docs/instant.html

### Common pitfalls

 -  *IRI fields want `URL` instances.*  `activitystrea.ms` accepts bare
    strings for every IRI property.  `@fedify/vocab` constructors take
    `URL` objects, and passing a string is a compile-time type error.
    Wrap with `new URL(...)` at the boundary and you are done.
 -  *Immutability breaks fluent mutation.*  Code that was built around
    `builder.name(x).name(y)` (overriding the previous value) does not
    translate directly.  Construct with the right value the first time, or
    use `obj.clone({ name: y })` to derive a modified copy.
 -  *No streams parser equivalent.*  `activitystrea.ms` can consume JSON
    from a Node `Readable` via `new as.Stream()`.  `@fedify/vocab` only
    parses complete JSON objects; decode the stream into a `Buffer` or
    parsed JSON first, then call `fromJsonLd`.
 -  *Timestamps are `Temporal.Instant`, not `Date`.*  If your application
    stores timestamps as `Date`, convert with
    `Temporal.Instant.fromEpochMilliseconds(date.getTime())` on the way
    in and `new Date(instant.epochMilliseconds)` on the way out.

### Worked example

A small function that wraps a plain Note into a Create activity,
serialises it for an outbound HTTP request body, and accepts an incoming
AS2 document for processing.  Drop-in replacement for the idiomatic
`activitystrea.ms` usage in most JSON-LD bridges:

~~~~ typescript twoslash
import { Temporal } from "@js-temporal/polyfill";
// ---cut-before---
import { Activity, Create, Note } from "@fedify/vocab";

async function buildOutbound(
  actorIri: string,
  noteIri: string,
  content: string,
): Promise<string> {
  const create = new Create({
    id: new URL(`${noteIri}#create`),
    actor: new URL(actorIri),
    object: new Note({
      id: new URL(noteIri),
      attribution: new URL(actorIri),
      content,
      published: Temporal.Now.instant(),
    }),
  });
  return JSON.stringify(await create.toJsonLd());
}

async function parseIncoming(body: unknown): Promise<void> {
  const activity = await Activity.fromJsonLd(body);
  if (activity instanceof Create) {
    // The static class match narrows `activity.object` to AS2 object types.
    console.log(`Create from ${activity.actorId?.href}`);
  }
}
~~~~

Because `@fedify/vocab` ships independently of the rest of Fedify, you can
adopt it as a drop-in replacement for `activitystrea.ms` without pulling
in the federation layer.  If you later decide to replace your
hand-written signing and delivery with Fedify proper, the vocab objects
you have already built pass straight into
[`Context.sendActivity`](./send.md#sending-an-activity).
