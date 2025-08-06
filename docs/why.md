---
description: >-
  This document explains why you should consider using Fedify for your
  ActivityPub server development.
---

Why Fedify?
===========

Developing a federated application using ActivityPub can be complex and
time-consuming.  While the ActivityPub specification provides a solid foundation
for decentralized social networking, implementing it from scratch presents
significant challenges.  Fedify alleviates these pain points,
allowing developers to focus on their application's unique features rather
than protocol intricacies.


Common pain points when implementing ActivityPub from scratch
-------------------------------------------------------------

Without a framework like Fedify, developers face numerous challenges:

### Technical complexity

Steep learning curve
:   The ActivityPub family of specifications is extensive, covering hundreds of
    pages of technical documentation

JSON-LD complexities
:   Dealing with context resolution, expansion, and compaction manually is
    error-prone

Cryptographic hurdles
:   Implementing HTTP Signatures, key management, and signature verification
    correctly requires specialized knowledge

### Infrastructure requirements

Message delivery reliability
:   Building retry logic, exponential backoff, and failure handling from scratch

Performance bottlenecks
:   Naive message delivery implementations can cause timeouts,
    high memory usage, and server crashes

Scalability issues
:   Direct delivery to thousands of followers can overload your application
    servers

### Federation challenges

Incompatible implementations
:   Different ActivityPub servers interpret the specifications differently,
    requiring implementation-specific adaptations

Evolving ecosystem
:   Federation standards continue to evolve with community extensions and
    conventions

Security vulnerabilities
:   Potential for SSRF attacks, signature forgery, and other security issues
    without careful implementation

### Development overhead

No standardized tools
:   Developers must build their own debugging and testing utilities for
    federation

Reinventing the wheel
:   Common patterns like WebFinger resolution or follower management must be
    reimplemented

Maintenance burden
:   Keeping up with security patches and protocol changes across the fediverse


Protocol complexity and data handling
-------------------------------------

The ActivityPub family of W3C recommendations—including ActivityStreams 2.0,
Activity Vocabulary, and ActivityPub—is extensive and challenging to implement
correctly.  Messages encoded in JSON-LD using the ActivityStreams vocabulary
require careful attention to contexts, IRI resolution, and object serialization.

Fedify provides:

 -  A higher-level abstraction over these protocols
 -  Type-safe TypeScript classes for all standard ActivityStreams types
 -  Utilities for creation, manipulation, and validation of ActivityPub objects


Federation infrastructure
-------------------------

Building an ActivityPub server requires implementing several interconnected
systems:

### Message processing and delivery

Fedify offers a comprehensive solution for managing ActivityPub's inbox/outbox
model:

 -  Robust inbox handlers with activity de-duplication
 -  Configurable message queues with reliable retry mechanisms

### Scalability with fan-out architecture

One of the most challenging aspects of ActivityPub implementation is efficiently
delivering activities to potentially thousands of recipients.  Fedify's
[two-stage delivery process](./manual/send.md#optimizing-activity-delivery-for-large-audiences)
addresses this:

 1. For activities with many recipients, a single consolidated message
    containing the activity and all recipient information is created
 2. A background worker processes this message and re-enqueues individual
    delivery tasks
 3. Each delivery has independent retry logic and error handling

~~~~ mermaid
flowchart TB
    A[Client] -->|Create post| B[Application]
    B -->|Create activity| C[Fedify]

    subgraph "Two-stage delivery process"
        C -->|1\. Single consolidated message| D[(Message Queue)]
        D -->|2\. Process message| E[Fan-out Worker]
        E -->|3\. Create individual delivery tasks| F[(Delivery Queue)]
    end

    F -->|Deliver to recipient 1| G[Remote server 1]
    F -->|Deliver to recipient 2| H[Remote server 2]
    F -->|Deliver to recipient N| I[Remote server N]

    G -.-|Failed? Retry with backoff| F
    H -.-|Failed? Retry with backoff| F
    I -.-|Failed? Retry with backoff| F
~~~~

Benefits include:

 -  Faster API response times for improved UX
 -  Reduced memory consumption through payload deduplication
 -  Configurable fan-out strategies with `"auto"`, `"skip"`, or `"force"` options


Security and interoperability
-----------------------------

Security is paramount in federation, while interoperability across diverse
implementations presents ongoing challenges.

Fedify provides:

 -  Comprehensive cryptographic support (RSA-PKCS#1-v1.5 and Ed25519 keys)
 -  Multiple authentication methods
    ([HTTP Signatures](./manual/send.md#http-signatures),
    [HTTP Message Signatures](./manual/send.md#http-message-signatures),
    [Object Integrity Proofs](./manual/send.md#object-integrity-proofs),
    [Linked Data Signatures](./manual/send.md#linked-data-signatures))
 -  SSRF protection and other security best practices
 -  [Activity transformers](./manual/send.md#activity-transformers) that adjust
    outgoing activities for maximum compatibility
 -  Multi-origin support with canonical URL handling for consistent identity


Technology agnosticism
----------------------

Fedify doesn't force you to use specific technologies, giving you the freedom to
build with your preferred tools.

### Framework flexibility

Works with virtually any JavaScript/TypeScript web framework:

 -  [Express](./manual/integration.md#express)
 -  [Hono](./manual/integration.md#hono)
 -  [Fresh](./manual/integration.md#fresh)
 -  [SvelteKit](./manual/integration.md#sveltekit)
 -  Next.js
 -  [h3](./manual/integration.md#h3)/Nitro

… and many more!

### Database independence

 -  Use any SQL or NoSQL database (PostgreSQL, MySQL, MongoDB, etc.)
 -  Use any ORM (Prisma, TypeORM, Drizzle ORM, etc.)
 -  Fedify only requires a [key–value interface](./manual/kv.md)
    for its internal caching


Developer experience
--------------------

Fedify significantly improves the developer experience through:

TypeScript-native design
:   Comprehensive type definitions with intelligent auto-completion

Observability
:   [Built-in OpenTelemetry support](./manual/opentelemetry.md) for tracing and
    monitoring

[CLI toolchain](./cli.md)
:   Tools for testing and debugging federation, including:

     -  [Object lookup utility](./cli.md#fedify-lookup-looking-up-an-activitypub-object)
     -  [Ephemeral inbox server](./cli.md#fedify-inbox-ephemeral-inbox-server)
        for testing outgoing activities
     -  [Local tunnel](./cli.md#fedify-tunnel-exposing-a-local-http-server-to-the-public-internet)
        for exposing development servers to the internet


Success stories
---------------

Several notable projects have chosen Fedify to implement ActivityPub federation,
demonstrating its effectiveness in real-world applications:

### Ghost: Federation for a major publishing platform

[Ghost], a leading open-source publishing platform used by thousands of
journalists, creators, and companies worldwide, chose Fedify for their
ActivityPub implementation:

 -  Built a separate ActivityPub service with Fedify rather than integrating
    directly into Ghost core
 -  Leveraged Fedify to quickly implement federation while focusing on
    delivering value to their large user base
 -  Contributes back features and bug fixes to the Fedify ecosystem

> ActivityPub sits on top of a lot more standards than you might think, so it's
> sometimes necessary to juggle a lot of complex standards to get the full
> picture… This is the main reason I created Fedify.
>
> …
>
> We can definitely attest to the problems that Fedify is working hard to
> solve, because even in just a few weeks of early prototyping we were running
> into the issues described above right away.
>
> —From *[Alright, let's Fedify]*

[Ghost]: https://ghost.org
[Alright, let's Fedify]: https://activitypub.ghost.org/day-4/

### Hollo: Single-user microblogging

[Hollo] is a federated microblogging platform specifically designed for single
users, created by the original developer of Fedify:

 -  Initially faced challenges implementing ActivityPub from scratch,
    which inspired the creation of Fedify
 -  Now powered by Fedify, offering features like Mastodon-compatible API,
    CommonMark support, and Misskey-style quotes
 -  Serves as both a showcase and test case for Fedify's capabilities

> Implementing ActivityPub from the ground up was quite painful for me…
> I realized that I was already building a sloppy quasi-framework for ActivityPub.
> I thought, “No way, I'm going to build a proper ActivityPub framework,”
> and Fedify is the result.
>
> —Hong Minhee, creator of Fedify and Hollo, in *[Alright, let's Fedify]*

[Hollo]: https://docs.hollo.social

### Hackers' Pub: Community-driven federation

[Hackers' Pub] is an open-source community project building federation
capabilities with Fedify:

 -  Demonstrates how community-driven projects can leverage Fedify to implement
    ActivityPub
 -  Showcases the accessibility of federation technology to developers beyond
    large organizations
 -  Part of the growing ecosystem of developers adopting Fedify to join
    the fediverse

[Hackers' Pub]: https://hackers.pub/

### Encyclia: Bridging academic research to the fediverse

[Encyclia] is an innovative service that makes [ORCID] (Open Researcher and
Contributor ID) records available on the fediverse:

 -  Bridges academic research into federated social networks by making
    researcher profiles and publications discoverable through ActivityPub
 -  Allows users to follow researchers and see their new publications in
    their federated social feeds
 -  Built using Fedify for ActivityPub implementation with tested
    interoperability across Mastodon and other fediverse platforms
 -  Demonstrates Fedify's versatility in specialized domains beyond traditional
    social networking applications

> Encyclia is built using Fedify, an ActivityPub-based federated server
> framework that helps developers easily integrate their applications with
> the fediverse… It simplifies the complex implementation of the ActivityPub
> protocol, significantly reducing development time.
>
> —From the [Encyclia roadmap]

[Encyclia]: https://encyclia.pub/
[ORCID]: https://orcid.org/
[Encyclia roadmap]: https://encyclia.pub/roadmap


### Typo Blue: Text-only blogging meets the fediverse

[Typo Blue] is a Korean text-only blogging platform that embraces minimalist
writing, allowing users to focus purely on text without images or attachments:

 -  Originally featured email subscription for readers to follow blogs
 -  Recently added opt-in ActivityPub integration using Fedify, enabling blogs
    to be discoverable across the fediverse
 -  Allows readers on Mastodon, Misskey, and other ActivityPub-compatible
    platforms to follow and interact with blogs
 -  Demonstrates how specialized platforms can maintain their unique identity
    while participating in the open social web

[Typo Blue]: https://typo.blue/


Conclusion
----------

While building an ActivityPub server from scratch can be educational,
it's a complex undertaking that can slow development and lead to
interoperability or security issues.

Fedify abstracts away these complexities, providing a robust, secure,
and developer-friendly framework.  By handling the low-level details of
ActivityPub, WebFinger, authentication, and more, Fedify empowers you to:

Develop faster
:   Focus on your application's core functionality and user experience

Reduce errors
:   Leverage type safety and battle-tested components

Ensure interoperability
:   Work seamlessly with the diverse fediverse ecosystem

Improve security
:   Rely on built-in security mechanisms and best practices

Stay flexible
:   Integrate with your technology stack of choice

If you're looking to build a federated application on the ActivityPub protocol,
Fedify offers a powerful and efficient path to success.

<!-- cSpell: ignore Encyclia ORCID -->
