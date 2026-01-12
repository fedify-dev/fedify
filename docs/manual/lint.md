---
description: >-
  Fedify provides linting plugins for Deno Lint and ESLint to help you catch
  common mistakes and enforce best practices when building federated server
  apps.
---

Linting
=======

_This package is available since Fedify 2.0.0._

> [!TIP]
> We highly recommend using the `@fedify/lint` package in your federated server
> app to catch common mistakes early and enforce best practices.

Fedify provides the [`@fedify/lint`] package, which includes lint rules
specifically designed for Fedify applications. It supports both [Deno Lint] and
[ESLint], so you can use it regardless of your JavaScript/TypeScript runtime.

The plugin includes rules that check for:

- Proper actor ID configuration
- Required actor properties (inbox, outbox, followers, etc.)
- Correct URL patterns for actor collections
- Public key and assertion method requirements
- Collection filtering implementation

[`@fedify/lint`]: https://jsr.io/@fedify/lint
[Deno Lint]: https://docs.deno.com/runtime/reference/lint_plugins/
[ESLint]: https://eslint.org/

Installation
------------

::: code-group

~~~~sh [Deno]
deno add jsr:@fedify/lint
~~~~

~~~~sh [npm]
npm add -D @fedify/lint
~~~~

~~~~sh [pnpm]
pnpm add -D @fedify/lint
~~~~

~~~~sh [Yarn]
yarn add -D @fedify/lint
~~~~

~~~~sh [Bun]
bun add -D @fedify/lint
~~~~

:::

Deno Lint
---------

### Basic setup

Add the plugin to your _deno.json_ configuration file:

~~~~json
{
  "lint": {
    "plugins": ["jsr:@fedify/lint"]
  }
}
~~~~

By default, this enables all recommended rules.

### Custom configuration

You can customize which rules to enable and their severity levels:

~~~~json
{
  "lint": {
    "plugins": ["jsr:@fedify/lint"],
    "rules": {
      "tags": ["recommended"],
      "include": [
        "@fedify/lint/actor-id-required",
        "@fedify/lint/actor-id-mismatch"
      ],
      "exclude": [
        "@fedify/lint/actor-featured-property-required"
      ]
    }
  }
}
~~~~

### Running Deno Lint

After setting up the configuration, run Deno's linter:

~~~~sh
deno lint
~~~~

You can also specify which files to lint:

~~~~sh
deno lint federation.ts
deno lint src/federation/
~~~~

ESLint
------

### Basic setup

Add the plugin to your ESLint configuration file (e.g., _eslint.config.ts_ or
_eslint.config.js_):

~~~~ typescript twoslash
import fedifyLint from "@fedify/lint";

// If your `createFederation` code is in `federation.ts` or `federation/**.ts`
export default fedifyLint;
~~~~

Or specify your own federation files: 

~~~~ typescript twoslash
// @errors: 2304
import fedifyLint from "@fedify/lint";
// ---cut-before---
export default {
  ...fedifyLint,
  files: ["my-own-federation.ts"],
};
~~~~

If you use other ESLint configurations: 

~~~~ typescript twoslash
// @errors: 2304
import fedifyLint from "@fedify/lint";
// ---cut-before---
export default [
  // otherConfig,
  fedifyLint,
];
~~~~

The default configuration applies recommended rules to files that match common
federation-related patterns (e.g., _federation.ts_, _federation/\*.ts_).

### Custom configuration

You can customize which files to lint and which rules to enable:

~~~~ typescript twoslash
import { plugin } from "@fedify/lint";

export default [{
  files: ["src/federation/**/*.ts"], // Your federation code location
  plugins: {
    "@fedify/lint": plugin,
  },
  rules: {
    "@fedify/lint/actor-id-required": "error",
    "@fedify/lint/actor-id-mismatch": "error",
    "@fedify/lint/actor-inbox-property-required": "warn",
    // ... other rules
  },
}];
~~~~

### Using configurations

The plugin provides two preset configurations:

#### Recommended (default)

Enables critical rules as errors and optional rules as warnings:

~~~~ typescript twoslash
import fedifyLint from "@fedify/lint";

export default fedifyLint;
~~~~

#### Strict

Enables all rules as errors:

~~~~ typescript twoslash
import { plugin } from "@fedify/lint";

export default [{
  files: ["**/*.ts"],
  ...plugin.configs.strict,
}];
~~~~

### Running ESLint

Set up your ESLint configuration as shown above and add a script to
_package.json_:

~~~~jsonc
{
  "scripts": {
    "lint": "eslint ."
  }
}
~~~~

After setting up the configuration, run ESLint on your codebase:

::: code-group

~~~~sh [npm]
npm run lint
~~~~

~~~~sh [pnpm]
pnpm lint
~~~~

~~~~sh [Yarn]
yarn lint
~~~~

~~~~sh [Bun]
bun lint
~~~~

:::

Or run the linter directly via command line:

::: code-group

~~~~sh [npm]
npx eslint .
~~~~

~~~~sh [pnpm]
pnpx eslint .
~~~~

~~~~sh [Yarn]
yarn eslint .
~~~~

~~~~sh [Bun]
bunx eslint .
~~~~

:::

Rules
-----

### `actor-id-required`

Ensures all actors have an `id` property in the actor dispatcher.

**When this rule applies:**
The actor dispatcher returns a `Person`, `Organization`, `Group`, `Application`,
or `Service` object without an `id` property.

**Why it matters:**
Every ActivityPub actor must have a unique identifier (ID) to be discoverable
and to receive activities from other servers.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Missing id property
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    name: "John Doe",  // No id!
  });
});

// ✅ Good: Include id property
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    name: "John Doe",
  });
});
~~~~

### `actor-id-mismatch`

Validates that actor IDs match the expected URI from `Context.getActorUri()`.

**When this rule applies:**
The `id` property is set to a value other than `ctx.getActorUri(identifier)`,
such as a hardcoded URL string, `new URL(...)`, or a different context method.

**Why it matters:**
Using the wrong URI for the actor ID can cause federation issues.  Other servers
won't be able to properly verify the actor's identity or send activities to it.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Using hardcoded URL
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: new URL(`https://example.com/users/${identifier}`),
    name: "John Doe",
  });
});

// ❌ Bad: Using wrong context method
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getFollowersUri(identifier),  // Wrong method!
    name: "John Doe",
  });
});

// ✅ Good: Use ctx.getActorUri()
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    name: "John Doe",
  });
});
~~~~

### `actor-public-key-required`

Ensures actors have public keys for [HTTP Signatures].

**When this rule applies:**
The actor dispatcher is chained with `setKeyPairsDispatcher()`, but the actor
object doesn't include a `publicKey` or `publicKeys` property.

**Why it matters:**
HTTP Signatures are used to verify the authenticity of activities.  Without
a public key, other servers cannot verify that activities sent by your actor
are legitimate.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Missing publicKey when setKeyPairsDispatcher is configured
federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    return new Person({
      id: ctx.getActorUri(identifier),
      name: "John Doe",
      // Missing publicKey!
    });
  })
  .setKeyPairsDispatcher(async (ctx, identifier) => {
    // Returns key pairs...
    return [];
  });

// ✅ Good: Include publicKey from key pairs dispatcher
federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    const keyPairs = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      name: "John Doe",
      publicKey: keyPairs[0].cryptographicKey,
    });
  })
  .setKeyPairsDispatcher(async (ctx, identifier) => {
    // Returns key pairs...
    return [];
  });
~~~~

[HTTP Signatures]: ./send.md#http-signatures

### `actor-assertion-method-required`

Validates that actors have assertion methods for [Object Integrity Proofs].

**When this rule applies:**
The actor dispatcher is chained with `setKeyPairsDispatcher()`, but the actor
object doesn't include an `assertionMethod` property.

**Why it matters:**
Object Integrity Proofs use assertion methods to cryptographically sign
activities.  This provides an additional layer of security beyond HTTP
Signatures.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Missing assertionMethod when setKeyPairsDispatcher is configured
federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    const keyPairs = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      name: "John Doe",
      publicKey: keyPairs[0].cryptographicKey,
      // Missing assertionMethod!
    });
  })
  .setKeyPairsDispatcher(async (ctx, identifier) => {
    // Returns key pairs...
    return [];
  });

// ✅ Good: Include assertionMethod from key pairs dispatcher
federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    const keyPairs = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      name: "John Doe",
      publicKey: keyPairs[0].cryptographicKey,
      assertionMethod: keyPairs[0].multikey,
    });
  })
  .setKeyPairsDispatcher(async (ctx, identifier) => {
    // Returns key pairs...
    return [];
  });
~~~~

[Object Integrity Proofs]: ./send.md#object-integrity-proofs

### `actor-inbox-property-required`

Ensures `inbox` is defined when `setInboxListeners()` is configured.

**When this rule applies:**
You've called `federation.setInboxListeners()` to handle incoming activities,
but the actor object doesn't include an `inbox` property.

**Why it matters:**
The inbox URL tells other servers where to send activities to your actor.
Without it, your actor cannot receive follow requests, mentions, or any other
activities.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Missing inbox when setInboxListeners is configured
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    name: "John Doe",
    // Missing inbox!
  });
});

federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");

// ✅ Good: Include inbox property
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    name: "John Doe",
    inbox: ctx.getInboxUri(identifier),
  });
});

federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
~~~~

### `actor-inbox-property-mismatch`

Validates that the `inbox` URI is set using `ctx.getInboxUri(identifier)`.

**When this rule applies:**
The `inbox` property is set to a value other than `ctx.getInboxUri(identifier)`.

**Why it matters:**
The inbox URI must match the path configured in `setInboxListeners()`.  Using
a different URI will cause incoming activities to fail.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Using hardcoded URL
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    inbox: new URL(`https://example.com/inbox/${identifier}`),  // Wrong!
  });
});

// ✅ Good: Use ctx.getInboxUri()
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    inbox: ctx.getInboxUri(identifier),
  });
});
~~~~

### `actor-outbox-property-required`

Ensures `outbox` is defined when `setOutboxDispatcher()` is configured.

**When this rule applies:**
You've called `federation.setOutboxDispatcher()` to serve the actor's outbox,
but the actor object doesn't include an `outbox` property.

**Why it matters:**
The outbox URL allows other servers and users to view the actor's published
activities.  It's part of the standard ActivityPub actor profile.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Missing outbox when setOutboxDispatcher is configured
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    // Missing outbox!
  });
});

federation.setOutboxDispatcher(
  "/users/{identifier}/outbox",
  (ctx, identifier) => ({ items: [] })
);

// ✅ Good: Include outbox property
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    outbox: ctx.getOutboxUri(identifier),
  });
});
~~~~

### `actor-outbox-property-mismatch`

Validates that the `outbox` URI is set using `ctx.getOutboxUri(identifier)`.

**When this rule applies:**
The `outbox` property is set to a value other than
`ctx.getOutboxUri(identifier)`.

**Why it matters:**
The outbox URI must match the path configured in `setOutboxDispatcher()`.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Using wrong context method
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    outbox: ctx.getInboxUri(identifier),  // Wrong method!
  });
});

// ✅ Good: Use ctx.getOutboxUri()
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    outbox: ctx.getOutboxUri(identifier),
  });
});
~~~~

### `actor-followers-property-required`

Ensures `followers` is defined when `setFollowersDispatcher()` is configured.

**When this rule applies:**
You've called `federation.setFollowersDispatcher()` to serve the actor's
followers collection, but the actor object doesn't include a `followers`
property.

**Why it matters:**
The followers URL allows other servers to discover who follows this actor,
which is important for activity delivery and social graph discovery.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Missing followers when setFollowersDispatcher is configured
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    // Missing followers!
  });
});

federation.setFollowersDispatcher(
  "/users/{identifier}/followers",
  (ctx, identifier) => ({ items: [] })
);

// ✅ Good: Include followers property
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    followers: ctx.getFollowersUri(identifier),
  });
});
~~~~

### `actor-followers-property-mismatch`

Validates that the `followers` URI is set using
`ctx.getFollowersUri(identifier)`.

**When this rule applies:**
The `followers` property is set to a value other than
`ctx.getFollowersUri(identifier)`.

**Why it matters:**
The followers URI must match the path configured in `setFollowersDispatcher()`.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Using wrong context method
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    followers: ctx.getFollowingUri(identifier),  // Wrong method!
  });
});

// ✅ Good: Use ctx.getFollowersUri()
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    followers: ctx.getFollowersUri(identifier),
  });
});
~~~~

### `actor-following-property-required`

Ensures `following` is defined when `setFollowingDispatcher()` is configured.

**When this rule applies:**
You've called `federation.setFollowingDispatcher()` to serve the actor's
following collection, but the actor object doesn't include a `following`
property.

**Why it matters:**
The following URL allows other servers to discover who this actor follows.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Missing following when setFollowingDispatcher is configured
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    // Missing following!
  });
});

federation.setFollowingDispatcher(
  "/users/{identifier}/following",
  (ctx, identifier) => ({ items: [] })
);

// ✅ Good: Include following property
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    following: ctx.getFollowingUri(identifier),
  });
});
~~~~

### `actor-following-property-mismatch`

Validates that the `following` URI is set using
`ctx.getFollowingUri(identifier)`.

**When this rule applies:**
The `following` property is set to a value other than
`ctx.getFollowingUri(identifier)`.

**Why it matters:**
The following URI must match the path configured in `setFollowingDispatcher()`.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Using wrong context method
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    following: ctx.getFollowersUri(identifier),  // Wrong method!
  });
});

// ✅ Good: Use ctx.getFollowingUri()
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    following: ctx.getFollowingUri(identifier),
  });
});
~~~~

### `actor-liked-property-required`

Ensures `liked` is defined when `setLikedDispatcher()` is configured.

**When this rule applies:**
You've called `federation.setLikedDispatcher()` to serve the actor's liked
collection, but the actor object doesn't include a `liked` property.

**Why it matters:**
The liked URL allows other servers to discover what content this actor has
liked.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Missing liked when setLikedDispatcher is configured
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    // Missing liked!
  });
});

federation.setLikedDispatcher(
  "/users/{identifier}/liked",
  (ctx, identifier) => ({ items: [] })
);

// ✅ Good: Include liked property
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    liked: ctx.getLikedUri(identifier),
  });
});
~~~~

### `actor-liked-property-mismatch`

Validates that the `liked` URI is set using `ctx.getLikedUri(identifier)`.

**When this rule applies:**
The `liked` property is set to a value other than `ctx.getLikedUri(identifier)`.

**Why it matters:**
The liked URI must match the path configured in `setLikedDispatcher()`.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Using wrong context method
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    liked: ctx.getFollowersUri(identifier),  // Wrong method!
  });
});

// ✅ Good: Use ctx.getLikedUri()
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    liked: ctx.getLikedUri(identifier),
  });
});
~~~~

### `actor-featured-property-required`

Ensures `featured` is defined when `setFeaturedDispatcher()` is configured.

**When this rule applies:**
You've called `federation.setFeaturedDispatcher()` to serve the actor's
featured/pinned posts collection, but the actor object doesn't include a
`featured` property.

**Why it matters:**
The featured URL allows other servers to discover the actor's pinned or
highlighted content (commonly shown at the top of a profile).

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Missing featured when setFeaturedDispatcher is configured
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    // Missing featured!
  });
});

federation.setFeaturedDispatcher(
  "/users/{identifier}/featured",
  (ctx, identifier) => ({ items: [] })
);

// ✅ Good: Include featured property
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    featured: ctx.getFeaturedUri(identifier),
  });
});
~~~~

### `actor-featured-property-mismatch`

Validates that the `featured` URI is set using
`ctx.getFeaturedUri(identifier)`.

**When this rule applies:**
The `featured` property is set to a value other than
`ctx.getFeaturedUri(identifier)`.

**Why it matters:**
The featured URI must match the path configured in `setFeaturedDispatcher()`.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Using wrong context method
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    featured: ctx.getFollowersUri(identifier),  // Wrong method!
  });
});

// ✅ Good: Use ctx.getFeaturedUri()
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    featured: ctx.getFeaturedUri(identifier),
  });
});
~~~~

### `actor-featured-tags-property-required`

Ensures `featuredTags` is defined when `setFeaturedTagsDispatcher()` is
configured.

**When this rule applies:**
You've called `federation.setFeaturedTagsDispatcher()` to serve the actor's
featured hashtags collection, but the actor object doesn't include a
`featuredTags` property.

**Why it matters:**
The featuredTags URL allows other servers to discover the actor's featured
hashtags (commonly used for profile discovery).

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Missing featuredTags when setFeaturedTagsDispatcher is configured
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    // Missing featuredTags!
  });
});

federation.setFeaturedTagsDispatcher(
  "/users/{identifier}/tags",
  (ctx, identifier) => ({ items: [] })
);

// ✅ Good: Include featuredTags property
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    featuredTags: ctx.getFeaturedTagsUri(identifier),
  });
});
~~~~

### `actor-featured-tags-property-mismatch`

Validates that the `featuredTags` URI is set using
`ctx.getFeaturedTagsUri(identifier)`.

**When this rule applies:**
The `featuredTags` property is set to a value other than
`ctx.getFeaturedTagsUri(identifier)`.

**Why it matters:**
The featuredTags URI must match the path configured in
`setFeaturedTagsDispatcher()`.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Using wrong context method
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    featuredTags: ctx.getFollowersUri(identifier),  // Wrong method!
  });
});

// ✅ Good: Use ctx.getFeaturedTagsUri()
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    featuredTags: ctx.getFeaturedTagsUri(identifier),
  });
});
~~~~

### `actor-shared-inbox-property-required`

Ensures `endpoints.sharedInbox` is defined when `setInboxListeners()` is
configured with a shared inbox path.

**When this rule applies:**
You've called `federation.setInboxListeners()` with a second parameter (shared
inbox path), but the actor object doesn't include an
`endpoints: new Endpoints({ sharedInbox: ... })` property.

**Why it matters:**
The shared inbox allows other servers to send activities to multiple actors
on your server with a single request, improving federation efficiency.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Endpoints, Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Missing sharedInbox when setInboxListeners has shared inbox path
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    inbox: ctx.getInboxUri(identifier),
    // Missing endpoints.sharedInbox!
  });
});

federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");

// ✅ Good: Include endpoints.sharedInbox
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    inbox: ctx.getInboxUri(identifier),
    endpoints: new Endpoints({
      sharedInbox: ctx.getInboxUri(),
    }),
  });
});
~~~~

### `actor-shared-inbox-property-mismatch`

Validates that `endpoints.sharedInbox` is set using `ctx.getInboxUri()` (without
identifier).

**When this rule applies:**
The `endpoints.sharedInbox` property is set to a value other than
`ctx.getInboxUri()` (called without arguments for the shared inbox).

**Why it matters:**
The shared inbox URI must match the shared inbox path configured in
`setInboxListeners()`.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Endpoints, Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Using getInboxUri with identifier for shared inbox
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    inbox: ctx.getInboxUri(identifier),
    endpoints: new Endpoints({
      sharedInbox: ctx.getInboxUri(identifier),  // Wrong! Should be no args
    }),
  });
});

// ✅ Good: Use ctx.getInboxUri() without arguments
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    inbox: ctx.getInboxUri(identifier),
    endpoints: new Endpoints({
      sharedInbox: ctx.getInboxUri(),  // No identifier for shared inbox
    }),
  });
});
~~~~

### `collection-filtering-not-implemented`

Warns when collection dispatchers don't implement filtering.

**When this rule applies:**
The `setFollowersDispatcher()` callback function has fewer than 4 parameters
(missing the `filter` parameter).

> [!NOTE]
> Currently, this rule only checks `setFollowersDispatcher()`.  Other collection
> dispatchers may be added in the future.

**Why it matters:**
Collection filtering allows clients to request specific subsets of a collection,
reducing response payload sizes and improving performance.  Without filtering,
large collections could cause performance issues.

For more information, see the [*Filtering by server*] section in the
collections manual.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Bad: Missing filter parameter
federation.setFollowersDispatcher(
  "/users/{identifier}/followers",
  async (ctx, identifier, cursor) => {  // Only 3 parameters!
    return { items: [] };
  }
);

// ✅ Good: Include filter parameter (4th parameter)
federation.setFollowersDispatcher(
  "/users/{identifier}/followers",
  async (ctx, identifier, cursor, filter) => {
    // Use filter to handle filtering requests
    return { items: [] };
  }
);
~~~~

[*Filtering by server*]: ./collections.md#filtering-by-server

Example
-------

Here's an example of code that would trigger lint errors:

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ❌ Wrong: Using relative URL for actor ID
federation.setActorDispatcher(
  "/{identifier}",
  (_ctx, identifier) => {
    return new Person({
      id: new URL(`/${identifier}`), // ❌ Should use ctx.getActorUri()
      name: "Example User",
    });
  },
);
~~~~

Corrected version:

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = createFederation<void>({ kv: null as any });
// ---cut-before---
// ✅ Correct: Using Context.getActorUri() for actor ID
federation.setActorDispatcher(
  "/{identifier}",
  (ctx, identifier) => {
    return new Person({
      id: ctx.getActorUri(identifier), // ✅ Correct
      name: "Example User",
      inbox: ctx.getInboxUri(identifier),
      outbox: ctx.getOutboxUri(identifier),
      followers: ctx.getFollowersUri(identifier),
      // ... other required properties
    });
  },
);
~~~~

When you run the linter on the incorrect code, you'll see an error like:

~~~~
error[fedify-lint/actor-id-mismatch]: Actor's `id` property must match
`ctx.getActorUri(identifier)`. Ensure you're using the correct context method.
~~~~

See also
--------

- [`@fedify/lint` on JSR](https://jsr.io/@fedify/lint)
- [`@fedify/lint` on npm](https://www.npmjs.com/package/@fedify/lint)
- [Deno Lint plugins documentation](https://docs.deno.com/runtime/reference/lint_plugins/)
- [ESLint documentation](https://eslint.org/)
- [Example project](https://github.com/fedify-dev/fedify/tree/main/examples/lint)
