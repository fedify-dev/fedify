<!-- deno-fmt-ignore-file -->

Fedify–SolidStart integration example
=====================================

This example shows how to integrate [Fedify] with [SolidStart] using
`@fedify/solidstart`.

[Fedify]: https://fedify.dev/
[SolidStart]: https://docs.solidjs.com/solid-start


Running the example
-------------------

From the repository root (pnpm workspace):

~~~~ sh
pnpm --filter solidstart-example dev
~~~~

The app listens on <http://localhost:3000/>.


Actor URL
---------

Open a demo actor profile at:

~~~~
http://localhost:3000/users/<identifier>
~~~~

For example, <http://localhost:3000/users/demo>. You can also fetch the
ActivityPub representation:

~~~~ sh
curl -H "Accept: application/activity+json" \
  http://localhost:3000/users/demo
~~~~
