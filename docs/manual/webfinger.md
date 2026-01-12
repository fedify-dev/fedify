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

WebFinger is essential for ActivityPub federation. It lets servers discover
actor profiles using familiar identifiers like `@user@example.com`.
Most ActivityPub implementations, including Mastodon and Misskey, depend on
WebFinger for account discovery.

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
:   *Since Fedify 1.9.0.* A URI Template ([RFC 6570]) with placeholders
    for variable substitution. Commonly used for remote follow endpoints
    where `{uri}` is replaced with the account to follow.

### Common link relations

Fedify automatically generates these link relations from actor properties:

`"self"`
:   The actor's ActivityPub profile URI. Uses `application/activity+json`
    as the media type.

`"http://webfinger.net/rel/profile-page"`
:   The actor's profile page from the `url` property. Uses `text/html` as
    the media type.

`"http://webfinger.net/rel/avatar"`
:   The actor's avatar from the `icon` property.

Additional custom links can be added via WebFinger links dispatcher:

`"http://ostatus.org/schema/1.0/subscribe"`
:   Remote follow endpoint (common in Mastodon). Uses a URI template
    with `{uri}` placeholder for the account being followed.

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

While Fedify automatically handles WebFinger responses for actors registered
via `~Federatable.setActorDispatcher()`, you can add custom links using
`~Federatable.setWebFingerLinksDispatcher()`. This is useful for adding
non-standard links like Mastodon's remote follow endpoint:

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
> Before the introduction of `~Federatable.setWebFingerLinksDispatcher()` in
> Fedify 1.9.0, WebFinger responses could only be customized through
> `~Federatable.setActorDispatcher()` by setting the actor's `url` property.
> This method still works and is sufficient for many use cases, though it
> doesn't support the `template` field needed for features like Mastodon's
> remote follow functionality.
>
> See the [WebFinger links section](./actor.md#webfinger-links) in the Actor
> documentation for details on customizing WebFinger through actor properties.


Looking up WebFinger
--------------------

*This API is available since Fedify 1.6.0.*

Use `~Context.lookupWebFinger()` to query remote WebFinger endpoints:

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


Using WebFinger client
----------------------

The `@fedify/webfinger` package provides a standalone WebFinger client that can
be used independently of the main Fedify framework.  This is useful when you
only need WebFinger lookup functionality without the full ActivityPub
federation capabilities.


### Installation

The `@fedify/webfinger` package is available on [JSR] and [npm].  You can
install it using the following command:

[JSR]: https://jsr.io/@fedify/webfinger
[npm]: https://www.npmjs.com/package/@fedify/webfinger

::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/webfinger
~~~~

~~~~ bash [npm]
npm add @fedify/webfinger
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/webfinger
~~~~

~~~~ bash [Yarn]
yarn add @fedify/webfinger
~~~~

~~~~ bash [Bun]
bun add @fedify/webfinger
~~~~

:::


### Looking up a WebFinger resource

You can look up a WebFinger resource using the `lookupWebFinger()` function:

~~~~ typescript twoslash
import { lookupWebFinger } from "@fedify/webfinger";

// Look up by acct: URI
const result = await lookupWebFinger("acct:alice@example.com");

// Look up by URL
const result2 = await lookupWebFinger("https://example.com/users/alice");
~~~~


### Working with the result

The result is a `ResourceDescriptor` object containing the subject, aliases,
properties, and links:

~~~~ typescript twoslash
import { lookupWebFinger } from "@fedify/webfinger";

const result = await lookupWebFinger("acct:alice@example.com");
if (result != null) {
  console.log("Subject:", result.subject);
  console.log("Aliases:", result.aliases);

  // Find the ActivityPub actor URL
  const actorLink = result.links?.find(
    (link) => link.rel === "self" && link.type === "application/activity+json",
  );
  if (actorLink?.href != null) {
    console.log("Actor URL:", actorLink.href);
  }
}
~~~~


### Configuration options

The `lookupWebFinger()` function accepts various options:

~~~~ typescript twoslash
import { lookupWebFinger } from "@fedify/webfinger";

const result = await lookupWebFinger("acct:alice@example.com", {
  // Custom User-Agent header
  userAgent: "MyApp/1.0",

  // Maximum redirects to follow (default: 5)
  maxRedirection: 3,

  // AbortSignal for cancellation
  signal: AbortSignal.timeout(5000),
});
~~~~

The available options are:

`userAgent`
:   The `User-Agent` header value to use when making requests.  Can be a string
    or an object with options for generating the header.

`allowPrivateAddress`
:   Whether to allow private IP addresses in the URL.  Mostly useful for
    testing purposes.  *Do not use this in production.*  Turned off by default.

`maxRedirection`
:   The maximum number of redirections to follow.  Defaults to `5`.

`tracerProvider`
:   The OpenTelemetry tracer provider.  If omitted, the global tracer provider
    is used.

`signal`
:   An `AbortSignal` for cancelling the request.

> [!TIP]
> Use `@fedify/webfinger` when you need a lightweight WebFinger client without
> the full Fedify framework.  If you're already using Fedify, prefer
> `~Context.lookupWebFinger()` instead as it integrates with the federation
> context.