<!-- deno-fmt-ignore-file -->

@fedify/webfinger: WebFinger client library for ActivityPub
===========================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]

This package provides a WebFinger client implementation for looking up
ActivityPub actors and other resources in the fediverse.  It is part of the
[Fedify] framework but can be used independently.

[JSR]: https://jsr.io/@fedify/webfinger
[JSR badge]: https://jsr.io/badges/@fedify/webfinger
[npm]: https://www.npmjs.com/package/@fedify/webfinger
[npm badge]: https://img.shields.io/npm/v/@fedify/webfinger?logo=npm
[Fedify]: https://fedify.dev/


Features
--------

 -  WebFinger resource lookup ([RFC 7033])
 -  Support for `acct:` URI scheme
 -  Automatic HTTPS URL construction
 -  Configurable redirect handling
 -  OpenTelemetry integration for tracing
 -  Private IP address validation for security

[RFC 7033]: https://datatracker.ietf.org/doc/html/rfc7033


Installation
------------

~~~~ bash
deno add jsr:@fedify/webfinger  # Deno
npm add @fedify/webfinger       # npm
pnpm add @fedify/webfinger      # pnpm
yarn add @fedify/webfinger      # Yarn
bun add @fedify/webfinger       # Bun
~~~~


Usage
-----

### Looking up a WebFinger resource

You can look up a WebFinger resource using the `lookupWebFinger()` function:

~~~~ typescript
import { lookupWebFinger } from "@fedify/webfinger";

// Look up by acct: URI
const result = await lookupWebFinger("acct:alice@example.com");

// Look up by URL
const result2 = await lookupWebFinger("https://example.com/users/alice");
~~~~

### Working with the result

The result is a `ResourceDescriptor` object containing the subject, aliases,
properties, and links:

~~~~ typescript
import { lookupWebFinger } from "@fedify/webfinger";

const result = await lookupWebFinger("acct:alice@example.com");
if (result != null) {
  console.log("Subject:", result.subject);
  console.log("Aliases:", result.aliases);

  // Find the ActivityPub actor URL
  const actorLink = result.links?.find(
    (link) => link.rel === "self" && link.type === "application/activity+json"
  );
  if (actorLink?.href != null) {
    console.log("Actor URL:", actorLink.href);
  }
}
~~~~

### Configuration options

The `lookupWebFinger()` function accepts various options:

~~~~ typescript
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


API
---

### Functions

 -  `lookupWebFinger(resource, options?)`: Looks up a WebFinger resource and
    returns a `ResourceDescriptor` or `null` if not found.

### Types

 -  `ResourceDescriptor`: Describes a WebFinger resource with subject, aliases,
    properties, and links.
 -  `Link`: Represents a link in a WebFinger response with relation type, media
    type, href, titles, and properties.
 -  `LookupWebFingerOptions`: Options for the `lookupWebFinger()` function.


Documentation
-------------

For comprehensive documentation, please refer to:

 -  [WebFinger documentation](https://fedify.dev/manual/webfinger)
 -  [API reference](https://jsr.io/@fedify/webfinger/doc/~)


Related packages
----------------

 -  *@fedify/fedify*: The main Fedify framework
 -  *@fedify/vocab*: Activity Vocabulary library


License
-------

[MIT License](https://github.com/fedify-dev/fedify/blob/main/LICENSE)
