---
description: >-
  According to the official NodeInfo website, NodeInfo is an effort to create
  a standardized way of exposing metadata about a server running one of the
  distributed social networks.  This section explains how to expose a NodeInfo
  endpoint and the key properties of a NodeInfo object.
---

NodeInfo
========

*This API is available since Fedify 0.2.0.*

According to the official [NodeInfo] website:

> NodeInfo is an effort to create a standardized way of exposing metadata
> about a server running one of the distributed social networks.
> The two key goals are being able to get better insights into the user base of
> distributed social networking and the ability to build tools that allow
> users to choose the best-fitting software and server for their needs.

In fact, many ActivityPub servers, including Mastodon and Misskey, provide
NodeInfo endpoints.  Fedify provides a way to expose NodeInfo endpoints for
your server.

> [!NOTE]
> The version of NodeInfo that Fedify supports is 2.1.

[NodeInfo]: https://nodeinfo.diaspora.software/


Exposing NodeInfo endpoint
--------------------------

To expose a NodeInfo endpoint, you need to register a NodeInfo dispatcher with
`~Federatable.setNodeInfoDispatcher()` method.  The following shows how to
expose a NodeInfo endpoint:

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";

const federation = createFederation({
  // Omitted for brevity; see the related section for details.
});

federation.setNodeInfoDispatcher("/nodeinfo/2.1", async (ctx) => {
  return {
    software: {
      name: "your-software-name",  // Lowercase, digits, and hyphens only.
      version: { major: 1, minor: 0, patch: 0 },
      homepage: new URL("https://your-software.com/"),
    },
    protocols: ["activitypub"],
    usage: {
      // Usage statistics is hard-coded here for demonstration purposes.
      // You should replace these with real statistics:
      users: { total: 100, activeHalfyear: 50, activeMonth: 20 },
      localPosts: 1000,
      localComments: 2000,
    }
  }
});
~~~~

For details about the `NodeInfo` interface,
see the [next section](#nodeinfo-schema).

> [!TIP]
> You don't have to use */nodeinfo/2.1* as the path, but it is quite common
> among ActivityPub servers.

> [!NOTE]
> Whether or not you expose a NodeInfo endpoint, */.well-known/nodeinfo* is
> automatically handled by `Federation.fetch()` method.  In case you don't
> register a NodeInfo dispatcher, Fedify will respond with an empty `links`
> array, e.g.:
>
> ~~~~ json
> {
>   "links": []
> }
> ~~~~


NodeInfo schema
---------------

The `NodeInfo` interface is defined as follows:

`software.name`
:   *Required.*  The canonical name of the server software.  This must comply
    with pattern `/^[a-z0-9-]+$/`.

`software.version`
:   *Required.*  The version of the server software.

`software.repository`
:   The [`URL`] of the source code repository of the server software.

`software.homepage`
:   The [`URL`] of the homepage of the server software.

`protocols`
:   *Required and non-empty.*  The protocols supported on the server.  At least
    one protocol must be supported.   You usually put `["activitypub"]` here.

`services.inbound`
:   The third party sites the server can retrieve messages from for combined
    display with regular traffic.

`services.outbound`
:   The third party sites the server can publish messages to on the behalf of
    a user.

`openRegistrations`
:   Whether the server allows open self-registration.  Defaults to `false`.

`usage.users.total`
:   The total amount of on the server registered users.  This `number` has to
    be an integer greater than or equal to zero.

`usage.users.activeHalfyear`
:   The amount of users that signed in at least once in the last 180 days.
    This `number` has to be an integer greater than or equal to zero.

`usage.users.activeMonth`
:   The amount of users that signed in at least once in the last 30 days.
    This `number` has to be an integer greater than or equal to zero.

`usage.localPosts`
:   The amount of posts that were made by users that are registered on
    the server.  This `number` has to be an integer greater than or equal to
    zero.

`usage.localComments`
:   The amount of comments that were made by users that are registered on
    the server.  This `number` has to be an integer greater than or equal to
    zero.

[`URL`]: https://developer.mozilla.org/en-US/docs/Web/API/URL


NodeInfo client
---------------

*This API is available since Fedify 1.4.0.*

You may want to fetch NodeInfo objects from other servers.  Fedify provides
a way to fetch NodeInfo objects with the `Context.lookupNodeInfo()` method:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const nodeInfo = await ctx.lookupNodeInfo("https://example.com/");
if (nodeInfo != null) console.log(nodeInfo);
~~~~

The `Context.lookupNodeInfo()` method returns a `NodeInfo` object if the server
provides a NodeInfo endpoint and the response is valid.  Otherwise, it returns
`undefined`.

> [!TIP]
> Sometimes, a server may provide a slightly invalid NodeInfo object.  In such
> case, you can enforce parsing the object by passing `{ parse: "best-effort" }`
> option as the second argument to `Context.lookupNodeInfo()` method:
>
> ~~~~ typescript twoslash
> import { type Context } from "@fedify/fedify";
> const ctx = null as unknown as Context<void>;
> // ---cut-before---
> const nodeInfo = await ctx.lookupNodeInfo("https://example.com/", {
>   parse: "best-effort",
> });
>
> if (nodeInfo != null) console.log(nodeInfo);
> ~~~~
>
> However, it does not guarantee that parsing will always succeed.  It just
> tries to parse the object as much as possible.
