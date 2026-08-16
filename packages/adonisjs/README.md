<!-- deno-fmt-ignore-file -->

@fedify/adonisjs: Integrate Fedify with AdonisJS
================================================

[![npm][npm badge]][npm]
[![Matrix][Matrix badge]][Matrix]
[![@fedify@hackers.pub][@fedify@hackers.pub badge]][@fedify@hackers.pub]

*This package is available since Fedify 2.4.0.*

[Fedify] is a TypeScript library for building federated server applications
powered by [ActivityPub] and other standards, so-called [fediverse].  This
package integrates Fedify with [AdonisJS], a fully featured Node.js web
framework.

It gives an AdonisJS application everything Fedify needs and nothing it does
not: a server middleware that mounts the federation, a service provider that
owns the `Federation` object's lifecycle, a `config/fedify.ts` file, and a
`ctx.federation` context on every request.

[npm badge]: https://img.shields.io/npm/v/@fedify/adonisjs?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/adonisjs
[Matrix badge]: https://img.shields.io/matrix/fedify%3Amatrix.org
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[@fedify@hackers.pub badge]: https://fedi-badge.minhee.org/@fedify@hackers.pub/followers.svg
[@fedify@hackers.pub]: https://hackers.pub/@fedify
[Fedify]: https://fedify.dev/
[ActivityPub]: https://www.w3.org/TR/activitypub/
[fediverse]: https://en.wikipedia.org/wiki/Fediverse
[AdonisJS]: https://adonisjs.com/


Requirements
------------

 -  AdonisJS 7.0 or later
 -  Fedify 2.3.4 or later
 -  Node.js 24 or later — and Node.js only; see below

The package ships both ESM and CommonJS builds.  The CommonJS one works because
Node.js 24 supports `require()` of ESM dependencies — which is also why the
Node.js floor is not lower.

### Runtime support: Node.js only

> [!IMPORTANT]
> This package targets Node.js exclusively.  It is published to npm only, never
> to JSR, and it is neither tested nor supported on Deno or Bun.

That is a deliberate scope decision inherited from the framework rather than an
oversight, for three reasons.

**AdonisJS documents Node.js as its only runtime.**  Its installation guide
lists Node.js ≥ 24 and npm ≥ 11 as the sole prerequisites and never mentions
Deno or Bun, and its maintainers have
[declined to support multiple runtimes][adonisjs-runtimes].  An integration
package cannot credibly promise a runtime that the framework it integrates does
not.

**The Node.js 24 floor is AdonisJS's own.**  `@adonisjs/core` declares
`engines.node >= 24.0.0`; this package matches that floor rather than inventing
one.

**JSR cannot represent this package.**  The AdonisJS-native layer works by
augmenting AdonisJS's own module types — `ctx.federation` on `HttpContext`, and
the `fedify`, `fedify.builder` and `fedify.config` container bindings.  JSR's
[“slow types”][jsr-slow-types] rules reject ambient `declare module`
augmentation anywhere in a published module graph, and the augmentation cannot
be hidden from that graph without also hiding it from the applications that need
it.  So the feature and JSR publication are mutually exclusive, and the feature
is the entire point of the package.

Consequently this package ships no *deno.json*, defines no `test:bun` script,
and stays out of the Fedify monorepo's Deno workspace — the same position as
`@fedify/nestjs` and `@fedify/next`.

[adonisjs-runtimes]: https://github.com/orgs/adonisjs/discussions/4191
[jsr-slow-types]: https://jsr.io/docs/about-slow-types#global-augmentation


Installation
------------

~~~~ sh
node ace add @fedify/adonisjs
~~~~

That installs the package and runs its `configure` hook, which does the whole
wiring:

 -  installs `@fedify/fedify` and `@fedify/vocab`,
 -  adds `PUBLIC_URL` (and an optional `FEDERATION_HANDLE_HOST`) to
    *start/env.ts* and *.env*,
 -  writes *config/fedify.ts*, *start/federation.ts* and
    *app/federation/main.ts*,
 -  registers the service provider and the `start/federation.ts` preload file in
    *adonisrc.ts*, and
 -  adds the middleware to the **server** middleware stack in *start/kernel.ts*.

To install it without running the hook, use `npm install @fedify/adonisjs`
followed by `node ace configure @fedify/adonisjs`.


Usage
-----

### Registering dispatchers

Actor dispatchers, collection dispatchers and inbox listeners are registered on
the `FederationBuilder` exported by `@fedify/adonisjs/services/builder`:

~~~~ typescript
// app/federation/main.ts
import federation from '@fedify/adonisjs/services/builder'
import { Endpoints, Person } from '@fedify/vocab'
import Actor from '#models/actor'

federation
  .setActorDispatcher('/actors/{identifier}', async (ctx, identifier) => {
    const actor = await Actor.findBy('identifier', identifier)
    if (actor === null) return null

    const keys = await ctx.getActorKeyPairs(identifier)

    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: actor.name,
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
      publicKeys: keys.map((keyPair) => keyPair.cryptographicKey),
      assertionMethods: keys.map((keyPair) => keyPair.multikey),
    })
  })
  .setKeyPairsDispatcher(async (ctx, identifier) => {
    // Load or generate the actor's key pairs.
  })
~~~~

The module is loaded by the *start/federation.ts* preload file, which AdonisJS
imports after every service provider has booted — so dispatchers may use Lucid
models, the container, and anything else the application provides.  Import
further modules from that file as the federation grows.

Registration happens once per process.  Do not add *app/federation* to
`hotHook.boundaries`: re-importing a module on a hot reload would register the
same dispatcher twice, and Fedify rejects that.  Restart the dev server after
changing a dispatcher.

### Using the federation from controllers

The middleware attaches a Fedify `RequestContext` to every request:

~~~~ typescript
import type { HttpContext } from '@adonisjs/core/http'

export default class ActorsController {
  async show({ params, view, federation }: HttpContext) {
    const object = await federation.lookupObject(params.handle)

    return view.render('pages/actors/show', {
      actorUri: federation.getActorUri(params.identifier).href,
      object,
    })
  }
}
~~~~

The context is created lazily on first access, so requests that never touch it
pay nothing for it.

Outside an HTTP request — in an Ace command, a scheduled job or a queue worker —
resolve the `Federation` object from the container and create a context from
the canonical origin:

~~~~ typescript
import env from '#start/env'

const federation = await this.app.container.make('fedify')
const ctx = federation.createContext(new URL(env.get('PUBLIC_URL')), null)
await ctx.sendActivity({ identifier: 'me' }, recipient, activity)
~~~~

The binding resolves only once the application is ready; resolving it earlier —
from a preload file or a service provider — throws `E_FEDERATION_NOT_READY`
rather than handing back a federation with no routes.  Preload files should
register dispatchers on *@fedify/adonisjs/services/builder* instead.

### Without the container

`fedifyMiddleware` is the package's main integration function and its default
export.  It takes a `Federation` and an optional context-data factory, and has
nothing to do with the IoC container, so an application that would rather build
its own `Federation` can skip the provider entirely:

~~~~ typescript
// start/kernel.ts
import fedifyMiddleware from '@fedify/adonisjs'
import federation from '#federation/main'

server.use([async () => ({ default: fedifyMiddleware(federation) })])
~~~~

### Configuration

*config/fedify.ts* takes every [`FederationOptions`] Fedify accepts, plus a few
AdonisJS-specific keys:

~~~~ typescript
import { defineConfig } from '@fedify/adonisjs'
import { SqliteKvStore, SqliteMessageQueue } from '@fedify/sqlite'
import env from '#start/env'

export default defineConfig({
  origin: env.get('PUBLIC_URL'),
  kv: new SqliteKvStore(database),
  queue: new SqliteMessageQueue(database),
  queueContextData: () => null,
  ignoreRoutePrefixes: ['/@vite/'],
})
~~~~

| Option                | Purpose                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `origin`              | Required.  The canonical public origin.  Actor URIs and activity IDs are minted from it.                           |
| `kv`                  | Fedify's key–value store.  Defaults to an in-memory store, with a warning in production.                           |
| `contextDataFactory`  | Builds the per-request context data.  Defaults to the `HttpContext` itself.                                        |
| `ignoreRoutePrefixes` | URL path prefixes that skip Fedify entirely.  Defaults to none.                                                    |
| `logging`             | Whether to pipe Fedify's LogTape output into the AdonisJS logger.  Defaults to `true`.                             |
| `queueContextData`    | Who drains the queue: a callback (this process) or `false` (a separate worker).  Required whenever `queue` is set. |

[`FederationOptions`]: https://jsr.io/@fedify/fedify/doc/~/FederationOptions

### Module exports

| Specifier                           | What it is                                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `@fedify/adonisjs`                  | `fedifyMiddleware` (default), `defineConfig`, `configure`, `configureFedifyLogging`, the error classes and the types |
| `@fedify/adonisjs/types`            | The augmentation target for `FedifyTypes`                                                                            |
| `@fedify/adonisjs/provider`         | Referenced by specifier from *adonisrc.ts*                                                                           |
| `@fedify/adonisjs/middleware`       | Referenced by specifier from *start/kernel.ts*                                                                       |
| `@fedify/adonisjs/services/builder` | The `FederationBuilder`, as an AdonisJS service module                                                               |

Each subpath exists because AdonisJS reaches for it by module specifier or by
service-module convention; everything else lives on the root export.  The built
`Federation` deliberately has no service module of its own — resolve it with
`app.container.make('fedify')`, which can also tell you *why* when it is not
available yet.

### Context data

Fedify threads an application-defined value through every dispatcher and inbox
listener.  By default that value is `HttpContext | null` — `null` when Fedify is
working outside a request, such as inside a queue worker.  To carry something
else, augment the register interface and supply a factory:

~~~~ typescript
declare module '@fedify/adonisjs/types' {
  interface FedifyTypes {
    contextData: { user: User | null }
  }
}

export default defineConfig({
  origin: env.get('PUBLIC_URL'),
  contextDataFactory: async (ctx) => ({ user: await ctx.auth.user ?? null }),
})
~~~~


How requests are routed
-----------------------

The middleware runs in the **server** stack, before route matching and before
the body parser.  Both matter: Fedify serves paths the AdonisJS router knows
nothing about, and HTTP Signature verification needs the raw request body.  It
also runs before `@adonisjs/shield`, so inbox `POST`s are not rejected by CSRF
protection.

Every request reaches Fedify first, and one of three things happens.

 -  **Fedify serves it.**  Actor documents, collections, inboxes,
    */.well-known/webfinger* and */.well-known/nodeinfo* never reach the
    AdonisJS router.
 -  **Fedify has no route for the path.**  The request is handed to the AdonisJS
    router, and the application answers exactly as it would without this
    package.
 -  **Fedify has a route but cannot satisfy the `Accept` header.**  This is the
    interesting one.  Rather than answering `406` immediately, the middleware
    gives the AdonisJS router a chance first, and only answers
    `406 Not Acceptable` if the router had nothing either.

That last rule is what lets a single URL serve an HTML profile page to browsers
and an ActivityPub actor document to servers.  Register an ordinary route on the
same path as the actor dispatcher and it will handle the HTML half:

~~~~ typescript
// start/routes.ts — same path as setActorDispatcher('/actors/{identifier}', …)
router.get('/actors/:identifier', [controllers.Actors, 'show'])
~~~~


Deployment notes
----------------

 -  **Set `origin` to the public URL.**  Fedify mints actor URIs from it, so
    behind a reverse proxy, a load balancer or a tunnel it must be the address
    remote servers can reach, not the address Node listens on.  When developing
    with `fedify tunnel`, point `PUBLIC_URL` at the tunnel and restart.
 -  **Configure a persistent `kv` and a `queue`.**  Without a queue, delivery is
    synchronous and failed deliveries are never retried.  `@fedify/sqlite`,
    `@fedify/postgres`, `@fedify/redis` and `@fedify/mysql` all provide both.
    Setting `queue` also requires `queueContextData`, which says who drains it:
    a callback has the web process do it (started in the `ready` hook, stopped
    on shutdown, and never started in an Ace command or a test run), while
    `false` leaves the queue to a separate worker.
 -  **Configure `trustProxy`** in *config/app.ts* if AdonisJS needs to see the
    original protocol and host.

A complete, runnable application using all of this lives in the
[*examples/adonisjs*](../../examples/adonisjs) directory.
