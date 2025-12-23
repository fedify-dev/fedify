<!-- deno-fmt-ignore-file -->

@fedify/lint: ESLint plugin for Fedify
=======================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

*This package is available since Fedify 2.0.0.*

This package provides [Deno Lint] and [ESLint] plugin with lint rules specifically designed
for [Fedify] applications.  It helps you catch common mistakes and enforce
best practices when building federated server apps with Fedify.

The plugin includes rules that check for:

 -  Proper actor ID configuration
 -  Required actor properties (inbox, outbox, followers, etc.)
 -  Correct URL patterns for actor collections
 -  Public key and assertion method requirements
 -  Collection filtering implementation


### Deno Lint Configuration Example

~~~~ typescript
// deno.json

{
  "lint": {
    "plugins": {
      "@fedify/lint": "jsr:@fedify/lint"
    },
    "rules": {
      "@fedify/lint/actor-id-required": "error",
      "@fedify/lint/actor-id-mismatch": "error",
      "@fedify/lint/actor-inbox-property-required": "warn"
      // ... other rules
    }
  }
}
~~~~

### ESLint Configuration Example

~~~~ typescript
// eslint.config.ts

import fedifyLint from "@fedify/lint";

export default fedifyLint;
~~~~

[JSR]: https://jsr.io/@fedify/lint
[JSR badge]: https://jsr.io/badges/@fedify/lint
[npm]: https://www.npmjs.com/package/@fedify/lint
[npm badge]: https://img.shields.io/npm/v/@fedify/lint?logo=npm
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Deno Lint]: https://docs.deno.com/runtime/reference/lint_plugins/
[ESLint]: https://eslint.org/
[Fedify]: https://fedify.dev/


Features
--------

The `@fedify/lint` package provides comprehensive linting rules for Fedify
federation code:

### Actor Validation Rules

 -  **`actor-id-required`**: Ensures all actors have an `id` property
 -  **`actor-id-mismatch`**: Validates that actor IDs match the expected URI
    from `Context.getActorUri()`
 -  **`actor-public-key-required`**: Ensures actors have public keys for
    HTTP Signatures
 -  **`actor-assertion-method-required`**: Validates assertion methods for
    Object Integrity Proofs

### Collection Property Rules

 -  **`actor-inbox-property-required`**: Ensures inbox is defined when
    `setInboxListeners` is set
 -  **`actor-inbox-property-mismatch`**: Validates inbox URI from `getInboxUri`
 -  **`actor-outbox-property-required`**: Ensures outbox is defined when
    `setOutboxDispatcher` is set
 -  **`actor-outbox-property-mismatch`**: Validates outbox URI from
    `getOutboxUri`
 -  **`actor-followers-property-required`**: Ensures followers is defined when
    `setFollowersDispatcher` is set
 -  **`actor-followers-property-mismatch`**: Validates followers URI from
    `getFollowersUri`
 -  **`actor-following-property-required`**: Ensures following is defined when
    `setFollowingDispatcher` is set
 -  **`actor-following-property-mismatch`**: Validates following URI from
    `getFollowingUri`
 -  **`actor-liked-property-required`**: Ensures liked is defined when
    `setLikedDispatcher` is set
 -  **`actor-liked-property-mismatch`**: Validates liked URI from `getLikedUri`
 -  **`actor-featured-property-required`**: Ensures featured is defined when
    `setFeaturedDispatcher` is set
 -  **`actor-featured-property-mismatch`**: Validates featured URI from
    `getFeaturedUri`
 -  **`actor-featured-tags-property-required`**: Ensures featuredTags is defined
    when `setFeaturedTagsDispatcher` is set
 -  **`actor-featured-tags-property-mismatch`**: Validates featuredTags URI from
    `getFeaturedTagsUri`
 -  **`actor-shared-inbox-property-required`**: Ensures sharedInbox is defined
    when `setInboxListeners` is set
 -  **`actor-shared-inbox-property-mismatch`**: Validates sharedInbox URI from
    `getInboxUri`

### Other Rules

 -  **`collection-filtering-not-implemented`**: Warns about missing collection
    filtering implementation (`setFollowersDispatcher` only for now)


Installation
------------

::: code-group

~~~~ sh [Deno]
deno add jsr:@fedify/lint
~~~~

~~~~ sh [npm]
npm add -D @fedify/lint
~~~~

~~~~ sh [pnpm]
pnpm add -D @fedify/lint
~~~~

~~~~ sh [Yarn]
yarn add -D @fedify/lint
~~~~

~~~~ sh [Bun]
bun add -D @fedify/lint
~~~~

:::


Usage (Deno Lint)
------------------

### Basic Setup

Add the plugin to your *deno.json* configuration file:

~~~~ json
{
  "lint": {
    "plugins": ["jsr:@fedify/lint"]
  }
}
~~~~

By default, this enables all recommended rules.

### Custom Configuration

You can customize which rules to enable and their severity levels:

~~~~ json
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

~~~~ sh
deno lint
~~~~

You can also specify which files to lint:

~~~~ sh
deno lint federation.ts
deno lint src/federation/
~~~~


Usage (ESLint)
--------------

### Basic Setup

Add the plugin to your ESLint configuration file (e.g., *eslint.config.ts*
or *eslint.config.js*):

~~~~ typescript
import fedifyLint from "@fedify/lint";

// If your `createFederation` code is in `federation.ts` or `federation/**.ts`
export default fedifyLint; 

// Or specify your own federation files
export default {
  ...fedifyLint,
  files: ["my-own-federation.ts"],
};

// If you use other ESLint configurations

export default [
  otherConfig,
  fedifyLint,
];
~~~~

The default configuration applies recommended rules to files that match
common federation-related patterns (e.g., *federation.ts*, *federation/\*.ts*).

### Custom Configuration

You can customize which files to lint and which rules to enable:

~~~~ typescript
import { plugin } from "@fedify/lint";

export default [{
  files: ["src/federation/**/*.ts"],  // Your federation code location
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

### Using Configurations

The plugin provides two preset configurations:

#### Recommended (default)

Enables critical rules as errors and optional rules as warnings:

~~~~ typescript
import fedifyLint from "@fedify/lint";

export default fedifyLint;
~~~~

#### Strict

Enables all rules as errors:

~~~~ typescript
import { plugin } from "@fedify/lint";

export default [{
  files: ["**/*.ts"],
  ...plugin.configs.strict,
}];
~~~~


Example
-------

Here's an example of code that would trigger lint errors:

~~~~ typescript
// ❌ Wrong: Using relative URL for actor ID
import { createFederation, Person } from "@fedify/fedify";

const federation = createFederation({ /* ... */ });

federation.setActorDispatcher(
  "/{identifier}",
  (_ctx, identifier) => {
    return new Person({
      id: new URL(`/${identifier}`),  // ❌ Should use ctx.getActorUri()
      name: "Example User",
    });
  },
);
~~~~

Corrected version:

~~~~ typescript
// ✅ Correct: Using Context.getActorUri() for actor ID
import { createFederation, Person } from "@fedify/fedify";

const federation = createFederation({ /* ... */ });

federation.setActorDispatcher(
  "/{identifier}",
  (ctx, identifier) => {
    return new Person({
      id: ctx.getActorUri(identifier),  // ✅ Correct
      name: "Example User",
      inbox: ctx.getInboxUri(identifier),
      outbox: ctx.getOutboxUri(identifier),
      followers: ctx.getFollowersUri(identifier),
      // ... other required properties
    });
  },
);
~~~~


Running the Linter
------------------

### Deno Lint

Run Deno's linter with the plugin enabled:

~~~~ sh
deno lint
~~~~

You can also specify which files or directories to lint:

~~~~ sh
deno lint federation.ts
deno lint src/federation/
~~~~

### ESLint

Set up your ESLint configuration as shown above and add a follwing script on
`package.json`:

~~~~ jsonc
{
  "scripts": {
    "lint": "eslint ."
  }
}
~~~~

After setting up the configuration, run ESLint on your codebase:

::: code-group

~~~~ sh [npm]
npm run lint
~~~~

~~~~ sh [pnpm]
pnpm lint
~~~~

~~~~ sh [Yarn]
yarn lint
~~~~

~~~~ sh [Bun]
bun lint
~~~~

:::

or run the linter directly via command line:

::: code-group

~~~~ sh [npm]
npx eslint .
~~~~

~~~~ sh [pnpm]
pnpx eslint .
~~~~

~~~~ sh [Yarn]
yarn eslint .
~~~~

~~~~ sh [Bun]
bunx eslint .
~~~~

:::

See Also
--------

 -  [Fedify Documentation](https://fedify.dev/)
 -  [ESLint Documentation](https://eslint.org/)
 -  [Example Project](https://github.com/fedify-dev/fedify/tree/main/examples/lint)
