---
description: >-
  WebFinger is a protocol that allows for the discovery of information
  about people and other entities on the Internet using just their identifier.
  This section explains how to implement WebFinger endpoints and use the
  WebFinger client in Fedify.
---

WebFinger
=========

According to the [WebFinger website]:

 > WebFinger is used to discover information about people or other entities 
 > on the Internet that are identified by a URI using standard 
 > Hypertext Transfer Protocol (HTTP) methods over a secure transport.
 > A WebFinger resource returns a JavaScript Object Notation (JSON) object
 > describing the entity that is queried. The JSON object is referred to as
 > the JSON Resource Descriptor (JRD).

WebFinger is essential for ActivityPub federation as it allows servers to
discover actor profiles and endpoints using familiar identifiers like
`@user@example.com`. Many ActivityPub servers, including Mastodon and Misskey,
rely on WebFinger for account discovery.

> [!NOTE]
> Fedify implements WebFinger according to [RFC 7033] specification.

[WebFinger website]: https://webfinger.net/
[RFC 7033]: https://datatracker.ietf.org/doc/html/rfc7033

WebFinger schema
----------------

The WebFinger response follows the JSON Resource Descriptor (JRD) format
as defined in [RFC 7033]. The main interfaces are:

### `ResourceDescriptor`

The main WebFinger response object:

`subject`
:   A URI that identifies the entity that this descriptor describes.
    This is typically set automatically by Fedify.

`aliases`
:   URIs that identify the same entity as the `subject`.

`properties`
:   Additional key-value properties about the `subject`.

`links`
:   An array of [`Link`] objects pointing to related resources.

### `Link`

Represents a link to a related resource:

`rel`
:   *Required.* The link's relation type, which is either a URI or a
    registered relation type (see [RFC 5988]).

`type`
:   The media type of the target resource (see [RFC 6838]).

`href`
:   A URI pointing to the target resource.

`titles`
:   Human-readable titles describing the link relation. If the language is
    unknown or unspecified, the key is `"und"`.

`properties`
:   Additional key-value properties about the link relation.

`template`
:   *Since Fedify 1.9.0.* A URI Template ([RFC 6570]) that can be used to
    construct URIs by substituting variables. Used primarily for subscription
    endpoints where parameters like account URIs need to be dynamically inserted.

### Common link relations

Fedify automatically includes these standard link relations for ActivityPub actors:

`"self"`
:   Points to the actor's ActivityPub profile. Uses `application/activity+json`
    as the media type.

`"http://webfinger.net/rel/profile-page"`
:   Points to the actor's human-readable profile page. Uses `text/html` as the
    media type.

`"http://webfinger.net/rel/avatar"`
:   Points to the actor's avatar image.

You can add additional custom links through the WebFinger links dispatcher:

`"http://ostatus.org/schema/1.0/subscribe"`
:   OStatus subscription endpoint for remote follows. Uses a URI template
    with `{uri}` parameter for the account being followed.

Example WebFinger response (including both automatic and custom links):

~~~~ json
{
  "subject": "acct:alice@your-domain.com",
  "links": [
    {
      "rel": "self",
      "type": "application/activity+json", 
      "href": "https://your-domain.com/users/alice"
    },
    {
      "rel": "http://webfinger.net/rel/profile-page",
      "type": "text/html",
      "href": "https://your-domain.com/@alice"
    },
    {
      "rel": "http://ostatus.org/schema/1.0/subscribe",
      "template": "https://your-domain.com/authorize_interaction?uri={uri}"
    }
  ]
}
~~~~

[`Link`]: https://jsr.io/@fedify/fedify/doc/webfinger/~/Link
[RFC 5988]: https://datatracker.ietf.org/doc/html/rfc5988
[RFC 6838]: https://datatracker.ietf.org/doc/html/rfc6838
[RFC 6570]: https://datatracker.ietf.org/doc/html/rfc6570

Customizing WebFinger endpoint
------------------------------

*This API is available since Fedify 1.9.0.*

The WebFinger endpoint is automatically exposed at `/.well-known/webfinger` 
by the `Federation.fetch()` method. You can register an additional WebFinger 
links dispatcher with `~Federatable.setWebFingerLinksDispatcher()` method.
The following shows how to customize a WebFinger endpoint:

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";

const federation = createFederation({
  // Omitted for brevity; see the related section for details.
});

federation.setWebFingerLinksDispatcher(async (ctx, resource) => {
    return [
      {
        rel: "http://ostatus.org/schema/1.0/subscribe",
        template: `https://your-domain.com/@${resource.pathname}/authorize_interaction?uri={uri}`
      }
    ];
  }
);
~~~~

This gives results like below:

~~~~json
{
  "subject": "acct:alice@your-domain.com",
  "links": [
    {
      "rel": "self",
      "type": "application/activity+json", 
      "href": "https://your-domain.com/users/alice"
    },
    {
      "rel": "http://webfinger.net/rel/profile-page",
      "type": "text/html",
      "href": "https://your-domain.com/@alice"
    },
    {
      "rel": "http://ostatus.org/schema/1.0/subscribe",
      "template": "https://your-domain.com/@alice@your-domain.com/authorize_interaction?uri={uri}"
    }
  ]
}
~~~~


The WebFinger links dispatcher receives two parameters:

`ctx`
:   The federation context

`resource`
:   The URL queried via WebFinger

> [!TIP]
> The WebFinger endpoint is automatically exposed at `/.well-known/webfinger`
> by the `Federation.fetch()` method. You don't need to manually handle this
> route.

> [!NOTE]
> WebFinger responses can also be customized through 
> `~Federatable.setActorDispatcher()` without using 
> `~Federatable.setWebFingerLinksDispatcher()`. When an actor is configured,
> Fedify automatically includes standard ActivityPub links in the WebFinger 
> response. See the [WebFinger links section](./actor.md#webfinger-links) 
> in the Actor manual for details.

WebFinger lookups
-----------------

*This API is available since Fedify 1.6.0.*

The `Context` provides a dedicated method for WebFinger lookups when you need
to find information about accounts and resources across federated networks.
The `~Context.lookupWebFinger()` method allows you to query a remote server's
WebFinger endpoint directly:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const webfingerData = await ctx.lookupWebFinger("acct:fedify@hollo.social");
~~~~

If the lookup fails or the account doesn't exist, the method returns `null`.
The returned WebFinger document contains links to various resources associated
with the account, such as profile pages, ActivityPub actor URIs, and more:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const webfingerData = await ctx.lookupWebFinger("acct:fedify@hollo.social");

// Find the ActivityPub actor URI
const activityPubActorLink = webfingerData?.links?.find(link =>
  link.rel === "self" && link.type === "application/activity+json"
);

if (activityPubActorLink?.href) {
  const actor = await ctx.lookupObject(activityPubActorLink.href);
  // Work with the actor...
}
~~~~

> [!NOTE]
> In most cases, you can use the higher-level `~Context.lookupObject()` method
> which automatically performs WebFinger lookups when given a handle.
> Use `~Context.lookupWebFinger()` when you need the raw WebFinger data or
> want more direct control over the lookup process.
