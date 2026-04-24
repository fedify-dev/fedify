Custom collections example
==========================

This example is a small cookbook for custom ActivityPub collections in Fedify.
It uses a single-user bookmark log as the domain, but the important part is
how each collection dispatcher maps server-side data to an ActivityPub
collection.

The script demonstrates three patterns:

 -  `/users/alice/collections/public`: a public `OrderedCollection` with
    cursor-based pages, `setCounter()`, `setFirstCursor()`, and
    `setLastCursor()`.
 -  `/users/alice/collections/tags/{tag}`: a parameterized collection that
    filters public bookmarks using a URI template value.
 -  `/users/alice/collections/followers-only`: a collection whose result
    depends on the signed requester.  It calls `ctx.getSignedKeyOwner()` and
    returns an empty collection to unsigned or non-follower requests.

Run it from this directory:

~~~~ sh
deno task codegen  # At very first time only
deno run -A ./main.ts
~~~~

The output prints the actor document, collection metadata responses, and page
responses for the example routes.
