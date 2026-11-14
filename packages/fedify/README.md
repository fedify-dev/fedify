![](./logo.svg) Fedify: an ActivityPub server framework
=======================================================

[![npm][npm badge]][npm]
[![JSR][JSR badge]][JSR]
[![GitHub Actions][GitHub Actions badge]][GitHub Actions]
[![Matrix][Matrix badge]][Matrix]
[![@fedify@hackers.pub][@fedify@hackers.pub badge]][@fedify@hackers.pub]

Fedify is a TypeScript library for building federated server apps
powered by [ActivityPub] and other standards, so-called [fediverse].[^1]
It aims to eliminate the complexity and boilerplate code when
building a federated server app, so that you can focus on your business logic
and user experience.

Fedify supports Node.js, Bun, and Deno.  We recommend using the latest
version of Node.js for the best experience.

Currently, Fedify provides the following features out of the box:

 -  Type-safe objects for [Activity Vocabulary] (including some vendor-specific
    extensions)
 -  [WebFinger] client and server
 -  [HTTP Signatures] & [HTTP Message Signatures]
 -  [Object Integrity Proofs][FEP-8b32] & [Linked Data Signatures]
 -  Middlewares for handling webhooks
 -  [NodeInfo] protocol
 -  Enhanced interoperability with Mastodon and other popular fediverse
    software
 -  Integration with various web frameworks
 -  CLI toolchain for testing and debugging

If you want to know more about the project, please take a look at the following
resources:

 -  [Installation]
 -  Tutorials
     -  [Learning the basics of Fedify]
     -  [Creating your own federated microblog]
     -  [Creating a federated image sharing service]
     -  [Building a federated blog]
     -  [Building a threadiverse community platform]
 -  [Migrating from other libraries]
 -  [API reference][JSR]
 -  [Examples]

If you have any questions, suggestions, or feedback, please feel free to
join our [Matrix chat space][Matrix] or [GitHub Discussions].  Or tag [#Fedify]
in the fediverse!

[^1]: You may already know some of the networks in the fediverse, such as
      [Mastodon], [Lemmy], [Pixelfed], [PeerTube], and so on.

[npm badge]: https://img.shields.io/npm/v/@fedify/fedify?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/fedify
[JSR badge]: https://jsr.io/badges/@fedify/fedify
[JSR]: https://jsr.io/@fedify/fedify
[GitHub Actions badge]: https://github.com/fedify-dev/fedify/actions/workflows/build.yaml/badge.svg
[GitHub Actions]: https://github.com/fedify-dev/fedify/actions/workflows/build.yaml
[Matrix badge]: https://img.shields.io/matrix/fedify%3Amatrix.org?logo=matrix
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[@fedify@hackers.pub badge]: https://fedi-badge.minhee.org/@fedify@hackers.pub/followers.svg
[@fedify@hackers.pub]: https://hackers.pub/@fedify
[ActivityPub]: https://www.w3.org/TR/activitypub/
[fediverse]: https://en.wikipedia.org/wiki/Fediverse
[Activity Vocabulary]: https://www.w3.org/TR/activitystreams-vocabulary/
[WebFinger]: https://datatracker.ietf.org/doc/html/rfc7033
[HTTP Signatures]: https://tools.ietf.org/html/draft-cavage-http-signatures-12
[HTTP Message Signatures]: https://www.rfc-editor.org/rfc/rfc9421
[FEP-8b32]: https://w3id.org/fep/8b32
[Linked Data Signatures]: https://web.archive.org/web/20170923124140/https://w3c-dvcg.github.io/ld-signatures/
[NodeInfo]: https://nodeinfo.diaspora.software/
[Installation]: https://fedify.dev/install
[Learning the basics of Fedify]: https://fedify.dev/tutorial/basics
[Creating your own federated microblog]: https://fedify.dev/tutorial/microblog
[Creating a federated image sharing service]: https://fedify.dev/tutorial/content-sharing
[Building a federated blog]: https://fedify.dev/tutorial/astro-blog
[Building a threadiverse community platform]: https://fedify.dev/tutorial/threadiverse
[Migrating from other libraries]: https://fedify.dev/manual/migrate
[Examples]: https://github.com/fedify-dev/fedify/tree/main/examples
[GitHub Discussions]: https://github.com/fedify-dev/fedify/discussions
[#Fedify]: https://mastodon.social/tags/fedify

[Mastodon]: https://joinmastodon.org/
[Lemmy]: https://join-lemmy.org/
[Pixelfed]: https://pixelfed.org/
[PeerTube]: https://joinpeertube.org/


Packages
--------

Fedify is a monorepo that contains several packages, each of which provides
different features.  The main package is *@fedify/fedify*,
which provides the core functionality of the framework.  Other packages provide
integrations with various web frameworks, database drivers, and other features.
Here is the list of packages:

| Package                                                         | npm                                     | JSR                                     | Description                              |
| --------------------------------------------------------------- | --------------------------------------- | --------------------------------------- | ---------------------------------------- |
| [@fedify/fedify](/packages/fedify/)                             | [npm]                                   | [JSR]                                   | The core framework of Fedify             |
| [@fedify/cli](/packages/cli/)                                   | [npm][npm:@fedify/cli]                  | [JSR][jsr:@fedify/cli]                  | CLI toolchain for testing and debugging  |
| [@fedify/create](/packages/create/)                             | [npm][npm:@fedify/create]               |                                         | Create a new Fedify project              |
| [@fedify/adonisjs](/packages/adonisjs/)                         | [npm][npm:@fedify/adonisjs]             |                                         | AdonisJS integration                     |
| [@fedify/amqp](/packages/amqp/)                                 | [npm][npm:@fedify/amqp]                 | [JSR][jsr:@fedify/amqp]                 | AMQP/RabbitMQ driver                     |
| [@fedify/astro](/packages/astro/)                               | [npm][npm:@fedify/astro]                | [JSR][jsr:@fedify/astro]                | Astro integration                        |
| [@fedify/backfill](/packages/backfill/)                         | [npm][npm:@fedify/backfill]             | [JSR][jsr:@fedify/backfill]             | ActivityPub backfill support             |
| [@fedify/cfworkers](/packages/cfworkers/)                       | [npm][npm:@fedify/cfworkers]            | [JSR][jsr:@fedify/cfworkers]            | Cloudflare Workers integration           |
| [@fedify/debugger](/packages/debugger/)                         | [npm][npm:@fedify/debugger]             | [JSR][jsr:@fedify/debugger]             | Embedded ActivityPub debug dashboard     |
| [@fedify/denokv](/packages/denokv/)                             |                                         | [JSR][jsr:@fedify/denokv]               | Deno KV integration (deprecated)         |
| [@fedify/elysia](/packages/elysia/)                             | [npm][npm:@fedify/elysia]               |                                         | Elysia integration                       |
| [@fedify/express](/packages/express/)                           | [npm][npm:@fedify/express]              | [JSR][jsr:@fedify/express]              | Express integration                      |
| [@fedify/fastify](/packages/fastify/)                           | [npm][npm:@fedify/fastify]              | [JSR][jsr:@fedify/fastify]              | Fastify integration                      |
| [@fedify/fresh](/packages/fresh/)                               |                                         | [JSR][jsr:@fedify/fresh]                | Fresh integration                        |
| [@fedify/h3](/packages/h3/)                                     | [npm][npm:@fedify/h3]                   | [JSR][jsr:@fedify/h3]                   | H3 integration                           |
| [@fedify/hono](/packages/hono/)                                 | [npm][npm:@fedify/hono]                 | [JSR][jsr:@fedify/hono]                 | Hono integration                         |
| [@fedify/init](/packages/init/)                                 | [npm][npm:@fedify/init]                 | [JSR][jsr:@fedify/init]                 | Project initializer for Fedify           |
| [@fedify/interaction-controls](/packages/interaction-controls/) | [npm][npm:@fedify/interaction-controls] | [JSR][jsr:@fedify/interaction-controls] | Interaction control helpers              |
| [@fedify/koa](/packages/koa/)                                   | [npm][npm:@fedify/koa]                  | [JSR][jsr:@fedify/koa]                  | Koa integration                          |
| [@fedify/lint](/packages/lint/)                                 | [npm][npm:@fedify/lint]                 | [JSR][jsr:@fedify/lint]                 | Linting utilities                        |
| [@fedify/nestjs](/packages/nestjs/)                             | [npm][npm:@fedify/nestjs]               |                                         | NestJS integration                       |
| [@fedify/next](/packages/next/)                                 | [npm][npm:@fedify/next]                 |                                         | Next.js integration                      |
| [@fedify/nuxt](/packages/nuxt/)                                 | [npm][npm:@fedify/nuxt]                 | [JSR][jsr:@fedify/nuxt]                 | Nuxt integration                         |
| [@fedify/mysql](/packages/mysql/)                               | [npm][npm:@fedify/mysql]                | [JSR][jsr:@fedify/mysql]                | MySQL/MariaDB driver                     |
| [@fedify/netlify](/packages/netlify/)                           | [npm][npm:@fedify/netlify]              | [JSR][jsr:@fedify/netlify]              | Netlify Async Workloads integration      |
| [@fedify/pglite](/packages/pglite/)                             | [npm][npm:@fedify/pglite]               | [JSR][jsr:@fedify/pglite]               | PGlite driver                            |
| [@fedify/postgres](/packages/postgres/)                         | [npm][npm:@fedify/postgres]             | [JSR][jsr:@fedify/postgres]             | PostgreSQL driver                        |
| [@fedify/redis](/packages/redis/)                               | [npm][npm:@fedify/redis]                | [JSR][jsr:@fedify/redis]                | Redis driver                             |
| [@fedify/relay](/packages/relay/)                               | [npm][npm:@fedify/relay]                | [JSR][jsr:@fedify/relay]                | ActivityPub relay support                |
| [@fedify/solidstart](/packages/solidstart/)                     | [npm][npm:@fedify/solidstart]           | [JSR][jsr:@fedify/solidstart]           | SolidStart integration                   |
| [@fedify/sqlite](/packages/sqlite/)                             | [npm][npm:@fedify/sqlite]               | [JSR][jsr:@fedify/sqlite]               | SQLite driver                            |
| [@fedify/sveltekit](/packages/sveltekit/)                       | [npm][npm:@fedify/sveltekit]            | [JSR][jsr:@fedify/sveltekit]            | SvelteKit integration                    |
| [@fedify/testing](/packages/testing/)                           | [npm][npm:@fedify/testing]              | [JSR][jsr:@fedify/testing]              | Testing utilities                        |
| [@fedify/uri-template](/packages/uri-template/)                 | [npm][npm:@fedify/uri-template]         | [JSR][jsr:@fedify/uri-template]         | RFC 6570 URI Template library            |
| [@fedify/vocab](/packages/vocab/)                               | [npm][npm:@fedify/vocab]                | [JSR][jsr:@fedify/vocab]                | Activity Vocabulary library              |
| [@fedify/vocab-runtime](/packages/vocab-runtime/)               | [npm][npm:@fedify/vocab-runtime]        | [JSR][jsr:@fedify/vocab-runtime]        | Runtime library for code-generated vocab |
| [@fedify/vocab-tools](/packages/vocab-tools/)                   | [npm][npm:@fedify/vocab-tools]          | [JSR][jsr:@fedify/vocab-tools]          | Code generation tools for Activity Vocab |
| [@fedify/webfinger](/packages/webfinger/)                       | [npm][npm:@fedify/webfinger]            | [JSR][jsr:@fedify/webfinger]            | WebFinger client library for ActivityPub |

[npm:@fedify/cli]: https://www.npmjs.com/package/@fedify/cli
[jsr:@fedify/cli]: https://jsr.io/@fedify/cli
[npm:@fedify/create]: https://www.npmjs.com/package/@fedify/create
[npm:@fedify/adonisjs]: https://www.npmjs.com/package/@fedify/adonisjs
[npm:@fedify/amqp]: https://www.npmjs.com/package/@fedify/amqp
[jsr:@fedify/amqp]: https://jsr.io/@fedify/amqp
[npm:@fedify/astro]: https://www.npmjs.com/package/@fedify/astro
[jsr:@fedify/astro]: https://jsr.io/@fedify/astro
[npm:@fedify/backfill]: https://www.npmjs.com/package/@fedify/backfill
[jsr:@fedify/backfill]: https://jsr.io/@fedify/backfill
[npm:@fedify/cfworkers]: https://www.npmjs.com/package/@fedify/cfworkers
[jsr:@fedify/cfworkers]: https://jsr.io/@fedify/cfworkers
[npm:@fedify/debugger]: https://www.npmjs.com/package/@fedify/debugger
[jsr:@fedify/debugger]: https://jsr.io/@fedify/debugger
[jsr:@fedify/denokv]: https://jsr.io/@fedify/denokv
[npm:@fedify/elysia]: https://www.npmjs.com/package/@fedify/elysia
[npm:@fedify/express]: https://www.npmjs.com/package/@fedify/express
[jsr:@fedify/express]: https://jsr.io/@fedify/express
[npm:@fedify/fastify]: https://www.npmjs.com/package/@fedify/fastify
[jsr:@fedify/fastify]: https://jsr.io/@fedify/fastify
[jsr:@fedify/fresh]: https://jsr.io/@fedify/fresh
[npm:@fedify/h3]: https://www.npmjs.com/package/@fedify/h3
[jsr:@fedify/h3]: https://jsr.io/@fedify/h3
[npm:@fedify/hono]: https://www.npmjs.com/package/@fedify/hono
[jsr:@fedify/hono]: https://jsr.io/@fedify/hono
[npm:@fedify/init]: https://www.npmjs.com/package/@fedify/init
[jsr:@fedify/init]: https://jsr.io/@fedify/init
[npm:@fedify/interaction-controls]: https://www.npmjs.com/package/@fedify/interaction-controls
[jsr:@fedify/interaction-controls]: https://jsr.io/@fedify/interaction-controls
[npm:@fedify/koa]: https://www.npmjs.com/package/@fedify/koa
[jsr:@fedify/koa]: https://jsr.io/@fedify/koa
[npm:@fedify/lint]: https://www.npmjs.com/package/@fedify/lint
[jsr:@fedify/lint]: https://jsr.io/@fedify/lint
[npm:@fedify/nestjs]: https://www.npmjs.com/package/@fedify/nestjs
[npm:@fedify/next]: https://www.npmjs.com/package/@fedify/next
[npm:@fedify/nuxt]: https://www.npmjs.com/package/@fedify/nuxt
[jsr:@fedify/nuxt]: https://jsr.io/@fedify/nuxt
[npm:@fedify/mysql]: https://www.npmjs.com/package/@fedify/mysql
[jsr:@fedify/mysql]: https://jsr.io/@fedify/mysql
[npm:@fedify/netlify]: https://www.npmjs.com/package/@fedify/netlify
[jsr:@fedify/netlify]: https://jsr.io/@fedify/netlify
[npm:@fedify/pglite]: https://www.npmjs.com/package/@fedify/pglite
[jsr:@fedify/pglite]: https://jsr.io/@fedify/pglite
[npm:@fedify/postgres]: https://www.npmjs.com/package/@fedify/postgres
[jsr:@fedify/postgres]: https://jsr.io/@fedify/postgres
[npm:@fedify/redis]: https://www.npmjs.com/package/@fedify/redis
[jsr:@fedify/redis]: https://jsr.io/@fedify/redis
[npm:@fedify/relay]: https://www.npmjs.com/package/@fedify/relay
[jsr:@fedify/relay]: https://jsr.io/@fedify/relay
[npm:@fedify/solidstart]: https://www.npmjs.com/package/@fedify/solidstart
[jsr:@fedify/solidstart]: https://jsr.io/@fedify/solidstart
[npm:@fedify/sqlite]: https://www.npmjs.com/package/@fedify/sqlite
[jsr:@fedify/sqlite]: https://jsr.io/@fedify/sqlite
[npm:@fedify/sveltekit]: https://www.npmjs.com/package/@fedify/sveltekit
[jsr:@fedify/sveltekit]: https://jsr.io/@fedify/sveltekit
[npm:@fedify/testing]: https://www.npmjs.com/package/@fedify/testing
[jsr:@fedify/testing]: https://jsr.io/@fedify/testing
[npm:@fedify/uri-template]: https://www.npmjs.com/package/@fedify/uri-template
[jsr:@fedify/uri-template]: https://jsr.io/@fedify/uri-template
[npm:@fedify/vocab]: https://www.npmjs.com/package/@fedify/vocab
[jsr:@fedify/vocab]: https://jsr.io/@fedify/vocab
[npm:@fedify/vocab-runtime]: https://www.npmjs.com/package/@fedify/vocab-runtime
[jsr:@fedify/vocab-runtime]: https://jsr.io/@fedify/vocab-runtime
[npm:@fedify/vocab-tools]: https://www.npmjs.com/package/@fedify/vocab-tools
[jsr:@fedify/vocab-tools]: https://jsr.io/@fedify/vocab-tools
[npm:@fedify/webfinger]: https://www.npmjs.com/package/@fedify/webfinger
[jsr:@fedify/webfinger]: https://jsr.io/@fedify/webfinger


Sponsors
--------

This project exists thanks to all the people who contribute, donate, and sponsor
it.  We are grateful for their support.  We would like to thank the following
financial contributors:[^2]

[^2]: Those lists are automatically updated twice a day.

<!-- hongdown-disable -->

<!-- cSpell: disable -->

<!-- DO NOT EDIT(h3): this section is automatically generated by the script -->

### Corporate sponsors

| Avatar | Name | Description |
| ------ | ---- | ----------- |
| <img src="https://images.opencollective.com/ghost/avatar/128.png" width="64" height="64"> | [Ghost](https://ghost.org) | Fiercely independent, professional publishing |
| <img src="https://images.opencollective.com/altstore/avatar/128.png" width="64" height="64"> | [AltStore](https://altstore.io) |  |

### Supporters

- [tkgka](https://opencollective.com/tkgka)
- [Blaine](https://opencollective.com/blaine)
- [Erick González Aguilar](https://opencollective.com/erick-gonzalez-aguilar)
- [Daniel Supernault](https://pixelfed.org/)

### Backers

Encyclia, Robin Riley, box464, Evan Prodromou, taye, okin, yamanoku, malte, Rafael Goulart, Andy Piper

### One-time donations

Robin Riley, malte, Nils Bergmann, Markus P, Rameez, nyanrus, Guest, Guest, 1, Guest, Guest, Guest, Guest, Guest, Guest, Guest, Guest, Guest, 1, 1, Wil

<!-- /DO NOT EDIT -->

<!-- cSpell: enable -->

<!-- hongdown-enable -->

### Become a sponsor

We welcome financial contributions to help us maintain and improve this project.
If you would like to become a financial contributor, please visit our
[Open Collective].

[Open Collective]: https://opencollective.com/fedify
