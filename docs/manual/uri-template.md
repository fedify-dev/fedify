---
description: >-
  Fedify uses RFC 6570 URI Templates for routing.  This guide explains
  the different URI Template expansion types and when to use each one.
---

URI Template
============

Fedify uses URI Templates ([RFC 6570]) for defining URL patterns throughout
the framework.  This includes actor dispatchers, collection dispatchers, inbox
listeners, object dispatchers, and more.  Understanding the different expansion
types is crucial for handling identifiers correctly, especially when they
contain special characters or URIs.

Fedify's URI Template engine is published as a standalone
package—[`@fedify/uri-template`][@fedify/uri-template]—which you can use
independently of Fedify.  If you only need RFC 6570 expansion and round-trip
matching, jump to [Standalone `@fedify/uri-template`
package](#uri-template-package) below.

<!-- 
  If you don't need visualization of web page, refer text-only links:
  https://www.rfc-editor.org/rfc/rfc6570.txt
-->

[RFC 6570]: https://datatracker.ietf.org/doc/html/rfc6570
[@fedify/uri-template]: https://jsr.io/@fedify/uri-template


What are URI Templates?
-----------------------

URI Templates are a compact way to describe a range of URIs through variable
expansion.  They use curly braces `{}` to mark variable parts that get replaced
with actual values.  The way these variables are expanded depends on the
*operator* used inside the braces.


Expansion types
---------------

### Simple string expansion: `{var}`

Simple expansion is the default behavior when no operator is specified.
It percent-encodes reserved characters, making it suitable for basic string
identifiers like usernames or UUIDs.

Use this for basic identifiers that don't contain URIs or paths, such as
simple usernames (`alice`), numeric IDs, or UUIDs.  Notice how special
characters like `:` and spaces are percent-encoded:

| Template              | Value         | Result                 |
| --------------------- | ------------- | ---------------------- |
| `/users/{identifier}` | `alice`       | `/users/alice`         |
| `/users/{identifier}` | `alice:bob`   | `/users/alice%3Abob`   |
| `/users/{identifier}` | `hello world` | `/users/hello%20world` |

Here's how to use it in an actor dispatcher:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation.setActorDispatcher(
  "/users/{identifier}",  // Simple expansion
  async (ctx, identifier) => {
    // identifier could be: "alice", "user123", "uuid-4567", etc.
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      // ...
    });
  }
);
~~~~

> [!WARNING]
> Do not use simple expansion for identifiers that contain URIs or paths,
> as it will double-encode reserved characters like `:`, `/`, `?`, etc.

### Reserved string expansion: `{+var}`

Reserved expansion (using the `+` operator) preserves reserved characters that
are allowed in URIs, such as `:`, `/`, `?`, `#`, etc.  This is essential when
your identifier contains a URI or path.

Use this for identifiers that contain URIs, URLs, or paths.  Unlike simple
expansion, reserved characters are kept as-is instead of being percent-encoded.
This prevents double-encoding issues when your identifier is itself a URI:

| Template               | Value                       | Result                             |
| ---------------------- | --------------------------- | ---------------------------------- |
| `/users/{+identifier}` | `https://example.com/actor` | `/users/https://example.com/actor` |
| `/users/{+identifier}` | `alice:bob`                 | `/users/alice:bob`                 |
| `/users/{+identifier}` | `path/to/resource`          | `/users/path/to/resource`          |

Here's how to use it when your identifiers might contain URIs:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation.setActorDispatcher(
  "/users/{+identifier}",  // Reserved expansion
  async (ctx, identifier) => {
    // identifier could be: "https://example.com/actor", "urn:uuid:123", etc.
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      // ...
    });
  }
);
~~~~

> [!TIP]
> If you're getting double-encoding issues (e.g., `%253A` instead of `%3A`),
> switch from `{identifier}` to `{+identifier}`.

> [!CAUTION]
> Reserved expansion is an *advanced* choice, not the general recommendation
> for Fedify dispatcher paths.  Because `{+identifier}` keeps `/` literal, it
> does not stop at a path-segment boundary: it can consume extra segments and
> overlap with more specific routes.  For example, `/users/{+identifier}`
> also matches `/users/alice/inbox` and binds `identifier` to the value
> `alice/inbox`, shadowing a dedicated `/users/{identifier}/inbox` route.
>
> The common ActivityPub route families—`/users/{identifier}`,
> `/users/{identifier}/inbox`, and `/users/{identifier}/outbox`—rely on
> segment-bounded identifiers, so keep the plain `{identifier}` form for
> them.  Reach for `{+identifier}` only when the identifier itself genuinely
> contains slashes (such as an embedded URI), and add explicit validation in
> the dispatcher to reject unexpected path separators (see [Matching issues
> with `{+identifier}`](#matching-issues-with-identifier)).  Some APIs
> additionally forbid reserved expansion: a writable outbox requires the
> strict single-segment `{identifier}` shape (see the note under [Expansion
> versus matching](#expansion-versus-matching) below).

### Path segment expansion: `{/var}`

> [!CAUTION]
> `{/var}`, `{?var}`, and `{&var}` below are general [RFC 6570] operators
> that `@fedify/uri-template` supports for expansion and matching.  They are
> **not** appropriate for required Fedify dispatcher identifiers: a Fedify
> dispatcher exposes a non-optional `identifier: string` (or `values`)
> callback contract, and these operators can all match without binding a
> concrete value.  Use `{identifier}` or `{+identifier}` for dispatcher
> paths—see [Expansion versus matching](#expansion-versus-matching) and the
> [Decision guide](#decision-guide).

Path expansion automatically prefixes the value with a `/` character.
It's useful for optional path segments.  When the variable is empty or
undefined, nothing is added to the path:

| Template         | Value     | Result    |
| ---------------- | --------- | --------- |
| `/api{/version}` | `v1`      | `/api/v1` |
| `/api{/version}` | *(empty)* | `/api`    |

### Query parameter expansion: `{?var}`

Query expansion creates URL query parameters with `?` prefix.  You can specify
multiple variables separated by commas, and each will become a separate query
parameter:

| Template           | Value              | Result                    |
| ------------------ | ------------------ | ------------------------- |
| `/search{?q}`      | `hello`            | `/search?q=hello`         |
| `/search{?q,lang}` | `q=hello, lang=en` | `/search?q=hello&lang=en` |

### Query continuation: `{&var}`

Query continuation adds additional query parameters using `&` instead of `?`.
This is useful when you already have query parameters in the template and want
to add more:

| Template               | Value   | Result                     |
| ---------------------- | ------- | -------------------------- |
| `/search?type=all{&q}` | `hello` | `/search?type=all&q=hello` |

### Expansion versus matching

The standalone `@fedify/uri-template` `Router` supports every RFC 6570
operator above for both expansion and matching.  Fedify's dispatcher
routes, however, apply a default *non-empty* constraint to every template
variable: an unbound or empty binding is a runtime no-match rather than a
registration error.

In practice this means an optional-operator or path-expansion route such
as `/users{/identifier}` or `/users{?identifier}` registers successfully
but only matches when `identifier` is actually present and non-empty;
`/users/`, `/users//inbox`, and a missing identifier are *Not Found*.  Use
segment-boundary `{identifier}` for ordinary identifiers and
`{+identifier}` only when the identifier itself contains slashes.

> [!NOTE]
> The **outbox listener** is stricter still.  `setOutboxListeners()` enforces
> a single segment-boundary `{identifier}`: it rejects reserved expansion
> (`{+identifier}`), path-style expansion (`{/identifier}`), optional
> operators (`{?identifier}`, `{;identifier}`, `{.identifier}`), explode
> (`{identifier*}`), and prefix (`{identifier:3}`) at registration time.
> The read-only outbox *dispatcher* itself still accepts `{+identifier}`, but
> because the outbox dispatcher and outbox listener must share the same path,
> any actor with a writable outbox is effectively limited to the strict
> `{identifier}` shape.


Common use cases in Fedify
--------------------------

### Actor identifiers

If you're using simple usernames or UUIDs as actor identifiers, use simple
expansion.  This will properly encode any special characters:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation.setActorDispatcher(
  "/users/{identifier}",
  async (ctx, identifier) => {
    // identifier: "alice", "bob", "550e8400-e29b-41d4-a716-446655440000"
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      // ...
    });
  }
);
~~~~

However, if you're using URIs as identifiers (for example, when building
a proxy layer on top of existing ActivityPub servers), use reserved expansion
to avoid double-encoding:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation.setActorDispatcher(
  "/users/{+identifier}",
  async (ctx, identifier) => {
    // identifier: "https://solid.example/activitypub/actor"
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      // ...
    });
  }
);
~~~~

### Collections

The same principle applies to collections.  Use simple expansion when your
identifiers are basic strings:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import type { Recipient } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation.setFollowersDispatcher(
  "/users/{identifier}/followers",
  async (ctx, identifier, cursor) => {
    // identifier: "alice", "bob"
    const items: Recipient[] = [];  // Your implementation here
    return { items };
  }
);
~~~~

And use reserved expansion when identifiers might contain URIs:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import type { Recipient } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation.setFollowersDispatcher(
  "/users/{+identifier}/followers",
  async (ctx, identifier, cursor) => {
    // identifier: "https://example.com/users/alice"
    const items: Recipient[] = [];  // Your implementation here
    return { items };
  }
);
~~~~

### Other dispatchers and listeners

URI Templates work the same way across all Fedify routing configurations.
Here are some additional examples:

Inbox listeners use the same pattern as other dispatchers:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Create } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Create, async (ctx, create) => {
    // Handle incoming Create activity
  });
~~~~

Object dispatchers allow you to serve ActivityPub objects at custom URIs:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Note } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation.setObjectDispatcher(
  Note,
  "/users/{identifier}/posts/{id}",
  async (ctx, values) => {
    // values.identifier and values.id are both available
    return new Note({
      id: ctx.getObjectUri(Note, values),
      content: "Hello, world!",
    });
  }
);
~~~~

The same expansion rules apply: use `{identifier}` for simple strings and
`{+identifier}` for URI-containing values.


Common pitfalls
---------------

### Double-encoding with `{identifier}` for URIs

Using `{identifier}` when the identifier contains a URI causes double-encoding.
For example, if your identifier is `"https://example.com/actor"`, the collection
ID becomes
`https://fedify.example/users/https%253A%252F%252Fexample.com%252Factor/followers`
(notice `%253A` instead of `%3A`—the percent sign itself gets encoded).

This is wrong:

~~~~ typescript
// ❌ WRONG: Using {identifier} for URI-containing identifiers
federation.setFollowersDispatcher(
  "/users/{identifier}/followers",
  async (ctx, identifier, cursor) => {
    // Double-encoding will occur!
  }
);
~~~~

Instead, use `{+identifier}` for URI-containing identifiers:

~~~~ typescript
// ✅ CORRECT: Using {+identifier} for URI-containing identifiers
federation.setFollowersDispatcher(
  "/users/{+identifier}/followers",
  async (ctx, identifier, cursor) => {
    // Now it expands to: /users/https://example.com/actor/followers
  }
);
~~~~

### Matching issues with `{+identifier}`

Reserved expansion `{+identifier}` can match too broadly, including additional
path segments.  For example, `/users/{+identifier}` might match
`/users/alice/inbox`, giving `identifier` the value `"alice/inbox"`.

To prevent this, add validation in your dispatcher to reject identifiers
containing unexpected characters:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation.setActorDispatcher(
  "/users/{+identifier}",
  async (ctx, identifier) => {
    // Reject identifiers with path separators if not expected
    if (identifier.includes('/')) return null;
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
    });
  }
);
~~~~


Decision guide
--------------

This guide is for **Fedify dispatcher paths**, where the identifier is a
required value that must be bound from the request path.  `Federation.fetch()`
routes against `URL.pathname`, so only two expansion types are valid choices
here—`{identifier}` and `{+identifier}`:

~~~~ mermaid
flowchart TD
    Start[Fedify dispatcher identifier]
    Start --> Simple{Simple string?<br/>e.g., username, UUID}
    Start --> URI{Contains a URI or slashes?<br/>e.g., https://...}

    Simple --> UseBraces["Use {identifier}"]
    URI --> UsePlus["Use {+identifier}"]

    UseBraces --> Example1["Example: /users/{identifier}"]
    UsePlus --> Example2["Example: /users/{+identifier}"]
~~~~

Quick reference for dispatcher identifiers:

| If your identifier contains…   | Use             |
| ------------------------------ | --------------- |
| Just letters, numbers, hyphens | `{identifier}`  |
| UUIDs                          | `{identifier}`  |
| URIs or URLs                   | `{+identifier}` |
| Special chars like `:`, `/`    | `{+identifier}` |
| Path segments                  | `{+identifier}` |

> [!NOTE]
> The other RFC 6570 operators (`{/var}`, `{?var}`, `{&var}`, `{;var}`,
> `{.var}`, `{#var}`) are fully supported by the standalone
> `@fedify/uri-template` package for general expansion and matching, but
> they are deliberately absent from this chart: a required dispatcher
> identifier must never come from an optional path or query expansion that
> can match without binding a value.  See [Standalone
> `@fedify/uri-template` package](#uri-template-package) if you need them
> outside a Fedify dispatcher.


Troubleshooting
---------------

### How do I know if I'm using the wrong expansion type?

Symptoms of using `{identifier}` when you should use `{+identifier}`:

 -  Double-encoded characters (e.g., `%253A` instead of `%3A`)
 -  Collection IDs that don't match the expected format
 -  Errors when trying to access generated URIs

Symptoms of using `{+identifier}` when you should use `{identifier}`:

 -  Routes matching too broadly (catching extra path segments)
 -  Security issues with path traversal
 -  Unexpected values in your identifier parameter

### Testing your URI Template

You can test your URI Template patterns by examining the generated URIs in your
dispatcher callbacks.  The `Context.getActorUri()` and similar methods will
expand the templates according to the pattern you specified.

For example, to verify the expansion:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation.setActorDispatcher(
  "/users/{+identifier}",
  async (ctx, identifier) => {
    // Log the generated URI to verify expansion
    const uri = ctx.getActorUri(identifier);
    console.log(`Identifier: ${identifier}`);
    console.log(`Generated URI: ${uri.href}`);

    return new Person({
      id: uri,
      preferredUsername: identifier,
    });
  }
);
~~~~


Standalone `@fedify/uri-template` package {#uri-template-package}
-----------------------------------------------------------------

The routing engine described above is published on its own as the
[`@fedify/uri-template`][@fedify/uri-template] package.  It has zero runtime
dependencies and works on Deno, Node.js, and Bun, so you can use it for plain
[RFC 6570] URI Template expansion and matching even outside a Fedify
application.

Install it with your package manager:

~~~~ bash
deno add jsr:@fedify/uri-template  # Deno
npm  add     @fedify/uri-template  # npm
pnpm add     @fedify/uri-template  # pnpm
yarn add     @fedify/uri-template  # Yarn
bun  add     @fedify/uri-template  # Bun
~~~~

### Expanding and matching with `Template`

A `Template` parses a URI Template string once and can then be reused.  Call
`expand()` to turn variables into a URI, and `match()` to recover the variables
from a URI (it returns `null` when the URI does not match):

~~~~ typescript twoslash
import { Template } from "@fedify/uri-template";
// ---cut-before---
const template = new Template("/users/{identifier}");

template.expand({ identifier: "alice" });
// → "/users/alice"

template.match("/users/alice");
// → { identifier: "alice" }

template.match("/posts/42");
// → null
~~~~

The standalone `Template` supports every RFC 6570 operator (`{var}`, `{+var}`,
`{#var}`, `{.var}`, `{/var}`, `{;var}`, `{?var}`, and `{&var}`), so it is not
limited to the patterns recommended for Fedify dispatchers.

### Round-trip matching

`match()` does not merely decode a URI—it returns variables only when expanding
them again reproduces the *exact* input URI.  This rejects URIs that look
plausible after decoding but could never have been produced by the template:

~~~~ typescript twoslash
import { Template } from "@fedify/uri-template";
// ---cut-before---
const template = new Template("/users/{identifier}");

// Simple expansion percent-encodes the slash:
template.expand({ identifier: "a/b" });
// → "/users/a%2Fb"

// The encoded form round-trips, so it matches:
template.match("/users/a%2Fb");
// → { identifier: "a/b" }

// A literal slash could never be produced here, so there is no match:
template.match("/users/a/b");
// → null
~~~~

This is the same guarantee Fedify relies on to map an incoming request path
back to a dispatcher identifier, which is why the
[expansion type](#expansion-types) you choose matters.

### Strict vs. lenient parsing

By default a `Template` is *strict*: the first parse or expansion error is
reported and then thrown.  Pass `strict: false` to collect diagnostics through
a `report` callback without throwing.  This is useful when you want to accept
looser input or surface warnings through your own logger:

~~~~ typescript twoslash
import { Template } from "@fedify/uri-template";
// ---cut-before---
// Strict (the default): the unclosed expression throws.
try {
  new Template("/users/{identifier");
} catch (error) {
  console.error(error);  // an UnclosedExpressionError
}

// Lenient: errors are reported but not thrown.
const diagnostics: Error[] = [];
const lenient = new Template("/users/{identifier", {
  strict: false,
  report: (error) => diagnostics.push(error),
});
lenient.expand({ identifier: "alice" });
console.log(diagnostics);  // contains the reported parse error
~~~~

### Routing with `Router`

`Router` maps many templates to names.  Register routes, resolve a URI to a
route with `route()`, and reverse the mapping with `build()`:

~~~~ typescript twoslash
import { Router } from "@fedify/uri-template";
// ---cut-before---
const router = new Router();
router.add("/users/{identifier}", "actor");
router.add("/users/{identifier}/followers", "followers");

router.route("/users/alice");
// → { name: "actor",
//     template: "/users/{identifier}",
//     values: { identifier: "alice" } }

router.route("/users/alice/followers");
// → { name: "followers", … }

router.build("actor", { identifier: "alice" });
// → "/users/alice"
~~~~

Register several routes at once with `register()`, and inspect a template
without registering it through `Router.compile()` or `Router.variables()`:

~~~~ typescript twoslash
import { Router } from "@fedify/uri-template";
// ---cut-before---
const router = new Router();
router.register([
  ["/users/{identifier}", "actor"],
  ["/users/{identifier}/inbox", "inbox"],
] as const);

Router.variables("/users/{identifier}/posts/{id}");
// → Set { "identifier", "id" }
~~~~

### Per-route variable constraints

Each route is a `[pathOrPattern, name, options?]` tuple.  The optional
third element constrains matching per template variable through its
`variables` field:

~~~~ typescript twoslash
import { Router } from "@fedify/uri-template";
// ---cut-before---
const router = new Router();
router.add("/search{?q}", "search", {
  variables: { q: { nullable: true } },
});

// `q` is nullable, so the bare path still matches:
router.route("/search");
// → { name: "search", template: "/search{?q}", values: {} }
~~~~

The constraint defaults are deliberately strict so routes fail loudly at
registration time rather than mis-matching at runtime:

 -  `nullable` defaults to `false`: an unbound or empty variable is a
    no-match (the router falls back to the next candidate).  This is why a
    `/search{?q}` route does *not* match `/search` until `q` is marked
    `nullable: true`.
 -  `multiple` is derived from the specification (explode `{tags*}` ⇒
    `true`, prefix `{id:3}` ⇒ `false`, plain ⇒ `false`).  A contradicting
    `multiple`, or the same name carrying conflicting explode/prefix
    modifiers, throws `ConflictingVarSpecError`.
 -  `duplicable`, `prefixable`, and `explodable` all default to `false`:
    a repeated variable, a `{var:N}` prefix, or a `{var*}` explode each
    throws at registration time (`DuplicateRouteVariableError` and
    `DisallowedVarSpecModifierError`) unless the matching flag is opted
    in.
 -  `operatables` defaults to `[]` (every operator allowed); set it to a
    non-empty operator list to reject other operators with
    `DisallowedOperatorError`.

The options object also takes `exact` (default `true`): when a
`variables` object is supplied its keys must match the template's
variables exactly, otherwise registration throws
`RouteTemplateOptionsNotMatchedError`.  Pass `{ exact: false }` to leave
unlisted variables at their defaults and ignore unknown keys.  Routes
registered without a `variables` object keep every default and are
unaffected.

`Router.route()` is generic over the constraint map, so the recovered
`values` narrow to `string` or `readonly string[]` per variable when you
pass the constraints at the call site.

> [!NOTE]
> The standalone `Template` and `Router` accept every RFC 6570 operator.
> When you use URI Templates for Fedify dispatchers, however, required
> identifiers must be bound from the request path, so follow the
> recommendations in [Expansion types](#expansion-types) and [Common use
> cases in Fedify](#common-use-cases-in-fedify) above rather than every
> operator the package can parse.


Further reading
---------------

[RFC 6570]: URI Template
:   The official specification

[`@fedify/uri-template`][@fedify/uri-template]
:   The standalone RFC 6570 package powering Fedify's router

[Actor dispatcher](./actor.md)
:   Learn about actor routing in Fedify

[Collections](./collections.md)
:   Learn about collection routing in Fedify

[Inbox listeners](./inbox.md)
:   Learn about handling incoming activities

[Object dispatcher](./object.md)
:   Learn about serving custom objects
