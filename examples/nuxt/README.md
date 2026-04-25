<!-- deno-fmt-ignore-file -->

Fedify-Nuxt integration example application
===========================================

A comprehensive example of building a federated server application using
[Fedify] with [Nuxt].  This example demonstrates how to create an
ActivityPub-compatible federated social media server that can interact with
other federated platforms like [Mastodon], [Misskey], and other ActivityPub
implementations using [Fedify] and [Nuxt].

[Fedify]: https://fedify.dev
[Nuxt]: https://nuxt.com/
[Mastodon]: https://mastodon.social/
[Misskey]: https://misskey.io/


Running the example
-------------------

~~~~ sh
pnpm dev
~~~~


Communicate with other federated servers
----------------------------------------

1.  Tunnel your local server to the internet using `fedify tunnel`

    ~~~~ sh
    fedify tunnel 3000
    ~~~~

2.  Open the tunneled URL in your browser and check that the server is running
    properly.

3.  Search your handle and follow from other federated servers such as
    [Mastodon] or [Misskey].

    > [!NOTE]
    > [ActivityPub Academy] is a great resource to learn how to interact
    > with other federated servers using ActivityPub protocol.

[ActivityPub Academy]: https://www.activitypub.academy/
