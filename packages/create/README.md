@fedify/create: Create a new Fedify project
===========================================

[![npm][npm badge]][npm]

This package provides a standalone CLI tool for creating new [Fedify] projects.
It allows you to scaffold a new project without installing the full
[`@fedify/cli`] toolchain, powered by [`@fedify/init`] internally.

[npm badge]: https://img.shields.io/npm/v/@fedify/create?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/create
[Fedify]: https://fedify.dev/
[`@fedify/cli`]: https://jsr.io/@fedify/cli
[`@fedify/init`]: https://jsr.io/@fedify/init


Usage
-----

~~~~ sh
npm init @fedify my-project
pnpm create @fedify my-project
yarn create @fedify my-project
bunx @fedify/create my-project
~~~~


Supported options
-----------------

The tool supports the same project configurations as `fedify init`:

 -  **Web frameworks**: [Hono], [Nitro], [Next.js], [Elysia], [Express]
 -  **Package managers**: Deno, pnpm, Bun, Yarn, npm
 -  **Key-value stores**: Deno KV, Redis, PostgreSQL
 -  **Message queues**: Deno KV, Redis, PostgreSQL, AMQP

See the [`@fedify/init`] package or the [Fedify CLI docs] for details on
available options (`-r`, `-p`, `-w`, `-k`, `-q`, `--dry-run`).

[Hono]: https://hono.dev/
[Nitro]: https://nitro.build/
[Next.js]: https://nextjs.org/
[Elysia]: https://elysiajs.com/
[Express]: https://expressjs.com/
[Fedify CLI docs]: https://fedify.dev/cli
