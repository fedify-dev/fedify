@fedify/init: Project initializer for Fedify
============================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]

This package provides the project initialization functionality for [Fedify],
an ActivityPub server framework.  It scaffolds new Fedify project directories
with support for various web frameworks, package managers, key-value stores,
and message queues.

This package powers the `fedify init` command in the [`@fedify/cli`] toolchain,
and can also be used as a standalone library.

[JSR badge]: https://jsr.io/badges/@fedify/init
[JSR]: https://jsr.io/@fedify/init
[npm badge]: https://img.shields.io/npm/v/@fedify/init?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/init
[Fedify]: https://fedify.dev/
[`@fedify/cli`]: https://jsr.io/@fedify/cli


Supported options
-----------------

The initializer supports the following project configurations:

 -  **Web frameworks**: Bare-bones, [Astro], [Elysia], [Express], [Hono],
    [Next.js], [Nitro], [Nuxt], [SolidStart], [SvelteKit]
 -  **Package managers**: Deno, pnpm, Bun, Yarn, npm
 -  **Key-value stores**: In-Memory, Redis, PostgreSQL, Deno KV (deprecated;
    Deno only)
 -  **Message queues**: In-Process, Redis, PostgreSQL, AMQP, Deno KV
    (deprecated; Deno only)

[Astro]: https://astro.build/
[Elysia]: https://elysiajs.com/
[Express]: https://expressjs.com/
[Hono]: https://hono.dev/
[Next.js]: https://nextjs.org/
[Nitro]: https://nitro.build/
[Nuxt]: https://nuxt.com/
[SolidStart]: https://start.solidjs.com/
[SvelteKit]: https://svelte.dev/


Installation
------------

~~~~ sh
deno add jsr:@fedify/init  # Deno
npm  add     @fedify/init  # npm
pnpm add     @fedify/init  # pnpm
yarn add     @fedify/init  # Yarn
bun  add     @fedify/init  # Bun
~~~~


API
---

The package exports the following:

 -  `runInit`: The main initialization action handler.
 -  `initCommand`: The CLI command definition for `init`.

~~~~ typescript
import { initCommand, runInit } from "@fedify/init";
~~~~


Test
----

The `test:init` task is useful for contributors working on `@fedify/init`,
especially when adding support for a new framework/library or modifying the
scaffolding logic.  It tests the project initialization by running
`fedify init` across all combinations of supported options in temporary
directories, verifying that the generated projects are valid.

The harness runs on Node.js 22.18 or later, using
`--experimental-transform-types` for the initializer source.  The default
matrix includes Deno projects and requires Deno as well.  To run it, use the
mise task from the repository root:

~~~~ sh
mise run test:init
~~~~

You can also filter specific options to test a subset of combinations:

~~~~ sh
mise run test:init -- -w hono -p npm -k in-memory -m in-process
mise run test:init -- -w hono -p deno
~~~~

The first command tests only Node.js targets and needs no Deno executable or
cache.  The second tests the Hono targets that use Deno.

Use `--no-dry-run` to test with actual file creation and dependency
installation, or `--no-hyd-run` to preview generation without scaffolding apps
or installing dependencies.  The harness writes log files for both modes.
