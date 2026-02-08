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

 -  **Web frameworks**: [Hono], [Nitro], [Next.js], [Elysia], [Express]
 -  **Package managers**: Deno, pnpm, Bun, Yarn, npm
 -  **Key-value stores**: Deno KV, Redis, PostgreSQL
 -  **Message queues**: Deno KV, Redis, PostgreSQL, AMQP

[Hono]: https://hono.dev/
[Nitro]: https://nitro.build/
[Next.js]: https://nextjs.org/
[Elysia]: https://elysiajs.com/
[Express]: https://expressjs.com/


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

The `test-init` task is useful for contributors working on `@fedify/init`,
especially when adding support for a new framework/library or modifying the
scaffolding logic.  It tests the project initialization by running
`fedify init` across all combinations of supported options on temporary
directories, verifying that the generated projects are valid.

To run the test using Deno:

~~~~ sh
deno task test-init
~~~~

Or using pnpm:

~~~~ sh
pnpm test-init
~~~~

You can also filter specific options to test a subset of combinations:

~~~~ sh
deno task test-init -w hono -p deno
~~~~

Use `--no-dry-run` to test with actual file creation and dependency
installation, or `--no-hyd-run` to only log outputs without creating files.
