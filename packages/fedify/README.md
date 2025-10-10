<!-- deno-fmt-ignore-file -->

![](./logo.svg)
Fedify: an ActivityPub server framework
=======================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![GitHub Actions][GitHub Actions badge]][GitHub Actions]
[![Matrix][Matrix badge]][Matrix]
[![Discord][Discord badge]][Discord]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

> [!NOTE]
> Looking for a quick demo?  Here it is: [Fedify Demo] on Deno Playground.

Fedify is a TypeScript library for building federated server apps
powered by [ActivityPub] and other standards, so-called [fediverse].[^1]
It aims to eliminate the complexity and redundant boilerplate code when
building a federated server app, so that you can focus on your business logic
and user experience.

Currently, Fedify provides the following features out of the box:

 -  Type-safe objects for [Activity Vocabulary] (including some vendor-specific
    extensions)
 -  [WebFinger] client and server
 -  [HTTP Signatures] & [HTTP Message Signatures]
 -  [Object Integrity Proofs][FEP-8b32] & [Linked Data Signatures]
 -  Middlewares for handling webhooks
 -  [NodeInfo] protocol
 -  Special touch for interoperability with Mastodon and few other popular
    fediverse software
 -  Integration with various web frameworks
 -  CLI toolchain for testing and debugging

If you want to know more about the project, please take a look at the following
resources:

 -  [Installation](https://fedify.dev/install)
 -  Tutorials:
    [Learning the basics](https://fedify.dev/tutorial/basics) &
    [Creating a microblog](https://fedify.dev/tutorial/microblog)
 -  [API reference][JSR]
 -  [Examples](https://github.com/fedify-dev/fedify/tree/main/examples)

If you have any questions, suggestions, or feedback, please feel free to
join our [Matrix chat space][Matrix] or [Discord server][Discord] or
[GitHub Discussions].  Or tag [#Fedify] in the fediverse!

[^1]: You may already know some of the networks in the fediverse, such as
      [Mastodon], [Lemmy], [Pixelfed], [PeerTube], and so on.

[JSR]: https://jsr.io/@fedify/fedify
[JSR badge]: https://jsr.io/badges/@fedify/fedify
[npm]: https://www.npmjs.com/package/@fedify/fedify
[npm badge]: https://img.shields.io/npm/v/@fedify/fedify?logo=npm
[GitHub Actions]: https://github.com/fedify-dev/fedify/actions/workflows/build.yaml
[GitHub Actions badge]: https://github.com/fedify-dev/fedify/actions/workflows/build.yaml/badge.svg
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[Matrix badge]: https://img.shields.io/matrix/fedify%3Amatrix.org?logo=matrix
[Discord]: https://discord.gg/bhtwpzURwd
[Discord badge]: https://img.shields.io/discord/1295652627505217647?logo=discord&cacheSeconds=60
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify Demo]: https://dash.deno.com/playground/fedify-demo
[ActivityPub]: https://www.w3.org/TR/activitypub/
[fediverse]: https://en.wikipedia.org/wiki/Fediverse
[Activity Vocabulary]: https://www.w3.org/TR/activitystreams-vocabulary/
[WebFinger]: https://datatracker.ietf.org/doc/html/rfc7033
[HTTP Signatures]: https://tools.ietf.org/html/draft-cavage-http-signatures-12
[HTTP Message Signatures]: https://www.rfc-editor.org/rfc/rfc9421
[FEP-8b32]: https://w3id.org/fep/8b32
[Linked Data Signatures]: https://web.archive.org/web/20170923124140/https://w3c-dvcg.github.io/ld-signatures/
[NodeInfo]: https://nodeinfo.diaspora.software/
[GitHub Discussions]: https://github.com/fedify-dev/fedify/discussions
[#Fedify]: https://mastodon.social/tags/fedify
[Mastodon]: https://joinmastodon.org/
[Lemmy]: https://join-lemmy.org/
[Pixelfed]: https://pixelfed.org/
[PeerTube]: https://joinpeertube.org/


Packages
--------

Fedify is a monorepo that contains several packages, each of which provides
different features and functionalities.  The main package is *@fedify/fedify*,
which provides the core functionality of the framework.  Other packages provide
integrations with various web frameworks, database drivers, and other features.
Here is the list of packages:

| Package                                   | JSR                          | npm                          | Description                             |
| ---------------------------------------   | ---------------------------- | ---------------------------- | --------------------------------------- |
| [@fedify/fedify](/packages/fedify/)       | [JSR]                        | [npm]                        | The core framework of Fedify            |
| [@fedify/cli](/packages/cli/)             | [JSR][jsr:@fedify/cli]       | [npm][npm:@fedify/cli]       | CLI toolchain for testing and debugging |
| [@fedify/amqp](/packages/amqp/)           | [JSR][jsr:@fedify/amqp]      | [npm][npm:@fedify/amqp]      | AMQP/RabbitMQ driver                    |
| [@fedify/cfworkers](/packages/cfworkers/) | [JSR][jsr:@fedify/cfworkers] | [npm][npm:@fedify/cfworkers] | Cloudflare Workers integration          |
| [@fedify/denokv](/packages/denokv/)       | [JSR][jsr:@fedify/denokv]    |                              | Deno KV integration                     |
| [@fedify/elysia](/packages/elysia/)       |                              | [npm][npm:@fedify/elysia]    | Elysia integration                      |
| [@fedify/express](/packages/express/)     | [JSR][jsr:@fedify/express]   | [npm][npm:@fedify/express]   | Express integration                     |
| [@fedify/h3](/packages/h3/)               | [JSR][jsr:@fedify/h3]        | [npm][npm:@fedify/h3]        | H3 integration                          |
| [@fedify/hono](/packages/hono/)           | [JSR][jsr:@fedify/hono]      | [npm][npm:@fedify/hono]      | Hono integration                        |
| [@fedify/koa](/packages/koa/)             | [JSR][jsr:@fedify/koa]       | [npm][npm:@fedify/koa]       | Koa integration                         |
| [@fedify/nestjs](/packages/nestjs/)       |                              | [npm][npm:@fedify/nestjs]    | NestJS integration                      |
| [@fedify/next](/packages/next/)           |                              | [npm][npm:@fedify/next]      | Next.js integration                     |
| [@fedify/postgres](/packages/postgres/)   | [JSR][jsr:@fedify/postgres]  | [npm][npm:@fedify/postgres]  | PostgreSQL driver                       |
| [@fedify/redis](/packages/redis/)         | [JSR][jsr:@fedify/redis]     | [npm][npm:@fedify/redis]     | Redis driver                            |
| [@fedify/sqlite](/packages/sqlite/)       | [JSR][jsr:@fedify/sqlite]    | [npm][npm:@fedify/sqlite]    | SQLite driver                           |
| [@fedify/sveltekit](/packages/sveltekit/) | [JSR][jsr:@fedify/sveltekit] | [npm][npm:@fedify/sveltekit] | SvelteKit integration                   |
| [@fedify/testing](/packages/testing/)     | [JSR][jsr:@fedify/testing]   | [npm][npm:@fedify/testing]   | Testing utilities                       |

[jsr:@fedify/cli]: https://jsr.io/@fedify/cli
[npm:@fedify/cli]: https://www.npmjs.com/package/@fedify/cli
[jsr:@fedify/amqp]: https://jsr.io/@fedify/amqp
[npm:@fedify/amqp]: https://www.npmjs.com/package/@fedify/amqp
[jsr:@fedify/cfworkers]: https://jsr.io/@fedify/cfworkers
[npm:@fedify/cfworkers]: https://www.npmjs.com/package/@fedify/cfworkers
[jsr:@fedify/denokv]: https://jsr.io/@fedify/denokv
[npm:@fedify/elysia]: https://www.npmjs.com/package/@fedify/elysia
[jsr:@fedify/express]: https://jsr.io/@fedify/express
[npm:@fedify/express]: https://www.npmjs.com/package/@fedify/express
[jsr:@fedify/h3]: https://jsr.io/@fedify/h3
[npm:@fedify/h3]: https://www.npmjs.com/package/@fedify/h3
[jsr:@fedify/hono]: https://jsr.io/@fedify/hono
[npm:@fedify/hono]: https://www.npmjs.com/package/@fedify/hono
[jsr:@fedify/koa]: https://jsr.io/@fedify/koa
[npm:@fedify/koa]: https://www.npmjs.com/package/@fedify/koa
[npm:@fedify/nestjs]: https://www.npmjs.com/package/@fedify/nestjs
[npm:@fedify/next]: https://www.npmjs.com/package/@fedify/next
[jsr:@fedify/postgres]: https://jsr.io/@fedify/postgres
[npm:@fedify/postgres]: https://www.npmjs.com/package/@fedify/postgres
[jsr:@fedify/redis]: https://jsr.io/@fedify/redis
[npm:@fedify/redis]: https://www.npmjs.com/package/@fedify/redis
[jsr:@fedify/sqlite]: https://jsr.io/@fedify/sqlite
[npm:@fedify/sqlite]: https://www.npmjs.com/package/@fedify/sqlite
[jsr:@fedify/sveltekit]: https://jsr.io/@fedify/sveltekit
[npm:@fedify/sveltekit]: https://www.npmjs.com/package/@fedify/sveltekit
[jsr:@fedify/testing]: https://jsr.io/@fedify/testing
[npm:@fedify/testing]: https://www.npmjs.com/package/@fedify/testing


Sponsors
--------

This project exists thanks to all the people who contribute, donate, and sponsor
it.  We are grateful for their support.  We would like to thank the following
financial contributors:[^2]

[^2]: Those lists are automatically updated every hour.

<!-- cSpell: disable -->
<!-- DO NOT EDIT(h3): this section is automatically generated by the script -->

### Corporate sponsors

- [<img src="https://images.opencollective.com/ghost/avatar/128.png" width="64" height="64"> Ghost](https://ghost.org)

### Supporters

- [Daniel Supernault](https://pixelfed.org/)
- [tkgka](https://opencollective.com/tkgka)
- [Blaine](https://opencollective.com/blaine)
- [Erick González Aguilar](https://opencollective.com/erick-gonzalez-aguilar)

### Backers

Robin Riley, yamanoku, Encyclia, taye, okin, Andy Piper, box464, Evan Prodromou, Rafael Goulart, malte

### One-time donations

Robin Riley, Markus P, Nils Bergmann, Rameez

<!-- /DO NOT EDIT -->
<!-- cSpell: enable -->

### Become a sponsor

We welcome financial contributions to help us maintain and improve this project.
If you would like to become a financial contributor, please visit our
[Open Collective].

[Open Collective]: https://opencollective.com/fedify
