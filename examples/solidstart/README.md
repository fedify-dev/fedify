<!-- deno-fmt-ignore-file -->

Fedify–SolidStart integration example application
=================================================

An example of building a federated server application using [Fedify] with
[SolidStart].  It serves a single demo actor over ActivityPub, so it can be
looked up and followed from other federated platforms such as [Mastodon] or
[Misskey].

Federation is wired up in *src/lib/federation.ts* and mounted through
`fedifyMiddleware()` in *src/middleware/index.ts*.  Keys and follower
relationships are kept in memory, so they are discarded whenever the server
restarts.

[Fedify]: https://fedify.dev
[SolidStart]: https://start.solidjs.com/
[Mastodon]: https://mastodon.social/
[Misskey]: https://misskey.io/


Running the example
-------------------

~~~~ sh
pnpm install
pnpm dev
~~~~

The server listens on <http://localhost:3000/>, which redirects to the demo
actor's profile page.


Looking up the actor
--------------------

The example exposes one actor, `demo`, at
<http://localhost:3000/users/demo>:

~~~~ sh
curl -H "Accept: application/activity+json" http://localhost:3000/users/demo
~~~~

WebFinger and NodeInfo are served too:

~~~~ sh
curl "http://localhost:3000/.well-known/webfinger?resource=acct:demo@localhost:3000"
curl http://localhost:3000/nodeinfo/2.1
~~~~


Communicate with other federated servers
----------------------------------------

1.  Tunnel your local server to the internet using `fedify tunnel`:

    ~~~~ sh
    fedify tunnel 3000
    ~~~~

2.  Open the tunneled URL in your browser and check that the server is running
    properly.

3.  Search for `@demo@<your tunneled host>` from another federated server and
    follow it.  The example answers a `Follow` with an `Accept` and records the
    follower, so the follower count on the profile page goes up.

    > [!NOTE]
    > [ActivityPub Academy] is a great resource to learn how to interact with
    > other federated servers using the ActivityPub protocol.

[ActivityPub Academy]: https://www.activitypub.academy/
