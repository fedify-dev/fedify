What is Fedify?
===============

Fedify is a TypeScript library for building federated server apps
powered by [ActivityPub] and other standards, so-called [fediverse].[^1]
It aims to eliminate the complexity and boilerplate code when
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
 -  Enhanced interoperability with Mastodon and other popular fediverse
    software
 -  [Integration with various web frameworks](./manual/integration.md)
 -  [CLI toolchain for testing and debugging](./cli.md)

If you want to know more about the project, please take a look at the following
resources:

 -  [GitHub]
 -  Tutorials: [Learning the basics](./tutorial/basics.md) &
    [Creating a microblog](./tutorial/microblog.md)
 -  [API reference]
 -  [Examples]

If you have any questions, suggestions, or feedback, please feel free to
join our [Matrix chat space] or [Discord server] or [GitHub Discussions].

[^1]: You may already know some of the networks in the fediverse, such as
      [Mastodon], [Lemmy], [Pixelfed], [PeerTube], and so on.

[ActivityPub]: https://www.w3.org/TR/activitypub/
[fediverse]: https://en.wikipedia.org/wiki/Fediverse
[Activity Vocabulary]: https://www.w3.org/TR/activitystreams-vocabulary/
[WebFinger]: https://datatracker.ietf.org/doc/html/rfc7033
[HTTP Signatures]: https://tools.ietf.org/html/draft-cavage-http-signatures-12
[HTTP Message Signatures]: https://www.rfc-editor.org/rfc/rfc9421
[FEP-8b32]: https://w3id.org/fep/8b32
[Linked Data Signatures]: https://web.archive.org/web/20170923124140/https://w3c-dvcg.github.io/ld-signatures/
[NodeInfo]: https://nodeinfo.diaspora.software/
[GitHub]: https://github.com/fedify-dev/fedify
[API reference]: https://jsr.io/@fedify/fedify
[Examples]: https://github.com/fedify-dev/fedify/tree/main/examples
[Matrix chat space]: https://matrix.to/#/#fedify:matrix.org
[Discord server]: https://discord.gg/bhtwpzURwd
[GitHub Discussions]: https://github.com/fedify-dev/fedify/discussions

[Mastodon]: https://joinmastodon.org/
[Lemmy]: https://join-lemmy.org/
[Pixelfed]: https://pixelfed.org/
[PeerTube]: https://joinpeertube.org/
