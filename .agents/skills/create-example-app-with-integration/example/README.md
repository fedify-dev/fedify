<!-- deno-fmt-ignore-file -->

<!-- Replace `프레임워크` with the name of the framework you are integrating with -->

프레임워크 example application
==============================

A comprehensive example of building a federated server application using
[Fedify] with [프레임워크]. This example demonstrates how to create an
ActivityPub-compatible federated social media server that can interact with
other federated platforms like Mastodon, Pleroma, and other ActivityPub
implementations using the Fedify and [프레임워크].

[Fedify]: https://fedify.dev
[프레임워크]: https://프레임.워크/


Running the example
-------------------

<!--
  If the example does not support Deno, remove the `deno task dev`.
  If the example does not support Node.js, remove the `pnpm dev`.
-->

~~~~ sh
# For Deno
deno task dev

# For pnpm(Node.js)
pnpm dev
~~~~


Communicate with other federated servers
----------------------------------------

<!-- Replace 0000 with framework's default port -->

1.  Tunnel your local server to the internet using `fedify tunnel`

    ~~~~ sh
    fedify tunnel 0000 
    ~~~~

2.  Open the tunneled URL in your browser and check that the server is running
    properly.

3.  Search your handle and follow from other federated servers such as Mastodon
    or Misskey.

    > [!NOTE]
    > [ActivityPub Academy] is a great resource to learn how to interact
    > with other federated servers using ActivityPub protocol.

[ActivityPub Academy]: https://www.activitypub.academy/
