Fedify–AdonisJS integration example
===================================

This is a simple example of how to integrate Fedify into an [AdonisJS]
application. It publishes one actor, accepts follows, and serves an HTML profile
page at the very same URL that remote servers read the ActivityPub actor
document from.

[AdonisJS]: https://adonisjs.com/


How it works
------------

The example wires up Fedify the way the [`@fedify/adonisjs`] package is meant to
be used:

 -  The service provider, `@fedify/adonisjs/fedify_provider`, is registered in
    *adonisrc.ts*.  It builds the `Federation` and constructs the middleware
    from it and the configuration.
 -  The Fedify server middleware, `@fedify/adonisjs/fedify_middleware`, is
    first in the `server` stack in *start/kernel.ts*—where
    `node ace configure` puts it—so it runs before route matching, before the
    body parser, and before anything that could rewrite the `Accept` header it
    negotiates on.
 -  *config/fedify.ts* sets the canonical origin with `defineConfig()`.
 -  Dispatchers are registered on the builder exported by
    `@fedify/adonisjs/services/builder`, from the *start/federation.ts* preload
    file.
 -  `ctx.federation` is available in controllers and routes.

One thing here deviates from what `node ace configure @fedify/adonisjs`
scaffolds: *start/env.ts* declares `PUBLIC_URL` as optional rather than
required, so that the example runs with no configuration at all.
*config/fedify.ts* then falls back to the address the server actually bound.
A real deployment sets `PUBLIC_URL` and can require it, as the scaffold does.

[`@fedify/adonisjs`]: ../../packages/adonisjs/


Running the example
-------------------

1.  Copy *.env.example* to *.env*:

    ~~~~ sh
    cp .env.example .env
    ~~~~

2.  Install dependencies and start the server:

    ~~~~ sh
    pnpm install
    pnpm start
    ~~~~

    The application listens on <http://localhost:3333> and the actor is `demo`.

    > [!NOTE]
    > `node ace serve` falls back to a free random port when 3333 is already
    > taken, and it prints the address it settled on.  Use that port in the
    > commands below; with `PUBLIC_URL` unset the actor URIs follow it
    > automatically.

3.  Open <http://localhost:3333/>. Browsers asking for HTML at
    <http://localhost:3333/users/demo> get the profile page:

    ~~~~ sh
    curl -H 'Accept: text/html' http://localhost:3333/users/demo
    ~~~~

    Servers asking for ActivityPub get the actor document instead:

    ~~~~ sh
    curl -H 'Accept: application/activity+json' \
      http://localhost:3333/users/demo | jq
    ~~~~

    The [Fedify CLI] can look the actor up the same way, and `-a` signs the
    request the way a remote server would:

    ~~~~ sh
    pnpx @fedify/cli lookup http://localhost:3333/users/demo -a
    ~~~~

4.  Localhost is not reachable from other servers, so to actually exchange
    activities you need a public address. The [Fedify CLI] provides one:

    ~~~~ sh
    pnpx @fedify/cli tunnel 3333
    ~~~~

    Put the tunnel URL into *.env* as `PUBLIC_URL`, restart `pnpm start`, and
    search for `@demo@<the-tunnel-host>` from any Mastodon-compatible server.

[Fedify CLI]: https://fedify.dev/cli
