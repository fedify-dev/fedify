<!-- deno-fmt-ignore-file -->

Fedify changelog
================

Version 1.10.0
--------------

To be released.

### @fedify/fedify

 -  Enhanced OpenTelemetry instrumentation with span events for capturing
    detailed activity data.  Span events now record complete activity JSON
    payloads and verification status, enabling richer observability and
    debugging capabilities without relying solely on span attributes
    (which only support primitive values).  [[#323]]

     -  Added `activitypub.activity.received` span event to the
        `activitypub.inbox` span, recording the full activity JSON,
        verification status (activity verified, HTTP signatures verified,
        Linked Data signatures verified), and actor information.
     -  Added `activitypub.activity.sent` span event to the
        `activitypub.send_activity` span, recording the full activity JSON
        and target inbox URL.
     -  Added `activitypub.object.fetched` span event to the
        `activitypub.lookup_object` span, recording the fetched object's
        type and complete JSON-LD representation.

 -  Added OpenTelemetry spans for previously uninstrumented operations:
    [[#323]]

     -  Added `activitypub.fetch_document` span for document loader operations,
        tracking URL fetching, HTTP redirects, and final document URLs.
     -  Added `activitypub.verify_key_ownership` span for cryptographic
        key ownership verification, recording actor ID, key ID, verification
        result, and the verification method used.

[#323]: https://github.com/fedify-dev/fedify/issues/323

### @fedify/nestjs

 -  Allowed Express 5 in the `express` peer dependency range to support NestJS 11.
    [[#492], [#493] by Cho Hasang]


[#492]: https://github.com/fedify-dev/fedify/issues/492
[#493]: https://github.com/fedify-dev/fedify/pull/493


Version 1.9.2
-------------

Released on December 20, 2025.

### @fedify/fedify

 -  Fixed a ReDoS (Regular Expression Denial of Service) vulnerability in
    the document loader's HTML parsing.  An attacker-controlled server could
    respond with a malicious HTML payload that blocked the event loop.
    [[CVE-2025-68475]]

### @fedify/sqlite

 -  Fixed `SyntaxError: Identifier 'Temporal' has already been declared` error
    that occurred when using `SqliteKvStore` on Node.js or Bun.  The error
    was caused by duplicate `Temporal` imports during the build process.
    [[#487]]


Version 1.9.1
-------------

Released on October 31, 2025.

### @fedify/testing

 -  Fixed JSR publishing hanging indefinitely at the *processing* stage by
    hiding complex type exports from the public API.  The JSR type analyzer
    struggled with complex type dependencies when analyzing the `MockFederation`,
    `TestFederation`, `TestContext`, and `SentActivity` types, causing indefinite
    hangs during the processing stage.  [[#468]]

     -  *Breaking change*: `MockFederation` class is no longer exported from
        the public API.  Use `createFederation()` factory function instead.
     -  `TestFederation<TContextData>`, `TestContext<TContextData>`, and
        `SentActivity` interfaces are no longer exported from the public API,
        but their types are still inferred from `createFederation()` return type
        and can be used via TypeScript's type inference.

### @fedify/cli

 -  Fixed `fedify` command failing on Windows with `PermissionDenied` error
    when trying to locate or execute package managers during initialization.
    The CLI now properly handles _\*.cmd_ and _\*.bat_ files on Windows by
    invoking them through `cmd /c`.  [[#463]]


Version 1.9.0
-------------

Released on October 14, 2025.

### @fedify/fedify

 -  Implemented [FEP-fe34] origin-based security model to protect against
    content spoofing attacks and ensure secure federation practices.  The
    security model enforces same-origin policy for ActivityPub objects and
    their properties, preventing malicious actors from impersonating content
    from other servers.  [[#440]]

     -  Added `crossOrigin` option to Activity Vocabulary property accessors
        (`get*()` methods) with three security levels: `"ignore"` (default,
        logs warning and returns `null`), `"throw"` (throws error), and
        `"trust"` (bypasses checks).
     -  Added `LookupObjectOptions.crossOrigin` option to `lookupObject()`
        function and `Context.lookupObject()` method for controlling
        cross-origin validation.
     -  Embedded objects are now validated against their parent object's origin
        and only trusted when they share the same origin or are explicitly
        marked as trusted.
     -  Property hydration now respects origin-based security, automatically
        performing remote fetches when embedded objects have different origins.
     -  Internal trust tracking system maintains security context throughout
        object lifecycles (construction, cloning, and property access).

 -  Added `withIdempotency()` method to configure activity idempotency
    strategies for inbox processing.  This addresses issue [#441] where
    activities with the same ID sent to different inboxes were incorrectly
    deduplicated globally instead of per-inbox.  [[#441]]

     -  Added `IdempotencyStrategy` type.
     -  Added `IdempotencyKeyCallback` type.
     -  Added `InboxListenerSetters.withIdempotency()` method.
     -  By default, `"per-origin"` strategy is used for backward compatibility.
        This will change to `"per-inbox"` in Fedify 2.0.  We recommend
        explicitly setting the strategy to avoid unexpected behavior changes.

 -  Fixed handling of ActivityPub objects containing relative URLs.  The
    Activity Vocabulary classes now automatically resolve relative URLs by
    inferring the base URL from the object's `@id` or document URL, eliminating
    the need for manual `baseUrl` specification in most cases.  This improves
    interoperability with ActivityPub servers that emit relative URLs in
    properties like `icon.url` and `image.url`.  [[#411], [#443] by Jiwon Kwon]

 -  Added TypeScript support for all [RFC 6570] URI Template expression types
    in dispatcher path parameters.  Previously, only simple string expansion
    (`{identifier}`) was supported in TypeScript types, while the runtime
    already supported all RFC 6570 expressions.  Now TypeScript accepts all
    expression types including `{+identifier}` (reserved string expansion,
    recommended for URI identifiers), `{#identifier}` (fragment expansion),
    `{.identifier}` (label expansion), `{/identifier}` (path segments),
    `{;identifier}` (path-style parameters), `{?identifier}` (query component),
    and `{&identifier}` (query continuation).  [[#426], [#446] by Jiwon Kwon]

     -  Added `Rfc6570Expression<TParam>` type helper.
     -  Updated all dispatcher path type parameters to accept RFC 6570
        expressions: `setActorDispatcher()`, `setObjectDispatcher()`,
        `setInboxDispatcher()`, `setOutboxDispatcher()`,
        `setFollowingDispatcher()`, `setFollowersDispatcher()`,
        `setLikedDispatcher()`, `setFeaturedDispatcher()`,
        `setFeaturedTagsDispatcher()`, `setInboxListeners()`,
        `setCollectionDispatcher()`, and `setOrderedCollectionDispatcher()`.

 -  Added inverse properties for collections to Vocabulary API.
    [[FEP-5711], [#373], [#381] by Jiwon Kwon]

     -  `new Collection()` constructor now accepts `likesOf` option.
     -  Added `Collection.likesOfId` property.
     -  Added `Collection.getLikesOf()` method.
     -  `new Collection()` constructor now accepts `sharesOf` option.
     -  Added `Collection.sharedOfId` property.
     -  Added `Collection.getSharedOf()` method.
     -  `new Collection()` constructor now accepts `repliesOf` option.
     -  Added `Collection.repliesOfId` property.
     -  Added `Collection.getRepliesOf()` method.
     -  `new Collection()` constructor now accepts `inboxOf` option.
     -  Added `Collection.inboxOfId` property.
     -  Added `Collection.getInboxOf()` method.
     -  `new Collection()` constructor now accepts `outboxOf` option.
     -  Added `Collection.outboxOfId` property.
     -  Added `Collection.getOutboxOf()` method.
     -  `new Collection()` constructor now accepts `followersOf` option.
     -  Added `Collection.followersOfId` property.
     -  Added `Collection.getFollowersOf()` method.
     -  `new Collection()` constructor now accepts `followingOf` option.
     -  Added `Collection.followingOfId` property.
     -  Added `Collection.getFollowingOf()` method.
     -  `new Collection()` constructor now accepts `likedOf` option.
     -  Added `Collection.likedOfId` property.
     -  Added `Collection.getLikedOf()` method.

 -  Changed how `parseSoftware()` function handles non-Semantic Versioning
    number strings on `tryBestEffort` mode.  [[#353], [#365] by Hyeonseo Kim]

 -  Separated modules from `@fedify/fedify/x` into dedicated packages to
    improve modularity and reduce bundle size.  The existing integration
    functions in `@fedify/fedify/x` are now deprecated and will be removed in
    version 2.0.0.  [[#375] by Chanhaeng Lee]

     -  Deprecated `@fedify/fedify/x/cfworkers` in favor of `@fedify/cfworkers`.
     -  Deprecated `@fedify/fedify/x/denokv` in favor of `@fedify/denokv`.
     -  Deprecated `@fedify/fedify/x/hono` in favor of `@fedify/hono`.
     -  Deprecated `@fedify/fedify/x/sveltekit` in favor of `@fedify/sveltekit`.

 -  Extended `Link` from `@fedify/fedify/webfinger` to support
    [OStatus 1.0 Draft 2].  [[#402], [#404] by Hyeonseo Kim]

     -  Added an optional `template` field to the `Link` interface.
     -  Changed the `href` field optional from the `Link` interface according to
        [RFC 7033 Section 4.4.4.3].

 -  Added `Federatable.setWebFingerLinksDispatcher()` method to set additional
    links to WebFinger.  [[#119], [#407] by HyeonseoKim]

 -  Added CommonJS support alongside ESM for better NestJS integration and
    broader Node.js ecosystem compatibility.  This eliminates the need for
    Node.js's `--experimental-require-module` flag and resolves dual package
    hazard issues.  [[#429], [#431]]

[FEP-fe34]: https://w3id.org/fep/fe34
[FEP-5711]: https://w3id.org/fep/5711
[RFC 6570]: https://tools.ietf.org/html/rfc6570
[OStatus 1.0 Draft 2]: https://www.w3.org/community/ostatus/wiki/images/9/93/OStatus_1.0_Draft_2.pdf
[RFC 7033 Section 4.4.4.3]: https://datatracker.ietf.org/doc/html/rfc7033#section-4.4.4.3
[#119]: https://github.com/fedify-dev/fedify/issues/119
[#353]: https://github.com/fedify-dev/fedify/issues/353
[#365]: https://github.com/fedify-dev/fedify/pull/365
[#373]: https://github.com/fedify-dev/fedify/issues/373
[#375]: https://github.com/fedify-dev/fedify/issues/375
[#381]: https://github.com/fedify-dev/fedify/pull/381
[#402]: https://github.com/fedify-dev/fedify/issues/402
[#404]: https://github.com/fedify-dev/fedify/pull/404
[#407]: https://github.com/fedify-dev/fedify/pull/407
[#411]: https://github.com/fedify-dev/fedify/issues/411
[#426]: https://github.com/fedify-dev/fedify/issues/426
[#429]: https://github.com/fedify-dev/fedify/issues/429
[#431]: https://github.com/fedify-dev/fedify/pull/431
[#440]: https://github.com/fedify-dev/fedify/issues/440
[#441]: https://github.com/fedify-dev/fedify/issues/441
[#443]: https://github.com/fedify-dev/fedify/pull/443
[#446]: https://github.com/fedify-dev/fedify/pull/446

### @fedify/cli

 -  Added `Next.js` option to `fedify init` command. This option allows users
    to initialize a new Fedify project with Next.js integration.
    [[#313] by Chanhaeng Lee]

 -  Changed how `fedify nodeinfo` command handles non-Semantic Versioning
    number strings on `-b`/`--best-effort` mode.  Now it uses the same logic as
    the `parseSoftware()` function in the *@fedify/fedify* package, which
    allows it to parse non-Semantic Versioning number strings more flexibly.
    [[#353], [#365] by Hyeonseo Kim]]

 -  Added `-T`/`--timeout` option to `fedify lookup` command. This option allows
    users to specify timeout in seconds for network requests to prevent
    hanging on slow or unresponsive servers.
    [[#258], [#372] by Hyunchae Kim]

[#353]: https://github.com/fedify-dev/fedify/issues/353
[#365]: https://github.com/fedify-dev/fedify/pull/365
[#372]: https://github.com/fedify-dev/fedify/pull/372

### @fedify/amqp

 -  Added CommonJS support alongside ESM for better compatibility with
    CommonJS-based Node.js applications.  [[#429], [#431]]

### @fedify/cfworkers

 -  Created Cloudflare Workers integration as the *@fedify/cfworkers* package.
    Separated from `@fedify/fedify/x/cfworkers` to improve modularity and
    reduce bundle size.  [[#375] by Chanhaeng Lee]

### @fedify/denokv

 -  Created Deno KV integration as the *@fedify/denokv* package.
    Separated from `@fedify/fedify/x/denokv` to improve modularity and
    reduce bundle size.  [[#375] by Chanhaeng Lee]

### @fedify/elysia

 -  Added CommonJS support alongside ESM for better compatibility with
    CommonJS-based Node.js applications.  [[#429], [#431]]

### @fedify/express

 -  Added CommonJS support alongside ESM for better compatibility with
    CommonJS-based Node.js applications.  [[#429], [#431]]

### @fedify/fastify

 -  Created [Fastify] integration as the *@fedify/fastify* package.
    [[#151], [#450] by An Subin]

     -  Added `fedifyPlugin()` function for integrating Fedify into Fastify
        applications.
     -  Converts between Fastify's request/reply API and Web Standards
        `Request`/`Response`.
     -  Supports both ESM and CommonJS for broad Node.js compatibility.

[Fastify]: https://fastify.dev/
[#151]: https://github.com/fedify-dev/fedify/issues/151
[#450]: https://github.com/fedify-dev/fedify/pull/450

### @fedify/h3

 -  Added CommonJS support alongside ESM for better compatibility with
    CommonJS-based Node.js applications.  [[#429], [#431]]

### @fedify/hono

 -  Created Hono integration as the *@fedify/hono* package.
    Separated from `@fedify/fedify/x/hono` to improve modularity and
    reduce bundle size.  [[#375] by Chanhaeng Lee]

 -  Added CommonJS support alongside ESM for better compatibility with
    CommonJS-based Node.js applications.  [[#429], [#431]]

### @fedify/koa

 -  Created [Koa] integration as the *@fedify/koa* package.  [[#454], [#455]]

     -  Added `createMiddleware()` function for integrating Fedify into Koa
        applications.
     -  Supports both Koa v2.x and v3.x via peer dependencies.
     -  Converts between Koa's context-based API and Web Standards
        Request/Response.
     -  Builds for both npm (ESM/CJS) and JSR distribution.

[Koa]: https://koajs.com/
[#454]: https://github.com/fedify-dev/fedify/issues/454
[#455]: https://github.com/fedify-dev/fedify/pull/455

### @fedify/next

 -  Created [Next.js] integration as the *@fedify/next* package.
    [[#313] by Chanhaeng Lee]

 -  Added CommonJS support alongside ESM for better compatibility with
    CommonJS-based Node.js applications.  [[#429], [#431]]

[Next.js]: https://nextjs.org/
[#313]: https://github.com/fedify-dev/fedify/issues/313

### @fedify/postgres

 -  Added CommonJS support alongside ESM for better compatibility with
    CommonJS-based Node.js applications.  [[#429], [#431]]

### @fedify/redis

 -  Added support for Redis Cluster to the *@fedify/redis* package.
    [[#368] by Michael Barrett]

 -  Added CommonJS support alongside ESM for better compatibility with
    CommonJS-based Node.js applications.  [[#429], [#431]]

[#368]: https://github.com/fedify-dev/fedify/pull/368

### @fedify/sqlite

 -  Added CommonJS support alongside ESM for better compatibility with
    CommonJS-based Node.js applications.  [[#429], [#431]]

### @fedify/sveltekit

 -  Created SvelteKit integration as the *@fedify/sveltekit* package.
    Separated from `@fedify/fedify/x/sveltekit` to improve modularity and
    reduce bundle size.  [[#375] by Chanhaeng Lee]

 -  Fixed SvelteKit integration hook types to correctly infer the request
    and response types in hooks.  [[#271], [#394] by Chanhaeng Lee]

 -  Added CommonJS support alongside ESM for better compatibility with
    CommonJS-based Node.js applications.  [[#429], [#431]]

[#271]: https://github.com/fedify-dev/fedify/pull/271
[#394]: https://github.com/fedify-dev/fedify/pull/394

### @fedify/testing

 -  Added CommonJS support alongside ESM for better compatibility with
    CommonJS-based Node.js applications.  [[#429], [#431]]


Version 1.8.15
--------------

Released on December 20, 2025.

### @fedify/fedify

 -  Fixed a ReDoS (Regular Expression Denial of Service) vulnerability in
    the document loader's HTML parsing.  An attacker-controlled server could
    respond with a malicious HTML payload that blocked the event loop.
    [[CVE-2025-68475]]

### @fedify/sqlite

 -  Fixed `SyntaxError: Identifier 'Temporal' has already been declared` error
    that occurred when using `SqliteKvStore` on Node.js or Bun.  The error
    was caused by duplicate `Temporal` imports during the build process.
    [[#487]]

[#487]: https://github.com/fedify-dev/fedify/issues/487


Version 1.8.14
--------------

Released on October 19, 2025.

### @fedify/testing

 -  Fixed JSR publishing hanging indefinitely at the *processing* stage.
    The issue was caused by TypeScript function overload signatures in
    `MockContext` and `MockFederation` classes that triggered a bug in JSR's
    type analyzer.  All method overloads have been removed and simplified to
    use `any` types where necessary.  [[#468], [#470]]

[#468]: https://github.com/fedify-dev/fedify/issues/468
[#470]: https://github.com/fedify-dev/fedify/pull/470

### @fedify/cli

 -  Fixed `fedify` command failing on Windows with `PermissionDenied` error
    when trying to locate or execute package managers during initialization.
    The CLI now properly handles _\*.cmd_ and _\*.bat_ files on Windows by
    invoking them through `cmd /c`.  [[#463]]

[#463]: https://github.com/fedify-dev/fedify/issues/463


Version 1.8.13
--------------

Released on October 10, 2025.

### @fedify/fedify

 -  Fixed inconsistent encoding/decoding of URI template identifiers with
    special characters.  Updated *uri-template-router* to version 1.0.0,
    which properly decodes percent-encoded characters in URI template variables
    according to RFC 6570.  This resolves issues where identifiers containing
    URIs (e.g., `https%3A%2F%2Fexample.com`) were being inconsistently decoded
    in dispatcher callbacks and double-encoded in collection URLs.  [[#416]]

[#416]: https://github.com/fedify-dev/fedify/issues/416


Version 1.8.12
--------------

Released on September 20, 2025.

### @fedify/sqlite

 -  Fixed bundling issues where incorrect import paths to *node\_modules* were
    included in the bundled output.  The *@js-temporal/polyfill* dependency
    was moved from `devDependencies` to `dependencies` to ensure proper
    bundling.


Version 1.8.11
--------------

Released on September 17, 2025.

 -  Improved the AT Protocol URI workaround to handle all DID methods and
    edge cases. The fix now properly percent-encodes any authority component
    in `at://` URIs, supporting `did:web`, `did:key`, and other DID methods
    beyond just `did:plc`. Also handles URIs without path components
    correctly.  [[#436]]


Version 1.8.10
--------------

Released on September 17, 2025.

### @fedify/fedify

 -  Added a temporary workaround for invalid AT Protocol URIs from BridgyFed.
    URIs like `at://did:plc:...` that violate RFC 3986 URI syntax are now
    automatically URL-encoded to `at://did%3Aplc%3A...` to prevent parsing
    failures when processing bridged Bluesky content.  [[#436]]


Version 1.8.9
-------------

Released on September 10, 2025.

 -  Integration and database adapter packages (*@fedify/amqp*, *@fedify/elysia*,
    *@fedify/express*, *@fedify/h3*, *@fedify/nestjs*, *@fedify/postgres*,
    *@fedify/redis*, *@fedify/sqlite*, *@fedify/testing*) now specify explicit
    version ranges for the *@fedify/fedify* peer dependency instead of
    accepting any version, improving compatibility guarantees.


Version 1.8.8
-------------

Released on August 25, 2025.

### @fedify/fedify

 -  Fixed a bug where `verifyRequest()` function threw a `TypeError` when
    verifying HTTP Signatures with `created` or `expires` fields in
    the `Signature` header as defined in draft-cavage-http-signatures-12,
    causing `500 Internal Server Error` responses in inbox handlers.
    Now it correctly handles these fields as unquoted integers according
    to the specification.


Version 1.8.7
-------------

Released on August 25, 2025.

### @fedify/fedify

 -  Fixed a bug where ActivityPub Discovery failed to recognize XHTML
    self-closing `<link>` tags. The HTML/XHTML parser now correctly handles
    whitespace before the self-closing slash (`/>`), improving compatibility
    with XHTML documents that follow the self-closing tag format.


Version 1.8.6
-------------

Released on August 24, 2025.

### @fedify/nestjs

 -  Fixed a critical error that prevented the middleware from processing
    ActivityPub requests in NestJS applications. The middleware now correctly
    handles request bodies that have been pre-processed by other NestJS
    middleware or interceptors.  [[#279], [#386] by Jaeyeol Lee]

[#279]: https://github.com/fedify-dev/fedify/issues/279
[#386]: https://github.com/fedify-dev/fedify/pull/386

### @fedify/testing

 -  Updated exports to include context creation functions.
    [[#382] by Colin Mitchell]

     -  Added `createContext()` function.
     -  Added `createInboxContext()` function.
     -  Added `createRequestContext()` function.

[#382]: https://github.com/fedify-dev/fedify/pull/382


Version 1.8.5
-------------

Released on August 8, 2025.

### @fedify/fedify

 -  Fixed a critical authentication bypass vulnerability in the inbox handler
    that allowed unauthenticated attackers to impersonate any ActivityPub actor.
    The vulnerability occurred because activities were processed before
    verifying that the HTTP Signatures key belonged to the claimed actor.
    Now authentication verification is performed before activity processing to
    prevent actor impersonation attacks.  [[CVE-2025-54888]]

### @fedify/cli

 -  Fixed `fedify nodeinfo` color support in Windows Terminal.
    [[#358], [#360] by KeunHyeong Park]

[#358]: https://github.com/fedify-dev/fedify/issues/358
[#360]: https://github.com/fedify-dev/fedify/pull/360


Version 1.8.4
-------------

Released on August 7, 2025.

### @fedify/cli

 -  Fixed `fedify lookup` command's `-r`/`--raw`, `-C`/`--compact`, and
    `-e`/`--expand` options to properly output valid JSON format instead of
    Deno's object inspection format.  [[#357]]

[#357]: https://github.com/fedify-dev/fedify/issues/357


Version 1.8.3
-------------

Released on August 6, 2025.

### @fedify/cli

 -  Restored image resizing functionality in `fedify lookup` command by using
    the existing [Jimp] library for image manipulation. This properly displays
    `icon` and `image` fields with appropriate sizing in terminals.

 -  Added support for Ghostty terminal emulator for image rendering in
    `fedify lookup` command.

[Jimp]: https://jimp-dev.github.io/jimp/


Version 1.8.2
-------------

Released on August 6, 2025.

### @fedify/cli

 -  Fixed `npx @fedify/cli` command not working on various platforms by
    correcting the binary path resolution in the Node.js wrapper script.

 -  Temporarily removed Sharp dependency to resolve installation issues
    across different platforms. As a result, `fedify lookup` command will no
    longer resize images when displaying them in the terminal. This is a
    temporary workaround and image resizing functionality will be restored
    in a future patch version using an alternative approach.

 -  Fixed build artifact paths in GitHub Actions workflow to correctly
    reference CLI package location in the monorepo structure.


Version 1.8.1
-------------

Released on August 6, 2025.  Note that 1.8.0 was skipped due to a mistake in
the versioning.

 -  The repository has been restructured as a monorepo, consolidating all
    Fedify packages into a single repository with unified versioning.  This
    change affects the following packages:

     -  *@fedify/fedify* (main library)
     -  *@fedify/cli* (CLI toolchain)
     -  *@fedify/amqp* (AMQP/RabbitMQ driver)
     -  *@fedify/express* (Express integration)
     -  *@fedify/h3* (h3 framework integration)
     -  *@fedify/postgres* (PostgreSQL drivers)
     -  *@fedify/redis* (Redis drivers)

    All packages now follow the same version number and are released together.
    Previously, each package had independent versioning.

 -  Several new packages have been added to the monorepo:

     -  *@fedify/elysia* ([Elysia] integration)
     -  *@fedify/nestjs* ([NestJS] integration)
     -  *@fedify/sqlite* (SQLite drivers)
     -  *@fedify/testing* (testing utilities)

### @fedify/fedify

 -  Added custom collection dispatchers.  [[#310], [#332] by ChanHaeng Lee]

     -  Added `CustomCollectionDispatcher`, `CustomCollectionCounter`, and
        `CustomCollectionCursor` types for custom collection dispatching.
     -  Added `CustomCollectionCallbackSetters` type for setting custom
        collection callbacks.
     -  Added `CustomCollectionHandler` class and `handleCustomCollection()` and
        `handleOrderedCollection()` functions to process custom collections.
     -  Added `setCollectionDispatcher()` and `setOrderedCollectionDispatcher()`
        methods to the `Federatable` interface. Implemented in
        `FederationBuilderImpl` class.
     -  Added `getCollectionUri()` method to the `Context` interface.
     -  Added utility types `ConstructorWithTypeId` and `ParamsKeyPath` for
        custom collection dispatchers.

 -  Key–value stores now optionally support CAS (compare-and-swap) operation
    for atomic updates.  This is useful for implementing optimistic locking
    and preventing lost updates in concurrent environments.

     -  Added optional `KvStore.cas()` method.
     -  Added `MemoryKvStore.cas()` method.
     -  Added `DenoKvStore.cas()` method.

 -  Added useful functions for fediverse handles at `@fedify/fedify/vocab`.
    This functions simplify working with fediverse handles and URLs.
    [[#278] by ChanHaeng Lee]

     -  `FediverseHandle`: An interface representing a fediverse handle.
     -  `parseFediverseHandle()`: A function to parse a fediverse handle into
        its components.
     -  `isFediverseHandle()`: A function to check if a string is a valid
        fediverse handle.
     -  `toAcctUrl()`: A function to convert a fediverse handle to a `URL`.

 -  Added `LookupWebFingerOptions.maxRedirection` option.
    [[#248], [#281] by Lee ByeongJun]

 -  APIs making HTTP requests became able to optionally take `AbortSignal`.
    [[#51], [#315] by Hyunchae Kim]

     -  Added `DocumentLoaderOptions` interface.
     -  The `DocumentLoader` type became able to optionally take
        the second parameter.
     -  Added `LookupObjectOptions.signal` option.
     -  Added `LookupWebFingerOptions.signal` option.
     -  Added `DoubleKnockOptions.signal` option.

### @fedify/cli

 -  The `fedify` CLI now correctly disables color output when standard output
    isn't a TTY (for example, when redirecting to a file) or when the `NO_COLOR`
    environment variable is set.  [[#257], [#341] by Cho Hasang]

 -  Added `fedify nodeinfo` command, and deprecated `fedify node` command in
    favor of `fedify nodeinfo`.  [[#267], [#331] by Hyeonseo Kim]

 -  Added `fedify webfinger` command. This command allows users to look up
    WebFinger information for a given resource.
    [[#260], [#278] by ChanHaeng Lee]

     -  The input can be a handle (e.g., `@user@server`, `user@server`) or
        a URL (e.g., `https://server/users/path`).
     -  The `--user-agent` or `-a` option used as `User-Agent` header value
        in the WebFinger request.
     -  The `--allow-private-address` or `-p` option allows looking up
        WebFinger information for private addresses (e.g., `localhost`).
     -  The `--max-redirection` option allows uses to specify the maximum
        number of redirects to follow when performing WebFinger lookups.
        [[#311], [#328] by KeunHyeong Park]

 -  The `fedify lookup` command now displays images depending on user's
    terminal emulator. [[#169], [#348] by Jiwon Kwon]

     -  Supported terminal emulators are [Kitty], [WezTerm], [Konsole], [Warp],
        [Wayst], [st], and [iTerm].

 -  Added `-o`/`--output` option to `fedify lookup` command. This option allows
    users to save retrieved lookup results to specified path.
    [[#261], [#321] by Jiwon Kwon]

 -  Added options to customize the temporary actor information when running
    `fedify inbox` command.  [[#262], [#285] by Hasang Cho]

     -  Added `--actor-name` option to customize the actor display name.
     -  Added `--actor-summary` option to customize the actor description.
     -  Both options provide sensible defaults when not specified.

 -  The `fedify inbox` command now displays the type of the object contained
    in each activity, in addition to the activity's own type.
    [[#191], [#342] by Jang Hanarae]

 -  Added `--dry-run` option to `fedify init` command.  This option allows users
    to preview what files and configurations would be created without actually
    creating them.  [[#263], [#298] by Lee ByeongJun]

 -  Fixed a bug where the `fedify nodeinfo` command (was `fedify node`) had
    failed to correctly render the favicon in terminal emulators that do not
    support 24-bit colors.  [[#168], [#282], [#304] by Hyeonseo Kim]

### @fedify/elysia

 -  Supported [Elysia] integration with the *@fedify/elysia* package.
    [[#286], [#339] by Hyeonseo Kim]

     -  Added *@fedify/elysia* package.
     -  Added `fedify` Elysia plugin for integrating Fedify into Elysia
        applications.

### @fedify/nestjs

 -  Supported [NestJS] integration with the *@fedify/nestjs* package.
    [[#269], [#309] by Jaeyeol Lee]

     -  Added *@fedify/nestjs* package.
     -  Added `FedifyModule` for integrating Fedify into NestJS applications.

### @fedify/sqlite

 -  Added `SqliteKvStore`, implementing `KvStore` using SQLite with the
    *@fedify/sqlite* package. Compatible with Bun, Deno, and Node.js.
    [[#274], [#318] by An Subin]

     -  Added *@fedify/sqlite* package.
     -  Added `SqliteKvStore`, a SQLite implementation of `KvStore`.

### @fedify/testing

 -  Added mock classes for `Federation` and `Context` interfaces to improve
    testability without requiring a real federation server setup. The mock
    classes track all sent activities with metadata and support all standard
    Fedify patterns including custom path registration and multiple activity
    type listeners.  [[#197], [#283] by Lee ByeongJun]

     -  Added *@fedify/testing* package.
     -  Added `MockFederation` class.
     -  Added `MockContext` class.

[#51]: https://github.com/fedify-dev/fedify/issues/51
[#168]: https://github.com/fedify-dev/fedify/issues/168
[#169]: https://github.com/fedify-dev/fedify/issues/169
[#191]: https://github.com/fedify-dev/fedify/issues/191
[#197]: https://github.com/fedify-dev/fedify/issues/197
[#248]: https://github.com/fedify-dev/fedify/issues/248
[#257]: https://github.com/fedify-dev/fedify/issues/257
[#260]: https://github.com/fedify-dev/fedify/issues/260
[#261]: https://github.com/fedify-dev/fedify/issues/261
[#262]: https://github.com/fedify-dev/fedify/issues/262
[#263]: https://github.com/fedify-dev/fedify/issues/263
[#267]: https://github.com/fedify-dev/fedify/issues/267
[#269]: https://github.com/fedify-dev/fedify/issues/269
[#274]: https://github.com/fedify-dev/fedify/issues/274
[#278]: https://github.com/fedify-dev/fedify/pull/278
[#281]: https://github.com/fedify-dev/fedify/pull/281
[#282]: https://github.com/fedify-dev/fedify/pull/282
[#283]: https://github.com/fedify-dev/fedify/pull/283
[#285]: https://github.com/fedify-dev/fedify/pull/285
[#286]: https://github.com/fedify-dev/fedify/issues/286
[#298]: https://github.com/fedify-dev/fedify/pull/298
[#304]: https://github.com/fedify-dev/fedify/issues/304
[#309]: https://github.com/fedify-dev/fedify/pull/309
[#310]: https://github.com/fedify-dev/fedify/issues/310
[#311]: https://github.com/fedify-dev/fedify/issues/311
[#315]: https://github.com/fedify-dev/fedify/pull/315
[#318]: https://github.com/fedify-dev/fedify/pull/318
[#321]: https://github.com/fedify-dev/fedify/pull/321
[#328]: https://github.com/fedify-dev/fedify/pull/328
[#331]: https://github.com/fedify-dev/fedify/pull/331
[#332]: https://github.com/fedify-dev/fedify/pull/332
[#339]: https://github.com/fedify-dev/fedify/pull/339
[#341]: https://github.com/fedify-dev/fedify/pull/341
[#342]: https://github.com/fedify-dev/fedify/pull/342
[#348]: https://github.com/fedify-dev/fedify/pull/348
[Kitty]: https://sw.kovidgoyal.net/kitty/
[Elysia]: https://elysiajs.com/
[NestJS]: https://nestjs.com/
[WezTerm]: https://wezterm.org/
[Konsole]: https://konsole.kde.org/
[Warp]: https://www.warp.dev/
[Wayst]: https://github.com/91861/wayst
[st]: https://st.suckless.org/
[iTerm]: https://iterm2.com/


Version 1.7.15
--------------

Released on December 20, 2025.

 -  Fixed a bug where TypeScript declaration files (*.d.ts*) were not included
    in the npm package, causing type errors when importing the package.


Version 1.7.14
--------------

Released on December 20, 2025.

 -  Fixed a ReDoS (Regular Expression Denial of Service) vulnerability in
    the document loader's HTML parsing.  An attacker-controlled server could
    respond with a malicious HTML payload that blocked the event loop.
    [[CVE-2025-68475]]


Version 1.7.13
--------------

Released on September 17, 2025.

 -  Improved the AT Protocol URI workaround to handle all DID methods and
    edge cases. The fix now properly percent-encodes any authority component
    in `at://` URIs, supporting `did:web`, `did:key`, and other DID methods
    beyond just `did:plc`. Also handles URIs without path components
    correctly.  [[#436]]


Version 1.7.12
--------------

Released on September 17, 2025.

 -  Added a temporary workaround for invalid AT Protocol URIs from BridgyFed.
    URIs like `at://did:plc:...` that violate RFC 3986 URI syntax are now
    automatically URL-encoded to `at://did%3Aplc%3A...` to prevent parsing
    failures when processing bridged Bluesky content.  [[#436]]


Version 1.7.11
--------------

Released on August 25, 2025.

 -  Fixed a bug where `verifyRequest()` function threw a `TypeError` when
    verifying HTTP Signatures with `created` or `expires` fields in
    the `Signature` header as defined in draft-cavage-http-signatures-12,
    causing `500 Internal Server Error` responses in inbox handlers.
    Now it correctly handles these fields as unquoted integers according
    to the specification.


Version 1.7.10
--------------

Released on August 25, 2025.

 -  Fixed a bug where ActivityPub Discovery failed to recognize XHTML
    self-closing `<link>` tags. The HTML/XHTML parser now correctly handles
    whitespace before the self-closing slash (`/>`), improving compatibility
    with XHTML documents that follow the self-closing tag format.


Version 1.7.9
-------------

Released on August 8, 2025.

 -  Fixed a critical authentication bypass vulnerability in the inbox handler
    that allowed unauthenticated attackers to impersonate any ActivityPub actor.
    The vulnerability occurred because activities were processed before
    verifying that the HTTP Signatures key belonged to the claimed actor.
    Now authentication verification is performed before activity processing to
    prevent actor impersonation attacks.  [[CVE-2025-54888]]


Version 1.7.8
-------------

Released on August 5, 2025.

 -  Updated `kvCache()` wrapper to read from preloaded contexts rather than
    from the `KvStore`. This saves network and disk overheads when parsing
    activities and objects using the JSON-LD processor.
    [[#352] by Fabien O'Carroll]

[#352]: https://github.com/fedify-dev/fedify/pull/352


Version 1.7.7
-------------

Released on July 28, 2025.

 -  Optimized `doubleKnock()` function to avoid multiple request body clones
    during redirects.  The request body is now read once and reused throughout
    the entire operation, preventing potential `TypeError: unusable` errors
    and improving performance.  [[#300], [#335] by Fabien O'Carroll]

     -  Added `SignRequestOptions.body` option.
     -  Added `DoubleKnockOptions.body` option.
     -  Updated internal signing functions to accept pre-read body buffers.

[#300]: https://github.com/fedify-dev/fedify/pull/300
[#335]: https://github.com/fedify-dev/fedify/pull/335



Version 1.7.6
-------------

Released on July 24, 2025.

 -  Fixed `doubleKnock()` to properly handle redirects with path-only `Location`
    headers by resolving them relative to the original request URL.
    [[#324] by Fabien O'Carroll]


Version 1.7.5
-------------

Released on July 15, 2025.

 -  Fixed `TypeError: unusable` error that occurred when `doubleKnock()`
    encountered redirects during HTTP signature retry attempts.
    [[#294], [#295]]


Version 1.7.4
-------------

Released on July 13, 2025.

  - Fixed a bug the `-T`/`--no-tunnel` option in the `fedify inbox` command
    was being ignored, causing the server to always create a public tunnel
    regardless of the flag. [[#243], [#284] by Lee ByeongJun]

[#243]: https://github.com/fedify-dev/fedify/issues/243
[#284]: https://github.com/fedify-dev/fedify/pull/284


Version 1.7.3
-------------

Released on July 9, 2025.

 -  Added `"default"` export conditions to all package exports in
    *package.json* for improved Node.js compatibility.


Version 1.7.2
-------------

Released on July 2, 2025.

 -  Fixed HTTP signature verification to handle malformed RFC 9421 signatures
    gracefully instead of returning `500 Internal Server Error` responses.
    Malformed signatures now properly fail verification and return appropriate
    error responses.


Version 1.7.1
-------------

Released on June 30, 2025.

 -  Fixed JSON-LD serialization of the `Question.voters` property to correctly
    serialize as a plain number (e.g., `"votersCount": 123`) instead of as a
    typed literal object (e.g., `"votersCount":{"type":"xsd:nonNegativeInteger",
    "@value":123}`).


Version 1.7.0
-------------

Released on June 25, 2025.

 -  Added optional `MessageQueue.nativeRetrial` property to indicate whether
    the message queue backend provides native retry mechanisms.  When `true`,
    Fedify will skip its own retry logic and rely on the backend to handle
    retries.  When `false` or omitted, Fedify will handle retries using its
    own retry policies.  [[#250], [#251]]

     -  `DenoKvMessageQueue.nativeRetrial` is `true`.
     -  `WorkersMessageQueue.nativeRetrial` is `true`.
     -  `InProcessMessageQueue.nativeRetrial` is `false`.
     -  `ParallelMessageQueue.nativeRetrial` inherits from the wrapped queue.

 -  Added `FederationOptions.firstKnock` option to configure the HTTP
    Signatures specification used for the first signature attempt when
    communicating with unknown servers.  This implements the [double-knocking]
    mechanism for better compatibility across different ActivityPub servers.
    Defaults to `"rfc9421"` (RFC 9421: HTTP Message Signatures), with fallback
    to `"draft-cavage-http-signatures-12"` if the first attempt fails.
    [[#252] by Fabien O'Carroll]

[#250]: https://github.com/fedify-dev/fedify/issues/250
[#251]: https://github.com/fedify-dev/fedify/pull/251
[#252]: https://github.com/fedify-dev/fedify/pull/252


Version 1.6.14
--------------

Released on December 20, 2025.

 -  Fixed a bug where TypeScript declaration files (*.d.ts*) were not included
    in the npm package, causing type errors when importing the package.


Version 1.6.13
--------------

Released on December 20, 2025.

 -  Fixed a ReDoS (Regular Expression Denial of Service) vulnerability in
    the document loader's HTML parsing.  An attacker-controlled server could
    respond with a malicious HTML payload that blocked the event loop.
    [[CVE-2025-68475]]

[CVE-2025-68475]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-rchf-xwx2-hm93


Version 1.6.12
--------------

Released on September 17, 2025.

 -  Improved the AT Protocol URI workaround to handle all DID methods and
    edge cases. The fix now properly percent-encodes any authority component
    in `at://` URIs, supporting `did:web`, `did:key`, and other DID methods
    beyond just `did:plc`. Also handles URIs without path components
    correctly.  [[#436]]


Version 1.6.11
--------------

Released on September 17, 2025.

 -  Added a temporary workaround for invalid AT Protocol URIs from BridgyFed.
    URIs like `at://did:plc:...` that violate RFC 3986 URI syntax are now
    automatically URL-encoded to `at://did%3Aplc%3A...` to prevent parsing
    failures when processing bridged Bluesky content.  [[#436]]


Version 1.6.10
--------------

Released on August 25, 2025.

 -  Fixed a bug where `verifyRequest()` function threw a `TypeError` when
    verifying HTTP Signatures with `created` or `expires` fields in
    the `Signature` header as defined in draft-cavage-http-signatures-12,
    causing `500 Internal Server Error` responses in inbox handlers.
    Now it correctly handles these fields as unquoted integers according
    to the specification.


Version 1.6.9
-------------

Released on August 25, 2025.

 -  Fixed a bug where ActivityPub Discovery failed to recognize XHTML
    self-closing `<link>` tags. The HTML/XHTML parser now correctly handles
    whitespace before the self-closing slash (`/>`), improving compatibility
    with XHTML documents that follow the self-closing tag format.


Version 1.6.8
-------------

Released on August 8, 2025.

 -  Fixed a critical authentication bypass vulnerability in the inbox handler
    that allowed unauthenticated attackers to impersonate any ActivityPub actor.
    The vulnerability occurred because activities were processed before
    verifying that the HTTP Signatures key belonged to the claimed actor.
    Now authentication verification is performed before activity processing to
    prevent actor impersonation attacks.  [[CVE-2025-54888]]


Version 1.6.7
-------------

Released on July 24, 2025.

 -  Fixed `doubleKnock()` to properly handle redirects with path-only `Location`
    headers by resolving them relative to the original request URL.
    [[#324] by Fabien O'Carroll]

[#324]: https://github.com/fedify-dev/fedify/pull/324


Version 1.6.6
-------------

Released on July 15, 2025.

 -  Fixed `TypeError: unusable` error that occurred when `doubleKnock()`
    encountered redirects during HTTP signature retry attempts.
    [[#294], [#295]]

[#294]: https://github.com/fedify-dev/fedify/issues/294
[#295]: https://github.com/fedify-dev/fedify/pull/295


Version 1.6.5
-------------

Released on July 9, 2025.

 -  Added `"default"` export conditions to all package exports in
    *package.json* for improved Node.js compatibility.


Version 1.6.4
-------------

Released on July 2, 2025.

 -  Fixed HTTP signature verification to handle malformed RFC 9421 signatures
    gracefully instead of returning `500 Internal Server Error` responses.
    Malformed signatures now properly fail verification and return appropriate
    error responses.


Version 1.6.3
-------------

Released on June 30, 2025.

 -  Fixed JSON-LD serialization of the `Question.voters` property to correctly
    serialize as a plain number (e.g., `"votersCount": 123`) instead of as a
    typed literal object (e.g., `"votersCount":{"type":"xsd:nonNegativeInteger",
    "@value":123}`).


Version 1.6.2
-------------

Released on June 19, 2025.

 -  Fixed compatibility issue with Mastodon servers running bleeding-edge
    versions with RFC 9421 implementation bugs. Extended double-knocking
    to retry with draft-cavage-http-signatures-12 on `5xx` errors as a temporary
    workaround for Mastodon's RFC 9421 implementation that returns `500
    Internal Server Error`.


Version 1.6.1
-------------

Released on June 7, 2025.  Note that 1.6.0 was skipped due to a mistake in
the versioning.

 -  Added `Context.lookupWebFinger()` method to make WebFinger lookups
    accessible from the context.  [[#227]]

 -  Added `Context.federation` property to access the `Federation`
    object from the context.  [[#235]]

 -  Added `Context.clone()` method.  [[#237]]

 -  Introduced `FederationBuilder` for creating a federation instance with
    a builder pattern.

     -  Added `createFederationBuilder()` function.
     -  Added `Federatable` interface.
     -  Added `FederationBuilder` interface.
     -  Deprecated `CreateFederationOptions` interface.  Use `FederationOptions`
         interface.

 -  Added `Router.trailingSlashInsensitive` property.

 -  Added `Router.clone()` method.

 -  Implemented HTTP Message Signatures ([RFC 9421]) with [double-knocking].
    Currently, it only works with RSA-PKCS#1-v1.5.  [[#208]]

     -  Added `HttpMessageSignaturesSpec` type.
     -  Added `SignRequestOptions.spec` option.
     -  Added `SignRequestOptions.currentTime` option.
     -  Added `VerifyRequestOptions.spec` option.
     -  Added `GetAuthenticatedDocumentLoaderOptions.specDeterminer` option.
     -  Added `GetAuthenticatedDocumentLoaderOptions.traceProvider` option.
     -  Added `HttpMessageSignaturesSpecDeterminer` interface.
     -  Added `--first-knock` option to `fedify lookup` command.

 -  Fedify now supports [Cloudflare Workers].  [[#233]]

     -  Added `Federation.processQueuedTask()` method.  [[#242]]
     -  Added `Message` type.  [[#242]]
     -  Added `WorkersKvStore` class.  [[#241], [#242]]
     -  Added `WorkersMessageQueue` class.  [[#241], [#242]]

 -  The minimum supported version of Node.js is now 22.0.0.

[RFC 9421]: https://www.rfc-editor.org/rfc/rfc9421
[double-knocking]: https://swicg.github.io/activitypub-http-signature/#how-to-upgrade-supported-versions
[Cloudflare Workers]: https://workers.cloudflare.com/
[#208]: https://github.com/fedify-dev/fedify/issues/208
[#227]: https://github.com/fedify-dev/fedify/issues/227
[#233]: https://github.com/fedify-dev/fedify/issues/233
[#235]: https://github.com/fedify-dev/fedify/pull/235
[#237]: https://github.com/fedify-dev/fedify/pull/237
[#241]: https://github.com/fedify-dev/fedify/issues/241
[#242]: https://github.com/fedify-dev/fedify/pull/242


Version 1.5.9
-------------

Released on September 17, 2025.

 -  Improved the AT Protocol URI workaround to handle all DID methods and
    edge cases. The fix now properly percent-encodes any authority component
    in `at://` URIs, supporting `did:web`, `did:key`, and other DID methods
    beyond just `did:plc`. Also handles URIs without path components
    correctly.  [[#436]]


Version 1.5.8
-------------

Released on September 17, 2025.

 -  Added a temporary workaround for invalid AT Protocol URIs from BridgyFed.
    URIs like `at://did:plc:...` that violate RFC 3986 URI syntax are now
    automatically URL-encoded to `at://did%3Aplc%3A...` to prevent parsing
    failures when processing bridged Bluesky content.  [[#436]]


Version 1.5.7
-------------

Released on August 25, 2025.

 -  Fixed a bug where `verifyRequest()` function threw a `TypeError` when
    verifying HTTP Signatures with `created` or `expires` fields in
    the `Signature` header as defined in draft-cavage-http-signatures-12,
    causing `500 Internal Server Error` responses in inbox handlers.
    Now it correctly handles these fields as unquoted integers according
    to the specification.


Version 1.5.6
-------------

Released on August 25, 2025.

 -  Fixed a bug where ActivityPub Discovery failed to recognize XHTML
    self-closing `<link>` tags. The HTML/XHTML parser now correctly handles
    whitespace before the self-closing slash (`/>`), improving compatibility
    with XHTML documents that follow the self-closing tag format.


Version 1.5.5
-------------

Released on August 8, 2025.

 -  Fixed a critical authentication bypass vulnerability in the inbox handler
    that allowed unauthenticated attackers to impersonate any ActivityPub actor.
    The vulnerability occurred because activities were processed before
    verifying that the HTTP Signatures key belonged to the claimed actor.
    Now authentication verification is performed before activity processing to
    prevent actor impersonation attacks.  [[CVE-2025-54888]]


Version 1.5.4
-------------

Released on June 30, 2025.

 -  Fixed JSON-LD serialization of the `Question.voters` property to correctly
    serialize as a plain number (e.g., `"votersCount": 123`) instead of as a
    typed literal object (e.g., `"votersCount":{"type":"xsd:nonNegativeInteger",
    "@value":123}`).


Version 1.5.3
-------------

Released on May 16, 2025.

 -  Fixed a bug where inbox handler had thrown a `jsonld.SyntaxError` which
    caused a `500 Internal Server Error` when the received activity had
    an invalid JSON-LD syntax.  Now it logs the error and responds with
    a `400 Bad Request` error instead.  [[#232]]

 -  The `exportJwk()` function now populates the `alg` property of a returned
    `JsonWebKey` object with `"Ed25519"` if the input key is an Ed25519 key.


Version 1.5.2
-------------

Released on May 11, 2025.

 -  Fixed the `fedify init` command to install the correct version of
    *@fedify/express* package.  [[#230], [#231] by Emelia Smith]

 -  The `exportJwk()` function now populates the `alg` property of a returned
    `JsonWebKey` object with `"Ed25519"` if the input key is an Ed25519 key.

[#230]: https://github.com/fedify-dev/fedify/issues/230
[#231]: https://github.com/fedify-dev/fedify/pull/231


Version 1.5.1
-------------

Released on April 8, 2025.

 -  Activity Vocabulary API became to accept [RFC 3339] date-time strings
    without a timezone offset.  This is not a bug fix, but improves
    interoperability with some implementations that do not include a timezone
    offset in their date-time strings including WordPress.  [[#226]]

 -  Added the following default context to `Undo` class:

    ~~~~ json
    {
      "litepub": "http://litepub.social/ns#",
      "toot": "http://joinmastodon.org/ns#",
      "EmojiReact": "litepub:EmojiReact",
      "Emoji": "toot:Emoji"
    }
    ~~~~


Version 1.5.0
-------------

Released on March 28, 2025.

-  Improved activity delivery performance with large audiences through
   a two-stage queuing system.  Sending activities to many recipients
   (e.g., accounts with many followers) is now significantly faster and uses
   less memory. [[#220]]

     -  Added `FederationQueueOptions.fanout` option.
     -  Changed the type of `FederationStartQueueOptions.queue` option to
        `"inbox" | "outbox" | "fanout" | undefined` (was `"inbox" | "outbox" |
        undefined`).
     -  Added `SendActivityOptions.fanout` option.
     -  Added OpenTelemetry instrumented span `activitypub.fanout`.
     -  The `ForwardActivityOptions` interface became a type alias of
        `Omit<SendActivityOptions, "fanout"> & { skipIfUnsigned: boolean }`,
        which is still compatible with the previous version.

 -  A `Federation` object now can have a canonical origin for web URLs and
    a canonical host for fediverse handles.  This affects the URLs constructed
    by `Context` objects, and the WebFinger responses.

     -  Added `CreateFederationOptions.origin` option.
     -  Added `FederationOrigin` interface.
     -  Added `Context.canonicalOrigin` property.

 -  Followers collection synchronization ([FEP-8fcf]) is now turned off by
    default.

     -  Added `SendActivityOptionsForCollection` interface.
     -  The type of `Context.sendActivity({ identifier: string } | { username:
        string } | { handle: string }, "followers", Activity)` overload's
        fourth parameter became `SendActivityOptionsForCollection | undefined`
        (was `SendActivityOptions | undefined`).

 -  Fedify now accepts PEM-PKCS#1 besides PEM-SPKI for RSA public keys.
    [[#209]]

     -  `CryptographicKey` now can contain a `publicKey` with a PEM-PKCS#1
        format (in addition to PEM-SPKI).
     -  Added `importPkcs1()` function.
     -  Added `importPem()` function.

 -  The `fetchKey()` function became to choose the public key of the actor
    if `keyId` has no fragment and the actor has only one public key.  [[#211]]

 -  Added an optional parameter with `GetSignedKeyOptions` type to
    the `RequestContext.getSignedKey()` method.

 -  Added `GetSignedKeyOptions` interface.

 -  Added an optional parameter with `GetKeyOwnerOptions` type to
    the `RequestContext.getSignedKeyOwner()` method.

 -  Deprecated the parameters of the `AuthorizePredicate` and
    `ObjectAuthorizePredicate` types to get the signed key and its owner
    in favor of the `RequestContext.getSignedKey()` and
    `RequestContext.getSignedKeyOwner()` methods.

     -  Deprecated the third parameter of the `AuthorizePredicate` type in favor
        of the `RequestContext.getSignedKey()` method.
     -  Deprecated the fourth parameter of the `AuthorizePredicate` type in
        favor of the `RequestContext.getSignedKeyOwner()` method.
     -  Deprecated the third parameter of the `ObjectAuthorizePredicate` type in
        favor of the `RequestContext.getSignedKey()` method.
     -  Deprecated the fourth parameter of the `ObjectAuthorizePredicate` type
        in favor of the `RequestContext.getSignedKeyOwner()` method.

 -  Added an optional method `enqueueMany()` to `MessageQueue` interface
    for sending multiple activities at once.

 -  Updated *@js-temporal/polyfill* to 0.5.0 for Node.js and Bun.  On Deno,
    there is no change because the polyfill is not used.

 -  Updated *uri-template-router* to 0.0.17 which fixes bundler errors on
    Rollup.  [[#221]]

 -  Improved error handling and logging for document loader when KV store
    operations fail.  [[#223] by Revath S Kumar]

 -  Fixed a bug of the `fedify inbox` command where it had failed to render
    the web interface when the `fedify` command was installed using
    `deno install` command from JSR.

 -  The web interface of the `fedify inbox` command was slightly redesigned:

     -  The Fedify logo with the cute dinosaur is now displayed at the top of
        the page.
     -  You can easily copy the fediverse handle of the ephemeral actor.

 -  Internalized the [multibase] package, which is obsolete and no longer
    maintained.  [[#127], [#215] by Fróði Karlsson]

 -  Added more log messages using the [LogTape] library.  Currently the below
    logger categories are used:

     -  `["fedify", "federation", "fanout"]`
     -  `["fedify", "federation", "object"]`

[#127]: https://github.com/fedify-dev/fedify/issues/127
[#209]: https://github.com/fedify-dev/fedify/issues/209
[#211]: https://github.com/fedify-dev/fedify/issues/211
[#215]: https://github.com/fedify-dev/fedify/pull/215
[#220]: https://github.com/fedify-dev/fedify/issues/220
[#221]: https://github.com/fedify-dev/fedify/issues/221
[#223]: https://github.com/fedify-dev/fedify/pull/223
[FEP-8fcf]: https://w3id.org/fep/8fcf
[multibase]: https://github.com/multiformats/js-multibase


Version 1.4.17
--------------

Released on September 17, 2025.

 -  Improved the AT Protocol URI workaround to handle all DID methods and
    edge cases. The fix now properly percent-encodes any authority component
    in `at://` URIs, supporting `did:web`, `did:key`, and other DID methods
    beyond just `did:plc`. Also handles URIs without path components
    correctly.  [[#436]]


Version 1.4.16
--------------

Released on September 17, 2025.

 -  Added a temporary workaround for invalid AT Protocol URIs from BridgyFed.
    URIs like `at://did:plc:...` that violate RFC 3986 URI syntax are now
    automatically URL-encoded to `at://did%3Aplc%3A...` to prevent parsing
    failures when processing bridged Bluesky content.  [[#436]]


Version 1.4.15
--------------

Released on August 25, 2025.

 -  Fixed a bug where `verifyRequest()` function threw a `TypeError` when
    verifying HTTP Signatures with `created` or `expires` fields in
    the `Signature` header as defined in draft-cavage-http-signatures-12,
    causing `500 Internal Server Error` responses in inbox handlers.
    Now it correctly handles these fields as unquoted integers according
    to the specification.


Version 1.4.14
--------------

Released on August 25, 2025.

 -  Fixed a bug where ActivityPub Discovery failed to recognize XHTML
    self-closing `<link>` tags. The HTML/XHTML parser now correctly handles
    whitespace before the self-closing slash (`/>`), improving compatibility
    with XHTML documents that follow the self-closing tag format.


Version 1.4.13
--------------

Released on August 8, 2025.

 -  Fixed a critical authentication bypass vulnerability in the inbox handler
    that allowed unauthenticated attackers to impersonate any ActivityPub actor.
    The vulnerability occurred because activities were processed before
    verifying that the HTTP Signatures key belonged to the claimed actor.
    Now authentication verification is performed before activity processing to
    prevent actor impersonation attacks.  [[CVE-2025-54888]]


Version 1.4.12
--------------

Released on June 30, 2025.

 -  Fixed JSON-LD serialization of the `Question.voters` property to correctly
    serialize as a plain number (e.g., `"votersCount": 123`) instead of as a
    typed literal object (e.g., `"votersCount":{"type":"xsd:nonNegativeInteger",
    "@value":123}`).


Version 1.4.11
--------------

Released on May 16, 2025.

 -  Fixed a bug where inbox handler had thrown a `jsonld.SyntaxError` which
    caused a `500 Internal Server Error` when the received activity had
    an invalid JSON-LD syntax.  Now it logs the error and responds with
    a `400 Bad Request` error instead.  [[#232]]

 -  The `exportJwk()` function now populates the `alg` property of a returned
    `JsonWebKey` object with `"Ed25519"` if the input key is an Ed25519 key.


Version 1.4.10
--------------

Released on April 8, 2025.

 -  Activity Vocabulary API became to accept [RFC 3339] date-time strings
    without a timezone offset.  This is not a bug fix, but improves
    interoperability with some implementations that do not include a timezone
    offset in their date-time strings including WordPress.  [[#226]]

 -  Added the following default context to `Undo` class:

    ~~~~ json
    {
      "litepub": "http://litepub.social/ns#",
      "toot": "http://joinmastodon.org/ns#",
      "EmojiReact": "litepub:EmojiReact",
      "Emoji": "toot:Emoji"
    }
    ~~~~


Version 1.4.9
-------------

Released on March 26, 2025.

 -  Fixed a `TypeError` thrown by the followers collection dispatcher when
    the `base-url` parameter was provided.

 -  Fixed a `TypeError` thrown by the `signRequest()` function on Node.js.
    [[#222]]


Version 1.4.8
-------------

Released on March 26, 2025.

 -  Fixed a bug where the `totalItems` property of `OrderedCollection`
    objects returned by followers collection dispatcher had been an incorrect
    value if a `base-url` parameter was provided.

 -  Fixed a bug where the `id` property of `OrderedCollection` and
    `OrderedCollectionPage` objects returned by followers collection dispatcher
    had been an incorrect value if a `base-url` parameter was provided.


Version 1.4.7
-------------

Released on March 20, 2025.

 -  Fixed a bug of WebFinger handler where it had failed to match
    `acct:` URIs with a host having a port number.
    [[#218], [#219] by Revath S Kumar]

 -  Fixed a server error thrown when an invalid URL was passed to the `base-url`
    parameter of the followers collection.  [[#217]]


Version 1.4.6
-------------

Released on March 9, 2025.

 -  Fedify no more depends on `node:punycode` module, which is deprecated in
    Node.js.  Now it uses the built-in `node:url` module instead.
    [[#212], [#214] by Fróði Karlsson]


Version 1.4.5
-------------

Released on February 28, 2025.

 -  Made `fedify init` to install *@fedify/h3* 0.1.2 which is compatible with
    Fedify 1.0.0 or later versions when `--web-framework nitro` option is
    provided.  [[#213]]

 -  Fixed a bug where `fedify init` had failed to initialize a project with
    the `--runtime node --package-manager pnpm --web-framework nitro` option.
    [[#213]]


Version 1.4.4
-------------

Released on February 25, 2025.

 -  Added the following default context to `Application`, `Group`,
    `Organization`, `Person`, and `Service` classes:

    ~~~~ json
    {
      "Emoji": "http://joinmastodon.org/ns#Emoji"
    }
    ~~~~


Version 1.4.3
-------------

Released on February 22, 2025.

 -  Added the following default contexts to `Follow`, `Undo`, and `Update`
    classes:

     -  <https://w3id.org/security/v1>
     -  <https://www.w3.org/ns/did/v1>
     -  <https://w3id.org/security/multikey/v1>


Version 1.4.2
-------------

Released on February 19, 2025.

 -  Fixed a bug where the `fedify init` command had failed to locate package
    managers on Windows.  [[#210]]

 -  The `fedify` command became aware of `FEDIFY_LOG_FILE` environment variable
    to log messages to a file.  If the variable is set, the command logs
    messages to the file specified by the variable.


Version 1.4.1
-------------

Released on February 10, 2025.

 -  Fixed a bug with nested object hydration in Activity Vocabulary API where
    deeply nested properties (like `Object.getAttribution()` on
    `Activity.getObject()`) were't being properly hydrated during `toJsonLd()`
    calls. Previously, subsequent calls to `toJsonLd()` on nested objects could
    result in inconsistent JSON-LD output where nested objects remained as URLs
    instead of being fully expanded.


Version 1.4.0
-------------

Released on February 5, 2025.

 -  Document loader and context loader are now configurable with a factory
    function for more flexibility.

     -  Deprecated `CreateFederationOptions.documentLoader` option.
        Use `CreateFederationOptions.documentLoaderFactory` option instead.
     -  Deprecated `CreateFederationOptions.contextLoader` option.
        Use `CreateFederationOptions.contextLoaderFactory` option instead.
     -  Added `DocumentLoaderFactory` type.
     -  Added `DocumentLoaderFactoryOptions` interface.
     -  Added the second parameter with `DocumentLoaderFactoryOptions` type
        to `AuthenticatedDocumentLoaderFactory` type.
     -  `GetAuthenticatedDocumentLoaderOptions` interface became to extend
        `DocumentLoaderFactoryOptions` interface.
     -  Added a type parameter `TContextData` to `CreateFederationOptions`
        interface.
     -  Fedify now assigns a random-generated *http:*/*https:* URI to
        activities if these do not have explicit `id` properties.  This behavior
        can be disabled by excluding `autoIdAssigner()` from
        the `CreateFederationOptions.activityTransformers` option.

 -  Introduced `ActivityTransformer`s for adjusting outgoing activities
    before sending them so that some ActivityPub implementations with quirks
    are satisfied.

     -  Added `@fedify/fedify/compat` module.
     -  Added `ActivityTransformer` type.
     -  Added `autoIdAssigner()` function.
     -  Added `actorDehydrator()` function.
     -  Added `defaultActivityTransformers` constant.
     -  Added `CreateFederationOptions.activityTransformers` option.

 -  The `suppressError` option of Activity Vocabulary APIs,
    `traverseCollection()` function, and `Context.traverseCollection()` method
    now suppresses errors occurred JSON-LD processing.

 -  WebFinger responses are now customizable.  [[#3]]

     -  Added `ActorCallbackSetters.mapAlias()` method.
     -  Added `ActorAliasMapper` type.

 -  Added `Context.getNodeInfo()` method.  [[#203]]

 -  Added `shares` property to `Object` class in Activity Vocabulary API.

     -  Added `Object.sharesId` property.
     -  Added `Object.getShares()` method.
     -  `new Object()` constructor now accepts `shares` option.
     -  `Object.clone()` method now accepts `shares` option.

 -  Added `likes` property to `Object` class in Activity Vocabulary API.

     -  Added `Object.likesId` property.
     -  Added `Object.getLikes()` method.
     -  `new Object()` constructor now accepts `likes` option.
     -  `Object.clone()` method now accepts `likes` option.

 -  Added `emojiReactions` property to `Object` class in Activity Vocabulary
    API.

     -  Added `Object.emojiReactionsId` property
     -  Added `Object.getEmojiReactions()` method.
     -  `new Object()` constructor now accepts `emojiReactions` option.
     -  `Object.clone()` method now accepts `emojiReactions` option.

 -  Added `allowPrivateAddress` option to `LookupWebFingerOptions` interface.

 -  Added more log messages using the [LogTape] library.  Currently the below
    logger categories are used:

     -  `["fedify", "compat", "transformers"]`

 -  Added `-t`/`--traverse` option to the `fedify lookup` subcommand.  [[#195]]

 -  Added `-S`/`--suppress-errors` option to the `fedify lookup` subcommand.
    [[#195]]

[#3]: https://github.com/fedify-dev/fedify/issues/3
[#195]: https://github.com/fedify-dev/fedify/issues/195


Version 1.3.24
--------------

Released on September 17, 2025.

 -  Improved the AT Protocol URI workaround to handle all DID methods and
    edge cases. The fix now properly percent-encodes any authority component
    in `at://` URIs, supporting `did:web`, `did:key`, and other DID methods
    beyond just `did:plc`. Also handles URIs without path components
    correctly.  [[#436]]


Version 1.3.23
--------------

Released on September 17, 2025.

 -  Added a temporary workaround for invalid AT Protocol URIs from BridgyFed.
    URIs like `at://did:plc:...` that violate RFC 3986 URI syntax are now
    automatically URL-encoded to `at://did%3Aplc%3A...` to prevent parsing
    failures when processing bridged Bluesky content.  [[#436]]


Version 1.3.22
--------------

Released on August 25, 2025.

 -  Fixed a bug where `verifyRequest()` function threw a `TypeError` when
    verifying HTTP Signatures with `created` or `expires` fields in
    the `Signature` header as defined in draft-cavage-http-signatures-12,
    causing `500 Internal Server Error` responses in inbox handlers.
    Now it correctly handles these fields as unquoted integers according
    to the specification.


Version 1.3.21
--------------

Released on August 25, 2025.

 -  Fixed a bug where ActivityPub Discovery failed to recognize XHTML
    self-closing `<link>` tags. The HTML/XHTML parser now correctly handles
    whitespace before the self-closing slash (`/>`), improving compatibility
    with XHTML documents that follow the self-closing tag format.


Version 1.3.20
--------------

Released on August 8, 2025.

 -  Fixed a critical authentication bypass vulnerability in the inbox handler
    that allowed unauthenticated attackers to impersonate any ActivityPub actor.
    The vulnerability occurred because activities were processed before
    verifying that the HTTP Signatures key belonged to the claimed actor.
    Now authentication verification is performed before activity processing to
    prevent actor impersonation attacks.  [[CVE-2025-54888]]

[CVE-2025-54888]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-6jcc-xgcr-q3h4


Version 1.3.19
--------------

Released on June 30, 2025.

 -  Fixed JSON-LD serialization of the `Question.voters` property to correctly
    serialize as a plain number (e.g., `"votersCount": 123`) instead of as a
    typed literal object (e.g., `"votersCount":{"type":"xsd:nonNegativeInteger",
    "@value":123}`).


Version 1.3.18
--------------

Released on May 16, 2025.

 -  Fixed a bug where inbox handler had thrown a `jsonld.SyntaxError` which
    caused a `500 Internal Server Error` when the received activity had
    an invalid JSON-LD syntax.  Now it logs the error and responds with
    a `400 Bad Request` error instead.  [[#232]]

 -  The `exportJwk()` function now populates the `alg` property of a returned
    `JsonWebKey` object with `"Ed25519"` if the input key is an Ed25519 key.


Version 1.3.17
--------------

Released on April 8, 2025.

 -  Activity Vocabulary API became to accept [RFC 3339] date-time strings
    without a timezone offset.  This is not a bug fix, but improves
    interoperability with some implementations that do not include a timezone
    offset in their date-time strings including WordPress.  [[#226]]

 -  Added the following default context to `Undo` class:

    ~~~~ json
    {
      "litepub": "http://litepub.social/ns#",
      "toot": "http://joinmastodon.org/ns#",
      "EmojiReact": "litepub:EmojiReact",
      "Emoji": "toot:Emoji"
    }
    ~~~~


Version 1.3.16
--------------

Released on March 26, 2025.

 -  Fixed a `TypeError` thrown by the followers collection dispatcher when
    the `base-url` parameter was provided.

 -  Fixed a `TypeError` thrown by the `signRequest()` function on Node.js.
    [[#222]]


Version 1.3.15
--------------

Released on March 26, 2025.

 -  Fixed a bug where the `totalItems` property of `OrderedCollection`
    objects returned by followers collection dispatcher had been an incorrect
    value if a `base-url` parameter was provided.

 -  Fixed a bug where the `id` property of `OrderedCollection` and
    `OrderedCollectionPage` objects returned by followers collection dispatcher
    had been an incorrect value if a `base-url` parameter was provided.


Version 1.3.14
--------------

Released on March 20, 2025.

 -  Fixed a bug of WebFinger handler where it had failed to match
    `acct:` URIs with a host having a port number.
    [[#218], [#219] by Revath S Kumar]

 -  Fixed a server error thrown when an invalid URL was passed to the `base-url`
    parameter of the followers collection.  [[#217]]


Version 1.3.13
--------------

Released on March 9, 2025.

 -  Fedify no more depends on `node:punycode` module, which is deprecated in
    Node.js.  Now it uses the built-in `node:url` module instead.
    [[#212], [#214] by Fróði Karlsson]


Version 1.3.12
--------------

Released on February 28, 2025.

 -  Made `fedify init` to install *@fedify/h3* 0.1.2 which is compatible with
    Fedify 1.0.0 or later versions when `--web-framework nitro` option is
    provided.  [[#213]]

 -  Fixed a bug where `fedify init` had failed to initialize a project with
    the `--runtime node --package-manager pnpm --web-framework nitro` option.
    [[#213]]


Version 1.3.11
--------------

Released on February 25, 2025.

 -  Added the following default context to `Application`, `Group`,
    `Organization`, `Person`, and `Service` classes:

    ~~~~ json
    {
      "Emoji": "http://joinmastodon.org/ns#Emoji"
    }
    ~~~~


Version 1.3.10
--------------

Released on February 22, 2025.

 -  Added the following default contexts to `Follow`, `Undo`, and `Update`
    classes:

     -  <https://w3id.org/security/v1>
     -  <https://www.w3.org/ns/did/v1>
     -  <https://w3id.org/security/multikey/v1>


Version 1.3.9
-------------

Released on February 19, 2025.

 -  Fixed a bug where the `fedify init` command had failed to locate package
    managers on Windows.  [[#210]]

 -  The `fedify` command became aware of `FEDIFY_LOG_FILE` environment variable
    to log messages to a file.  If the variable is set, the command logs
    messages to the file specified by the variable.


Version 1.3.8
-------------

Released on February 10, 2025.

 -  Fixed a bug with nested object hydration in Activity Vocabulary API where
    deeply nested properties (like `Object.getAttribution()` on
    `Activity.getObject()`) were't being properly hydrated during `toJsonLd()`
    calls. Previously, subsequent calls to `toJsonLd()` on nested objects could
    result in inconsistent JSON-LD output where nested objects remained as URLs
    instead of being fully expanded.


Version 1.3.7
-------------

Released on February 1, 2025.

 -  Updated [LogTape] to version 0.8.1, which fixes a bug where `lowestLevel`
    option had incorrectly behaved.


Version 1.3.6
-------------

Released on January 31, 2025.

 -  Fixed a bug where `getUserAgent()` function had returned a `User-Agent`
    string with a wrong JavaScript runtime name on Node.js.  [[#203]]

[#203]: https://github.com/fedify-dev/fedify/issues/203


Version 1.3.5
-------------

Released on January 21, 2025.

 -  Fixed a bug where `CreateFederationOptions.allowPrivateAddress` option had
    been ignored by the `Context.lookupObject()` method when it had taken
    a fediverse handle.

 -  The `lookupWebFinger()` function became to silently return `null` when
    it fails to fetch the WebFinger document due to accessing a private network
    address, instead of throwing a `UrlError`.


Version 1.3.4
-------------

Released on January 21, 2025.

 -  Fixed several security vulnerabilities of the `lookupWebFinger()` function.
    [[CVE-2025-23221]]

     -  Fixed a security vulnerability where the `lookupWebFinger()` function
        had followed the infinite number of redirects, which could lead to
        a denial of service attack.  Now it follows up to 5 redirects.

     -  Fixed a security vulnerability where the `lookupWebFinger()` function
        had followed the redirects to other than the HTTP/HTTPS schemes, which
        could lead to a security breach.  Now it follows only the same scheme
        as the original request.

     -  Fixed a security vulnerability where the `lookupWebFinger()` function
        had followed the redirects to the private network addresses, which
        could lead to a SSRF attack.  Now it follows only the public network
        addresses.


Version 1.3.3
-------------

Released on December 30, 2024.

 -  The `fetchDocumentLoader()` function now preloads the following JSON-LD
    context: <https://gotosocial.org/ns>.


Version 1.3.2
-------------

Released on December 18, 2024.

 -  Fixed the default document loader to handle the `Link` header with
    incorrect syntax.  [[#196]]


Version 1.3.1
-------------

Released on December 11, 2024.

 -  Fixed idempotence check in inbox listeners to ensure activities for
    different origins are processed correctly.


Version 1.3.0
-------------

Released on November 30, 2024.

 -  `MessageQueue`s now can be differently configured for incoming and outgoing
    activities.

     -  Changed the type of `CreateFederationOptions.queue` option to
        `FederationQueueOptions | MessageQueue | undefined` (was `MessageQueue |
        undefined`).
     -  Added `FederationQueueOptions` interface.
     -  Added `FederationStartQueueOptions.queue` option.

 -  Fedify now makes HTTP requests with the proper `User-Agent` header. [[#162]]

     -  Added `getUserAgent()` function.
     -  Added `GetUserAgentOptions` interface.
     -  Added `getDocumentLoader()` function.
     -  Added `GetDocumentLoaderOptions` interface.
     -  The type of `getAuthenticatedDocumentLoader()` function's second
        parameter became `GetAuthenticatedDocumentLoaderOptions | undefined`
        (was `boolean | undefined`).
     -  Added `GetAuthenticatedDocumentLoaderOptions` interface.
     -  Deprecated `fetchDocumentLoader()` function.
     -  Added `LookupObjectOptions.userAgent` option.
     -  Added the type of `getActorHandle()` function's second parameter became
        `GetActorHandleOptions | undefined` (was `NormalizeActorHandleOptions |
        undefined`).
     -  Added `GetActorHandleOptions` interface.
     -  Added the optional second parameter to `lookupWebFinger()` function.
     -  Added `LookupWebFingerOptions` interface.
     -  Added `GetNodeInfoOptions.userAgent` option.
     -  Added `-u`/`--user-agent` option to `fedify lookup` subcommand.
     -  Added `-u`/`--user-agent` option to `fedify node` subcommand.

 -  Fedify now caches unavailable keys of remote actors as well to avoid
    trying fetching the same unavailable key multiple times.

     -  The return type of the `KeyCache.get()` method became
        `Promise<CryptographicKey | MultiKey | null | undefined>` (was
        `Promise<CryptographicKey | MultiKey | null>`).
     -  The type of the `KeyCache.set()` method's second parameter became
        `CryptographicKey | MultiKey | null` (was `CryptographicKey | MultiKey`).
     -  Added `fetchKey()` function.
     -  Added `FetchKeyOptions` interface.
     -  Added `FetchKeyResult` interface.

 -  The `Router` now provide the matched route's URI template besides the name.

     -  The return type of `Router.route()` method became `RouterRouteResult |
        null` (was `{ name: string; values: Record<string, string> } | null`).
     -  Added `RouterRouteResult` interface.

 -  Added `getTypeId()` function.

 -  `Context.sendActivity()` and `InboxContext.forwardActivity()` methods now
    reject when they fail to enqueue the task.  [[#192]]

 -  Fedify now allows you to manually route an `Activity` to the corresponding
    inbox listener.  [[#193]]

     -  Added `Context.routeActivity()` method.
     -  Added `RouteActivityOptions` interface.

 -  `Object.toJsonLd()` without any `format` option now returns its original
    JSON-LD object even if it not created from `Object.fromJsonLd()` but it is
    returned from another `Object`'s `get*()` method.

 -  Fedify now supports OpenTelemetry for tracing.  [[#170]]

     -  Added `Context.tracerProvider` property.
     -  Added `CreateFederationOptions.tracerProvider` option.
     -  Added `LookupWebFingerOptions.tracerProvider` option.
     -  Added `LookupObjectOptions.tracerProvider` option.
     -  Added `GetActorHandleOptions.tracerProvider` option.
     -  Added `VerifyRequestOptions.tracerProvider` option.
     -  Added `SignRequestOptions` interface.
     -  Added the optional fourth parameter to `signRequest()` function.
     -  Added `VerifyProofOptions.tracerProvider` option.
     -  Added `VerifyObjectOptions.tracerProvider` option.
     -  Added `SignObjectOptions.tracerProvider` option.
     -  Added `VerifySignatureOptions.tracerProvider` option.
     -  Added `VerifyJsonLdOptions.tracerProvider` option.
     -  Added `SignJsonLdOptions.tracerProvider` option.
     -  Added `DoesActorOwnKeyOptions.tracerProvider` option.
     -  Added `GetKeyOwnerOptions.tracerProvider` option.

     -  Added `tracerProvider` option to the following Activity Vocabulary APIs:

         -  The second parameters of constructors.
         -  The second parameters of `fromJsonLd()` static methods.
         -  The second parameters of `get*()` methods.

 -  Added `@fedify/fedify/x/sveltekit` module for integrating with [SvelteKit]
    hook.  [[#171], [#183] by Jiyu Park]

     -  Added `fedifyHook()` function.

 -  The scaffold project generated by `fedify init` command now enables
    tracing data into log messages.

 -  Let the `fedify lookup` command take multiple arguments.
    [[#173], [#186] by PGD]


[SvelteKit]: https://kit.svelte.dev/
[#162]: https://github.com/fedify-dev/fedify/issues/162
[#170]: https://github.com/fedify-dev/fedify/issues/170
[#171]: https://github.com/fedify-dev/fedify/issues/171
[#173]: https://github.com/fedify-dev/fedify/issues/173
[#183]: https://github.com/fedify-dev/fedify/pull/183
[#186]: https://github.com/fedify-dev/fedify/pull/186
[#192]: https://github.com/fedify-dev/fedify/issues/192
[#193]: https://github.com/fedify-dev/fedify/issues/193


Version 1.2.27
--------------

Released on September 17, 2025.

 -  Improved the AT Protocol URI workaround to handle all DID methods and
    edge cases. The fix now properly percent-encodes any authority component
    in `at://` URIs, supporting `did:web`, `did:key`, and other DID methods
    beyond just `did:plc`. Also handles URIs without path components
    correctly.  [[#436]]


Version 1.2.26
--------------

Released on September 17, 2025.

 -  Added a temporary workaround for invalid AT Protocol URIs from BridgyFed.
    URIs like `at://did:plc:...` that violate RFC 3986 URI syntax are now
    automatically URL-encoded to `at://did%3Aplc%3A...` to prevent parsing
    failures when processing bridged Bluesky content.  [[#436]]


Version 1.2.25
--------------

Released on August 25, 2025.

 -  Fixed a bug where `verifyRequest()` function threw a `TypeError` when
    verifying HTTP Signatures with `created` or `expires` fields in
    the `Signature` header as defined in draft-cavage-http-signatures-12,
    causing `500 Internal Server Error` responses in inbox handlers.
    Now it correctly handles these fields as unquoted integers according
    to the specification.


Version 1.2.24
--------------

Released on August 25, 2025.

 -  Fixed a bug where ActivityPub Discovery failed to recognize XHTML
    self-closing `<link>` tags. The HTML/XHTML parser now correctly handles
    whitespace before the self-closing slash (`/>`), improving compatibility
    with XHTML documents that follow the self-closing tag format.


Version 1.2.23
--------------

Released on June 30, 2025.

 -  Fixed JSON-LD serialization of the `Question.voters` property to correctly
    serialize as a plain number (e.g., `"votersCount": 123`) instead of as a
    typed literal object (e.g., `"votersCount":{"type":"xsd:nonNegativeInteger",
    "@value":123}`).


Version 1.2.22
--------------

Released on May 16, 2025.

 -  Fixed a bug where inbox handler had thrown a `jsonld.SyntaxError` which
    caused a `500 Internal Server Error` when the received activity had
    an invalid JSON-LD syntax.  Now it logs the error and responds with
    a `400 Bad Request` error instead.  [[#232]]

 -  The `exportJwk()` function now populates the `alg` property of a returned
    `JsonWebKey` object with `"Ed25519"` if the input key is an Ed25519 key.


Version 1.2.21
--------------

Released on April 8, 2025.

 -  Activity Vocabulary API became to accept [RFC 3339] date-time strings
    without a timezone offset.  This is not a bug fix, but improves
    interoperability with some implementations that do not include a timezone
    offset in their date-time strings including WordPress.  [[#226]]

 -  Added the following default context to `Undo` class:

    ~~~~ json
    {
      "litepub": "http://litepub.social/ns#",
      "toot": "http://joinmastodon.org/ns#",
      "EmojiReact": "litepub:EmojiReact",
      "Emoji": "toot:Emoji"
    }
    ~~~~


Version 1.2.20
--------------

Released on March 26, 2025.

 -  Fixed a `TypeError` thrown by the followers collection dispatcher when
    the `base-url` parameter was provided.
 -  Fixed a `TypeError` thrown by the `signRequest()` function on Node.js.
    [[#222]]


Version 1.2.19
--------------

Released on March 26, 2025.

 -  Fixed a bug where the `totalItems` property of `OrderedCollection`
    objects returned by followers collection dispatcher had been an incorrect
    value if a `base-url` parameter was provided.

 -  Fixed a bug where the `id` property of `OrderedCollection` and
    `OrderedCollectionPage` objects returned by followers collection dispatcher
    had been an incorrect value if a `base-url` parameter was provided.


Version 1.2.18
--------------

Released on March 20, 2025.

 -  Fixed a bug of WebFinger handler where it had failed to match
    `acct:` URIs with a host having a port number.
    [[#218], [#219] by Revath S Kumar]

 -  Fixed a server error thrown when an invalid URL was passed to the `base-url`
    parameter of the followers collection.  [[#217]]


Version 1.2.17
--------------

Released on March 9, 2025.

 -  Fedify no more depends on `node:punycode` module, which is deprecated in
    Node.js.  Now it uses the built-in `node:url` module instead.
    [[#212], [#214] by Fróði Karlsson]


Version 1.2.16
--------------

Released on February 28, 2025.

 -  Made `fedify init` to install *@fedify/h3* 0.1.2 which is compatible with
    Fedify 1.0.0 or later versions when `--web-framework nitro` option is
    provided.  [[#213]]

 -  Fixed a bug where `fedify init` had failed to initialize a project with
    the `--runtime node --package-manager pnpm --web-framework nitro` option.
    [[#213]]

 -  Made `fedify init` to install *@logtape/logtape* 0.7.2 which is the version
    used in Fedify 1.2.x.


Version 1.2.15
--------------

Released on February 25, 2025.

 -  Added the following default context to `Application`, `Group`,
    `Organization`, `Person`, and `Service` classes:

    ~~~~ json
    {
      "Emoji": "http://joinmastodon.org/ns#Emoji"
    }
    ~~~~


Version 1.2.14
--------------

Released on February 22, 2025.

 -  Added the following default contexts to `Follow`, `Undo`, and `Update`
    classes:

     -  <https://w3id.org/security/v1>
     -  <https://www.w3.org/ns/did/v1>
     -  <https://w3id.org/security/multikey/v1>


Version 1.2.13
--------------

Released on February 19, 2025.

 -  Fixed a bug where the `fedify init` command had failed to locate package
    managers on Windows.  [[#210]]

 -  The `fedify` command became aware of `FEDIFY_LOG_FILE` environment variable
    to log messages to a file.  If the variable is set, the command logs
    messages to the file specified by the variable.


Version 1.2.12
--------------

Released on February 10, 2025.

 -  Fixed a bug with nested object hydration in Activity Vocabulary API where
    deeply nested properties (like `Object.getAttribution()` on
    `Activity.getObject()`) were't being properly hydrated during `toJsonLd()`
    calls. Previously, subsequent calls to `toJsonLd()` on nested objects could
    result in inconsistent JSON-LD output where nested objects remained as URLs
    instead of being fully expanded.


Version 1.2.11
--------------

Released on January 21, 2025.

 -  Fixed several security vulnerabilities of the `lookupWebFinger()` function.
    [[CVE-2025-23221]]

     -  Fixed a security vulnerability where the `lookupWebFinger()` function
        had followed the infinite number of redirects, which could lead to
        a denial of service attack.  Now it follows up to 5 redirects.

     -  Fixed a security vulnerability where the `lookupWebFinger()` function
        had followed the redirects to other than the HTTP/HTTPS schemes, which
        could lead to a security breach.  Now it follows only the same scheme
        as the original request.

     -  Fixed a security vulnerability where the `lookupWebFinger()` function
        had followed the redirects to the private network addresses, which
        could lead to a SSRF attack.  Now it follows only the public network
        addresses.


Version 1.2.10
--------------

Released on December 18, 2024.

 -  Fixed the default document loader to handle the `Link` header with
    incorrect syntax.  [[#196]]


Version 1.2.9
-------------

Released on December 11, 2024.

 -  Fixed idempotence check in inbox listeners to ensure activities for
    different origins are processed correctly.


Version 1.2.8
-------------

Released on November 23, 2024.

 -  Fixed warnings from the `fedify inbox` command.
    [[#177], [#181] by WinterHana]
 -  Fixed `ShikiError` on the `fedify inbox` command rendering web interface.
    [[#178], [#185] by Heesun Jung]
 -  Fixed text overflow of the `fedify inbox` command's web log view.
    [[#180], [#188] by Lim Kyunghee]

[#177]: https://github.com/fedify-dev/fedify/issues/177
[#181]: https://github.com/fedify-dev/fedify/pull/181


Version 1.2.7
-------------

Released on November 22, 2024.

 -  Fixed a bug where `lookupWebFinger()` function had thrown a `TypeError`
    when the *.well-known/webfinger* redirects to a relative URI.  [[#166]]


Version 1.2.6
-------------

Released on November 19, 2024.

 -  Fix a bug where `Actor`'s `inbox` and `outbox` properties had not been
    able to be set to an `OrderedCollectionPage` object, even though it is
    a subtype of `OrderedCollection` according to Activity Vocabulary
    specification.  [[#165]]

     -  The type of `Application()` constructor's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The type of `Application.clone()` method's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The return type of `Application.getInbox()` and
        `Application.getOutbox()` methods is now `OrderedCollection |
        OrderedCollectionPage | null` (was `OrderedCollection | null`).
     -  The type of `Group()` constructor's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The type of `Group.clone()` method's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The return type of `Group.getInbox()` and `Group.getOutbox()` methods
        is now `OrderedCollection | OrderedCollectionPage | null` (was
        `OrderedCollection | null`).
     -  The type of `Organization()` constructor's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The type of `Organization.clone()` method's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The return type of `Organization.getInbox()` and
        `Organization.getOutbox()` methods is now `OrderedCollection |
        OrderedCollectionPage | null` (was `OrderedCollection | null`).
     -  The type of `Person()` constructor's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The type of `Person.clone()` method's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The return type of `Person.getInbox()` and `Person.getOutbox()` methods
        is now `OrderedCollection | OrderedCollectionPage | null` (was
        `OrderedCollection | null`).
     -  The type of `Service()` constructor's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The type of `Service.clone()` method's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The return type of `Service.getInbox()` and `Service.getOutbox()`
        methods is now `OrderedCollection | OrderedCollectionPage | null` (was
        `OrderedCollection | null`).


Version 1.2.5
-------------

Released on November 14, 2024.

 -  Suppressed a `TypeError` with a message <q>unusable</q> due to Node.js's
    mysterious behavior.  [[#159]]

     -  The `verifyRequest()` function no longer throws a `TypeError`
        when a given `Request` object's body is already consumed or locked.
        Instead, it logs an error message to the `["fedify", "sig", "http"]`
        logger category and returns `null`.
     -  The `Federation.fetch()` method no longer throws a `TypeError`
        when a given `Request` object's body is already consumed or locked.
        Instead, it logs an error message to the `["fedify", "federation",
        "inbox"]` logger category and responds with a `500 Internal Server
        Error`.


Version 1.2.4
-------------

Released on November 12, 2024.

 -  Fixed a bug where default document loaders had thrown a `TypeError`
    with a message <q>Body is unusable: Body has already been read</q> or
    <q>Body already consumed</q> when the content type of the response was
    an HTML document and there's no link to a JSON-LD document.

 -  Fixed a bug where `verifySignature()` and `verifyJsonLd()` functions
    sometimes had thrown a `jsonld.ValidationError` error.  Now such errors
    are caught and logged as warnings, and the signature to verify is considered
    as invalid.


Version 1.2.3
-------------

Released on November 6, 2024.

 -  The `fedify node` subcommand now can recognize multiple values of
    the `rel` attribute in the `<link>` HTML elements.


Version 1.2.2
-------------

Released on November 1, 2024.

 -  Handle connection errors (rather than HTTP errors) in
    the `Context.sendActivity()` method.

 -  Support the `fedify` command on Windows on ARM64 via x64 emulation.
    [[#160]]

[#160]: https://github.com/fedify-dev/fedify/issues/160


Version 1.2.1
-------------

Released on October 31, 2024.

 -  Now `fedify node` command can render the node's favicon with
    `image/vnd.microsoft.icon` or `image/x-icon` format.


Version 1.2.0
-------------

Released on October 31, 2024.

 -  Added `InboxContext.recipient` property.

 -  Added NodeInfo client functions.

     -  Added `getNodeInfo()` function.
     -  Added `GetNodeInfoOptions` interface.
     -  Added `parseNodeInfo()` function.
     -  Added `ParseNodeInfoOptions` interface.

 -  Re-exported Semantic Versioning-related types and functions:

     -  Added `SemVer` type.
     -  Added `formatSemVer()` function.
     -  Added `parseSemVer()` function.

 -  Added `followedMessage` property to `Actor` type in Activity Vocabulary API.

     -  Added `Application.followedMessage` property.
     -  `new Application()` constructor now accepts `followedMessage` option.
     -  `Application.clone()` method now accepts `followedMessage` option.
     -  Added `Group.followedMessage` property.
     -  `new Group()` constructor now accepts `followedMessage` option.
     -  `Group.clone()` method now accepts `followedMessage` option.
     -  Added `Organization.followedMessage` property.
     -  `new Organization()` constructor now accepts `followedMessage` option.
     -  `Organization.clone()` method now accepts `followedMessage` option.
     -  Added `Person.followedMessage` property.
     -  `new Person()` constructor now accepts `followedMessage` option.
     -  `Person.clone()` method now accepts `followedMessage` option.
     -  Added `Service.followedMessage` property.
     -  `new Service()` constructor now accepts `followedMessage` option.
     -  `Service.clone()` method now accepts `followedMessage` option.

 -  Log messages now can be traced using [LogTape]'s [implicit contexts].
    [[#118]]

 -  Added options for an AMQP driver to `fedify init` command.

     -  Added `amqp` value to the `-q`/`--message-queue` option of
        the `fedify init` command.

 -  Added `fedify node` subcommand.

 -  Added more log messages using the [LogTape] library.  Currently the below
    logger categories are used:

     -  `["fedify", "nodeinfo", "client"]`

[implicit contexts]: https://logtape.org/manual/contexts#implicit-contexts
[#118]: https://github.com/fedify-dev/fedify/issues/118


Version 1.1.27
--------------

Released on September 17, 2025.

 -  Improved the AT Protocol URI workaround to handle all DID methods and
    edge cases. The fix now properly percent-encodes any authority component
    in `at://` URIs, supporting `did:web`, `did:key`, and other DID methods
    beyond just `did:plc`. Also handles URIs without path components
    correctly.  [[#436]]


Version 1.1.26
--------------

Released on September 17, 2025.

 -  Added a temporary workaround for invalid AT Protocol URIs from BridgyFed.
    URIs like `at://did:plc:...` that violate RFC 3986 URI syntax are now
    automatically URL-encoded to `at://did%3Aplc%3A...` to prevent parsing
    failures when processing bridged Bluesky content.  [[#436]]


Version 1.1.25
--------------

Released on August 25, 2025.

 -  Fixed a bug where `verifyRequest()` function threw a `TypeError` when
    verifying HTTP Signatures with `created` or `expires` fields in
    the `Signature` header as defined in draft-cavage-http-signatures-12,
    causing `500 Internal Server Error` responses in inbox handlers.
    Now it correctly handles these fields as unquoted integers according
    to the specification.


Version 1.1.24
--------------

Released on August 25, 2025.

 -  Fixed a bug where ActivityPub Discovery failed to recognize XHTML
    self-closing `<link>` tags. The HTML/XHTML parser now correctly handles
    whitespace before the self-closing slash (`/>`), improving compatibility
    with XHTML documents that follow the self-closing tag format.


Version 1.1.23
--------------

Released on June 30, 2025.

 -  Fixed JSON-LD serialization of the `Question.voters` property to correctly
    serialize as a plain number (e.g., `"votersCount": 123`) instead of as a
    typed literal object (e.g., `"votersCount":{"type":"xsd:nonNegativeInteger",
    "@value":123}`).


Version 1.1.22
--------------

Released on May 16, 2025.

 -  Fixed a bug where inbox handler had thrown a `jsonld.SyntaxError` which
    caused a `500 Internal Server Error` when the received activity had
    an invalid JSON-LD syntax.  Now it logs the error and responds with
    a `400 Bad Request` error instead.  [[#232]]

 -  The `exportJwk()` function now populates the `alg` property of a returned
    `JsonWebKey` object with `"Ed25519"` if the input key is an Ed25519 key.


Version 1.1.21
--------------

Released on April 8, 2025.

 -  Activity Vocabulary API became to accept [RFC 3339] date-time strings
    without a timezone offset.  This is not a bug fix, but improves
    interoperability with some implementations that do not include a timezone
    offset in their date-time strings including WordPress.  [[#226]]

 -  Added the following default context to `Undo` class:

    ~~~~ json
    {
      "litepub": "http://litepub.social/ns#",
      "toot": "http://joinmastodon.org/ns#",
      "EmojiReact": "litepub:EmojiReact",
      "Emoji": "toot:Emoji"
    }
    ~~~~


Version 1.1.20
--------------

Released on March 26, 2025.

 -  Fixed a `TypeError` thrown by the followers collection dispatcher when
    the `base-url` parameter was provided.
 -  Fixed a `TypeError` thrown by the `signRequest()` function on Node.js.
    [[#222]]


Version 1.1.19
--------------

Released on March 26, 2025.

 -  Fixed a bug where the `totalItems` property of `OrderedCollection`
    objects returned by followers collection dispatcher had been an incorrect
    value if a `base-url` parameter was provided.

 -  Fixed a bug where the `id` property of `OrderedCollection` and
    `OrderedCollectionPage` objects returned by followers collection dispatcher
    had been an incorrect value if a `base-url` parameter was provided.


Version 1.1.18
--------------

Released on March 20, 2025.

 -  Fixed a bug of WebFinger handler where it had failed to match
    `acct:` URIs with a host having a port number.
    [[#218], [#219] by Revath S Kumar]

 -  Fixed a server error thrown when an invalid URL was passed to the `base-url`
    parameter of the followers collection.  [[#217]]


Version 1.1.17
--------------

Released on March 9, 2025.

 -  Fedify no more depends on `node:punycode` module, which is deprecated in
    Node.js.  Now it uses the built-in `node:url` module instead.
    [[#212], [#214] by Fróði Karlsson]


Version 1.1.16
--------------

Released on February 28, 2025.

 -  Made `fedify init` to install *@fedify/h3* 0.1.2 which is compatible with
    Fedify 1.0.0 or later versions when `--web-framework nitro` option is
    provided.  [[#213]]

 -  Fixed a bug where `fedify init` had failed to initialize a project with
    the `--runtime node --package-manager pnpm --web-framework nitro` option.
    [[#213]]

 -  Made `fedify init` to install *@logtape/logtape* 0.6.5 which is the version
    used in Fedify 1.1.x.


Version 1.1.15
--------------

Released on February 25, 2025.

 -  Added the following default context to `Application`, `Group`,
    `Organization`, `Person`, and `Service` classes:

    ~~~~ json
    {
      "Emoji": "http://joinmastodon.org/ns#Emoji"
    }
    ~~~~


Version 1.1.14
--------------

Released on February 22, 2025.

 -  Added the following default contexts to `Follow`, `Undo`, and `Update`
    classes:

     -  <https://w3id.org/security/v1>
     -  <https://www.w3.org/ns/did/v1>
     -  <https://w3id.org/security/multikey/v1>


Version 1.1.13
--------------

Released on February 19, 2025.

 -  Fixed a bug where the `fedify init` command had failed to locate package
    managers on Windows.  [[#210]]

 -  The `fedify` command became aware of `FEDIFY_LOG_FILE` environment variable
    to log messages to a file.  If the variable is set, the command logs
    messages to the file specified by the variable.


Version 1.1.12
--------------

Released on February 10, 2025.

 -  Fixed a bug with nested object hydration in Activity Vocabulary API where
    deeply nested properties (like `Object.getAttribution()` on
    `Activity.getObject()`) were't being properly hydrated during `toJsonLd()`
    calls. Previously, subsequent calls to `toJsonLd()` on nested objects could
    result in inconsistent JSON-LD output where nested objects remained as URLs
    instead of being fully expanded.


Version 1.1.11
--------------

Released on January 21, 2025.

 -  Fixed several security vulnerabilities of the `lookupWebFinger()` function.
    [[CVE-2025-23221]]

     -  Fixed a security vulnerability where the `lookupWebFinger()` function
        had followed the infinite number of redirects, which could lead to
        a denial of service attack.  Now it follows up to 5 redirects.

     -  Fixed a security vulnerability where the `lookupWebFinger()` function
        had followed the redirects to other than the HTTP/HTTPS schemes, which
        could lead to a security breach.  Now it follows only the same scheme
        as the original request.

     -  Fixed a security vulnerability where the `lookupWebFinger()` function
        had followed the redirects to the private network addresses, which
        could lead to a SSRF attack.  Now it follows only the public network
        addresses.


Version 1.1.10
--------------

Released on December 18, 2024.

 -  Fixed the default document loader to handle the `Link` header with
    incorrect syntax.  [[#196]]


Version 1.1.9
-------------

Released on December 11, 2024.

 -  Fixed idempotence check in inbox listeners to ensure activities for
    different origins are processed correctly.


Version 1.1.8
-------------

Released on November 23, 2024.

 -  Fixed `ShikiError` on the `fedify inbox` command rendering web interface.
    [[#178], [#185] by Heesun Jung]
 -  Fixed text overflow of the `fedify inbox` command's web log view.
    [[#180], [#188] by Lim Kyunghee]

[#178]: https://github.com/fedify-dev/fedify/issues/178
[#180]: https://github.com/fedify-dev/fedify/issues/180
[#185]: https://github.com/fedify-dev/fedify/pull/185
[#188]: https://github.com/fedify-dev/fedify/pull/188


Version 1.1.7
-------------

Released on November 22, 2024.

 -  Fixed a bug where `lookupWebFinger()` function had thrown a `TypeError`
    when the *.well-known/webfinger* redirects to a relative URI.  [[#166]]


Version 1.1.6
-------------

Released on November 19, 2024.

 -  Fix a bug where `Actor`'s `inbox` and `outbox` properties had not been
    able to be set to an `OrderedCollectionPage` object, even though it is
    a subtype of `OrderedCollection` according to Activity Vocabulary
    specification.  [[#165]]

     -  The type of `Application()` constructor's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The type of `Application.clone()` method's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The return type of `Application.getInbox()` and
        `Application.getOutbox()` methods is now `OrderedCollection |
        OrderedCollectionPage | null` (was `OrderedCollection | null`).
     -  The type of `Group()` constructor's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The type of `Group.clone()` method's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The return type of `Group.getInbox()` and `Group.getOutbox()` methods
        is now `OrderedCollection | OrderedCollectionPage | null` (was
        `OrderedCollection | null`).
     -  The type of `Organization()` constructor's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The type of `Organization.clone()` method's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The return type of `Organization.getInbox()` and
        `Organization.getOutbox()` methods is now `OrderedCollection |
        OrderedCollectionPage | null` (was `OrderedCollection | null`).
     -  The type of `Person()` constructor's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The type of `Person.clone()` method's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The return type of `Person.getInbox()` and `Person.getOutbox()` methods
        is now `OrderedCollection | OrderedCollectionPage | null` (was
        `OrderedCollection | null`).
     -  The type of `Service()` constructor's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The type of `Service.clone()` method's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The return type of `Service.getInbox()` and `Service.getOutbox()`
        methods is now `OrderedCollection | OrderedCollectionPage | null` (was
        `OrderedCollection | null`).


Version 1.1.5
-------------

Released on November 14, 2024.

 -  Suppressed a `TypeError` with a message <q>unusable</q> due to Node.js's
    mysterious behavior.  [[#159]]

     -  The `verifyRequest()` function no longer throws a `TypeError`
        when a given `Request` object's body is already consumed or locked.
        Instead, it logs an error message to the `["fedify", "sig", "http"]`
        logger category and returns `null`.
     -  The `Federation.fetch()` method no longer throws a `TypeError`
        when a given `Request` object's body is already consumed or locked.
        Instead, it logs an error message to the `["fedify", "federation",
        "inbox"]` logger category and responds with a `500 Internal Server
        Error`.


Version 1.1.4
-------------

Released on November 12, 2024.

 -  Fixed a bug where default document loaders had thrown a `TypeError`
    with a message <q>Body is unusable: Body has already been read</q> or
    <q>Body already consumed</q> when the content type of the response was
    an HTML document and there's no link to a JSON-LD document.

 -  Fixed a bug where `verifySignature()` and `verifyJsonLd()` functions
    sometimes had thrown a `jsonld.ValidationError` error.  Now such errors
    are caught and logged as warnings, and the signature to verify is considered
    as invalid.


Version 1.1.3
-------------

Released on October 31, 2024.

 -  Fixed a bug where `fetchDocumentLoader()` function had disallowed
    redirecting to a private network address when the second parameter,
    a `boolean` value to allow private network addresses, was `true`.


Version 1.1.2
-------------

Released on October 27, 2024.

 -  Fixed default document loaders' incorrect handling of relative URIs in
    `Link` headers with `rel=alternate`.  [[#155] by Emelia Smith]
 -  The `fetchDocumentLoader()` function now preloads the following JSON-LD
    context: <http://schema.org/>.


Version 1.1.1
-------------

Released on October 23, 2024.

 -  The `fetchDocumentLoader()` function now preloads the following JSON-LD
    context: <https://purl.archive.org/socialweb/webfinger>.


Version 1.1.0
-------------

Released on October 20, 2024.

 -  Added utility functions for traversing remote collections. [[#150]]

     -  Added `Context.traverseCollection()` method.
     -  Added `traverseCollection()` function.
     -  Added `TraverseCollectionOptions` interface.

 -  Added `EmojiReact` class to Activity Vocabulary API.  [[FEP-c0e0]]

 -  Added `successor` property to the `Actor` types in the Activity
    Vocabulary API.

     -  Added `Application.getSuccessor()` method.
     -  `new Application()` constructor now accepts `successor` option.
     -  `Application.clone()` method now accepts `successor` option.
     -  Added `Group.getSuccessor()` method.
     -  `new Group()` constructor now accepts `successor` option.
     -  `Group.clone()` method now accepts `successor` option.
     -  Added `Organization.getSuccessor()` method.
     -  `new Organization()` constructor now accepts `successor` option.
     -  `Organization.clone()` method now accepts `successor` option.
     -  Added `Person.getSuccessor()` method.
     -  `new Person()` constructor now accepts `successor` option.
     -  `Person.clone()` method now accepts `successor` option.
     -  Added `Service.getSuccessor()` method.
     -  `new Service()` constructor now accepts `successor` option.
     -  `Service.clone()` method now accepts `successor` option.

 -  Added `DidService` class to Activity Vocabulary API.
    [[FEP-9091], [#146]]

 -  Added `Export` class to Activity Vocabulary API.
    [[FEP-9091], [#146]]

 -  Added `service` property to the `Actor` types in the Activity
    Vocabulary API.  [[FEP-9091], [#146]]

     -  Added `Application.getService()` method.
     -  Added `Application.getServices()` method.
     -  `new Application()` constructor now accepts `service` option.
     -  `new Application()` constructor now accepts `services` option.
     -  `Application.clone()` method now accepts `service` option.
     -  `Application.clone()` method now accepts `services` option.
     -  Added `Group.getService()` method.
     -  Added `Group.getServices()` method.
     -  `new Group()` constructor now accepts `service` option.
     -  `new Group()` constructor now accepts `services` option.
     -  `Group.clone()` method now accepts `service` option.
     -  `Group.clone()` method now accepts `services` option.
     -  Added `Organization.getService()` method.
     -  Added `Organization.getServices()` method.
     -  `new Organization()` constructor now accepts `service` option.
     -  `new Organization()` constructor now accepts `services` option.
     -  `Organization.clone()` method now accepts `service` option.
     -  `Organization.clone()` method now accepts `services` option.
     -  Added `Person.getService()` method.
     -  Added `Person.getServices()` method.
     -  `new Person()` constructor now accepts `service` option.
     -  `new Person()` constructor now accepts `services` option.
     -  `Person.clone()` method now accepts `service` option.
     -  `Person.clone()` method now accepts `services` option.
     -  Added `Service.getService()` method.
     -  Added `Service.getServices()` method.
     -  `new Service()` constructor now accepts `service` option.
     -  `new Service()` constructor now accepts `services` option.
     -  `Service.clone()` method now accepts `service` option.
     -  `Service.clone()` method now accepts `services` option.

 -  The default time window for verifying HTTP Signatures of incoming requests
    is now an hour (was a minute).  This new default window is according to
    the [ActivityPub and HTTP Signatures] document.

     -  The default value of `VerifyRequestOptions.timeWindow` option became
        `{ hours: 1 }` (was `{ minutes: 1 }`).

     -  The default value of `CreateFederationOptions.signatureTimeWindow`
        option became `{ hours: 1 }` (was `{ minutes: 1 }`).

     -  The type of `VerifyRequestOptions.timeWindow` property became
        `Temporal.Duration | Temporal.DurationLike | false`
        (was `Temporal.DurationLike | false`).

     -  The type of `CreateFederationOptions.signatureTimeWindow` property
        became `Temporal.Duration | Temporal.DurationLike | false`
        (was `Temporal.DurationLike | false`).

 -  In the `fedify inbox` command's web interface, the *Raw Activity* tab is
    added to show the raw JSON object of the received activity.

[FEP-c0e0]: https://w3id.org/fep/c0e0
[FEP-9091]: https://w3id.org/fep/9091
[ActivityPub and HTTP Signatures]: https://swicg.github.io/activitypub-http-signature/
[#146]: https://github.com/fedify-dev/fedify/issues/146
[#150]: https://github.com/fedify-dev/fedify/issues/150


Version 1.0.30
--------------

Released on September 17, 2025.

 -  Improved the AT Protocol URI workaround to handle all DID methods and
    edge cases. The fix now properly percent-encodes any authority component
    in `at://` URIs, supporting `did:web`, `did:key`, and other DID methods
    beyond just `did:plc`. Also handles URIs without path components
    correctly.  [[#436]]


Version 1.0.29
--------------

Released on September 17, 2025.

 -  Added a temporary workaround for invalid AT Protocol URIs from BridgyFed.
    URIs like `at://did:plc:...` that violate RFC 3986 URI syntax are now
    automatically URL-encoded to `at://did%3Aplc%3A...` to prevent parsing
    failures when processing bridged Bluesky content.  [[#436]]

[#436]: https://github.com/fedify-dev/fedify/issues/436


Version 1.0.28
--------------

Released on August 25, 2025.

 -  Fixed a bug where `verifyRequest()` function threw a `TypeError` when
    verifying HTTP Signatures with `created` or `expires` fields in
    the `Signature` header as defined in draft-cavage-http-signatures-12,
    causing `500 Internal Server Error` responses in inbox handlers.
    Now it correctly handles these fields as unquoted integers according
    to the specification.


Version 1.0.27
--------------

Released on August 25, 2025.

 -  Fixed a bug where ActivityPub Discovery failed to recognize XHTML
    self-closing `<link>` tags. The HTML/XHTML parser now correctly handles
    whitespace before the self-closing slash (`/>`), improving compatibility
    with XHTML documents that follow the self-closing tag format.


Version 1.0.26
--------------

Released on June 30, 2025.

 -  Fixed JSON-LD serialization of the `Question.voters` property to correctly
    serialize as a plain number (e.g., `"votersCount": 123`) instead of as a
    typed literal object (e.g., `"votersCount":{"type":"xsd:nonNegativeInteger",
    "@value":123}`).


Version 1.0.25
--------------

Released on May 16, 2025.

 -  Fixed a bug where inbox handler had thrown a `jsonld.SyntaxError` which
    caused a `500 Internal Server Error` when the received activity had
    an invalid JSON-LD syntax.  Now it logs the error and responds with
    a `400 Bad Request` error instead.  [[#232]]

 -  The `exportJwk()` function now populates the `alg` property of a returned
    `JsonWebKey` object with `"Ed25519"` if the input key is an Ed25519 key.

[#232]: https://github.com/fedify-dev/fedify/issues/232


Version 1.0.24
--------------

Released on April 8, 2025.

 -  Activity Vocabulary API became to accept [RFC 3339] date-time strings
    without a timezone offset.  This is not a bug fix, but improves
    interoperability with some implementations that do not include a timezone
    offset in their date-time strings including WordPress.  [[#226]]

[RFC 3339]: https://datatracker.ietf.org/doc/html/rfc3339
[#226]: https://github.com/fedify-dev/fedify/issues/226


Version 1.0.23
--------------

Released on March 26, 2025.

 -  Fixed a `TypeError` thrown by the followers collection dispatcher when
    the `base-url` parameter was provided.
 -  Fixed a `TypeError` thrown by the `signRequest()` function on Node.js.
    [[#222]]

[#222]: https://github.com/fedify-dev/fedify/issues/222


Version 1.0.22
--------------

Released on March 26, 2025.

 -  Fixed a bug where the `totalItems` property of `OrderedCollection`
    objects returned by followers collection dispatcher had been an incorrect
    value if a `base-url` parameter was provided.

 -  Fixed a bug where the `id` property of `OrderedCollection` and
    `OrderedCollectionPage` objects returned by followers collection dispatcher
    had been an incorrect value if a `base-url` parameter was provided.


Version 1.0.21
--------------

Released on March 20, 2025.

 -  Fixed a bug of WebFinger handler where it had failed to match
    `acct:` URIs with a host having a port number.
    [[#218], [#219] by Revath S Kumar]

 -  Fixed a server error thrown when an invalid URL was passed to the `base-url`
    parameter of the followers collection.  [[#217]]

[#217]: https://github.com/fedify-dev/fedify/issues/217
[#218]: https://github.com/fedify-dev/fedify/issues/218
[#219]: https://github.com/fedify-dev/fedify/pull/219


Version 1.0.20
--------------

Released on March 9, 2025.

 -  Fedify no more depends on `node:punycode` module, which is deprecated in
    Node.js.  Now it uses the built-in `node:url` module instead.
    [[#212], [#214] by Fróði Karlsson]

[#212]: https://github.com/fedify-dev/fedify/issues/212
[#214]: https://github.com/fedify-dev/fedify/pull/214


Version 1.0.19
--------------

Released on February 28, 2025.

 -  Made `fedify init` to install *@fedify/h3* 0.1.2 which is compatible with
    Fedify 1.0.0 or later versions when `--web-framework nitro` option is
    provided.  [[#213]]

 -  Fixed a bug where `fedify init` had failed to initialize a project with
    the `--runtime node --package-manager pnpm --web-framework nitro` option.
    [[#213]]

 -  Made `fedify init` to install *@logtape/logtape* 0.6.5 which is the version
    used in Fedify 1.0.x.

[#213]: https://github.com/fedify-dev/fedify/issues/213


Version 1.0.18
--------------

Released on February 25, 2025.

 -  Added the following default context to `Application`, `Group`,
    `Organization`, `Person`, and `Service` classes:

    ~~~~ json
    {
      "Emoji": "http://joinmastodon.org/ns#Emoji"
    }
    ~~~~


Version 1.0.17
--------------

Released on February 22, 2025.

 -  Added the following default contexts to `Follow`, `Undo`, and `Update`
    classes:

     -  <https://w3id.org/security/v1>
     -  <https://www.w3.org/ns/did/v1>
     -  <https://w3id.org/security/multikey/v1>


Version 1.0.16
--------------

Released on February 19, 2025.

 -  Fixed a bug where the `fedify init` command had failed to locate package
    managers on Windows.  [[#210]]

 -  The `fedify` command became aware of `FEDIFY_LOG_FILE` environment variable
    to log messages to a file.  If the variable is set, the command logs
    messages to the file specified by the variable.

[#210]: https://github.com/fedify-dev/fedify/issues/210


Version 1.0.15
--------------

Released on February 10, 2025.

 -  Fixed a bug with nested object hydration in Activity Vocabulary API where
    deeply nested properties (like `Object.getAttribution()` on
    `Activity.getObject()`) were't being properly hydrated during `toJsonLd()`
    calls. Previously, subsequent calls to `toJsonLd()` on nested objects could
    result in inconsistent JSON-LD output where nested objects remained as URLs
    instead of being fully expanded.


Version 1.0.14
--------------

Released on January 21, 2025.

 -  Fixed several security vulnerabilities of the `lookupWebFinger()` function.
    [[CVE-2025-23221]]

     -  Fixed a security vulnerability where the `lookupWebFinger()` function
        had followed the infinite number of redirects, which could lead to
        a denial of service attack.  Now it follows up to 5 redirects.

     -  Fixed a security vulnerability where the `lookupWebFinger()` function
        had followed the redirects to other than the HTTP/HTTPS schemes, which
        could lead to a security breach.  Now it follows only the same scheme
        as the original request.

     -  Fixed a security vulnerability where the `lookupWebFinger()` function
        had followed the redirects to the private network addresses, which
        could lead to a SSRF attack.  Now it follows only the public network
        addresses.

[CVE-2025-23221]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-c59p-wq67-24wx


Version 1.0.13
--------------

Released on December 18, 2024.

 -  Fixed the default document loader to handle the `Link` header with
    incorrect syntax.  [[#196]]

[#196]: https://github.com/fedify-dev/fedify/issues/196


Version 1.0.12
--------------

Released on December 11, 2024.

 -  Fixed idempotence check in inbox listeners to ensure activities for
    different origins are processed correctly.


Version 1.0.11
--------------

Released on November 22, 2024.

 -  Fixed a bug where `lookupWebFinger()` function had thrown a `TypeError`
    when the *.well-known/webfinger* redirects to a relative URI.  [[#166]]


Version 1.0.10
--------------

Released on November 19, 2024.

 -  Fix a bug where `Actor`'s `inbox` and `outbox` properties had not been
    able to be set to an `OrderedCollectionPage` object, even though it is
    a subtype of `OrderedCollection` according to Activity Vocabulary
    specification.  [[#165]]

     -  The type of `Application()` constructor's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The type of `Application.clone()` method's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The return type of `Application.getInbox()` and
        `Application.getOutbox()` methods is now `OrderedCollection |
        OrderedCollectionPage | null` (was `OrderedCollection | null`).
     -  The type of `Group()` constructor's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The type of `Group.clone()` method's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The return type of `Group.getInbox()` and `Group.getOutbox()` methods
        is now `OrderedCollection | OrderedCollectionPage | null` (was
        `OrderedCollection | null`).
     -  The type of `Organization()` constructor's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The type of `Organization.clone()` method's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The return type of `Organization.getInbox()` and
        `Organization.getOutbox()` methods is now `OrderedCollection |
        OrderedCollectionPage | null` (was `OrderedCollection | null`).
     -  The type of `Person()` constructor's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The type of `Person.clone()` method's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The return type of `Person.getInbox()` and `Person.getOutbox()` methods
        is now `OrderedCollection | OrderedCollectionPage | null` (was
        `OrderedCollection | null`).
     -  The type of `Service()` constructor's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The type of `Service.clone()` method's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The return type of `Service.getInbox()` and `Service.getOutbox()`
        methods is now `OrderedCollection | OrderedCollectionPage | null` (was
        `OrderedCollection | null`).


Version 1.0.9
-------------

Released on November 14, 2024.

 -  Suppressed a `TypeError` with a message <q>unusable</q> due to Node.js's
    mysterious behavior.  [[#159]]

     -  The `verifyRequest()` function no longer throws a `TypeError`
        when a given `Request` object's body is already consumed or locked.
        Instead, it logs an error message to the `["fedify", "sig", "http"]`
        logger category and returns `null`.
     -  The `Federation.fetch()` method no longer throws a `TypeError`
        when a given `Request` object's body is already consumed or locked.
        Instead, it logs an error message to the `["fedify", "federation",
        "inbox"]` logger category and responds with a `500 Internal Server
        Error`.


Version 1.0.8
-------------

Released on November 12, 2024.

 -  Fixed a bug where default document loaders had thrown a `TypeError`
    with a message <q>Body is unusable: Body has already been read</q> or
    <q>Body already consumed</q> when the content type of the response was
    an HTML document and there's no link to a JSON-LD document.

 -  Fixed a bug where `verifySignature()` and `verifyJsonLd()` functions
    sometimes had thrown a `jsonld.ValidationError` error.  Now such errors
    are caught and logged as warnings, and the signature to verify is considered
    as invalid.


Version 1.0.7
-------------

Released on October 31, 2024.

 -  Fixed a bug where `fetchDocumentLoader()` function had disallowed
    redirecting to a private network address when the second parameter,
    a `boolean` value to allow private network addresses, was `true`.


Version 1.0.6
-------------

Released on October 27, 2024.

 -  Fixed default document loaders' incorrect handling of relative URIs in
    `Link` headers with `rel=alternate`.  [[#155] by Emelia Smith]
 -  The `fetchDocumentLoader()` function now preloads the following JSON-LD
    context: <http://schema.org/>.


Version 1.0.5
-------------

Released on October 23, 2024.

 -  The `fetchDocumentLoader()` function now preloads the following JSON-LD
    context: <https://purl.archive.org/socialweb/webfinger>.


Version 1.0.4
-------------

Released on October 17, 2024.

 -  Fixed a bug where `Actor.aliasId` and `Actor.aliasIds` properties had been
    represented as `as:alsoKnownAs` property instead of `alsoKnownAs` property
    in compacted JSON-LD objects.

 -  Improved compatibility with Bridgy Fed for Bluesky where it puts
    an invalid URI with the format `at://...` in the `alsoKnownAs` property.


Version 1.0.3
-------------

Released on October 17, 2024.

 -  Improved compatibility with some implementations (e.g., Nexkey) where
    some `CryptographicKey` objects are incorrectly typed in JSON-LD objects.


Version 1.0.2
-------------

Released on September 27, 2024.

 -  Fixed a bug of `Object.toJsonLd()` method where it had incorrectly compacted
    the `name` property when it was not a language map.

 -  The `Delete(Application)` activities sent by the `fedify inbox` command now
    embed the entire actor object instead of just the actor's URI so that
    the peers can verify the actor's signature without fetching the actor
    object.


Version 1.0.1
-------------

Released on September 26, 2024.

 -  Fixed deprecation messages related to the `{handle}` variable in URL
    templates; they had had wrong placeholders in the message templates.

 -  Fixed a bug of `Object.toJsonLd()` method where it had not fall back to
    the proper compact form when the heuristic compact form was not available.


Version 1.0.0
--------------

Released on September 26, 2024.

 -  The term `handle` for dispatching actors is deprecated in favor of
    `identifier`.

     -  The URI template for the following methods now accepts variable
        `{identifier}` instead of `{handle}`:

         -  `Federation.setActorDispatcher()`
         -  `Federation.setInboxDispatcher()`
         -  `Federation.setOutboxDispatcher()`
         -  `Federation.setFollowingDispatcher()`
         -  `Federation.setFollowersDispatcher()`
         -  `Federation.setLikedDispatcher()`
         -  `Federation.setFeaturedDispatcher()`
         -  `Federation.setFeaturedTagsDispatcher()`
         -  `Federation.setInboxListeners()`

        The `{handle}` variable is deprecated, and it will be removed in
        the future.
     -  The type of `Federation.setActorDispatcher()` method's first parameter
        became ```${string}{identifier}${string}` |
        `${string}{handle}${string}``` (was ```${string}{handle}${string}```).
     -  The type of `Federation.setInboxDispatcher()` method's first parameter
        became ```${string}{identifier}${string}` |
        `${string}{handle}${string}``` (was ```${string}{handle}${string}```).
     -  The type of `Federation.setOutboxDispatcher()` method's first parameter
        became ```${string}{identifier}${string}` |
        `${string}{handle}${string}``` (was ```${string}{handle}${string}```).
     -  The type of `Federation.setFollowingDispatcher()` method's first
        parameter became ```${string}{identifier}${string}` |
        `${string}{handle}${string}``` (was ```${string}{handle}${string}```).
     -  The type of `Federation.setFollowersDispatcher()` method's first
        parameter became ```${string}{identifier}${string}` |
        `${string}{handle}${string}``` (was ```${string}{handle}${string}```).
     -  The type of `Federation.setLikedDispatcher()` method's first parameter
        became ```${string}{identifier}${string}` |
        `${string}{handle}${string}``` (was ```${string}{handle}${string}```).
     -  The type of `Federation.setFeaturedDispatcher()` method's first
        parameter became ```${string}{identifier}${string}` |
        `${string}{handle}${string}``` (was ```${string}{handle}${string}```).
     -  The type of `Federation.setFeaturedTagsDispatcher()` method's first
        parameter became ```${string}{identifier}${string}` |
        `${string}{handle}${string}``` (was ```${string}{handle}${string}```).
     -  The type of `Federation.setInboxListeners()` method's first parameter
        became ```${string}{identifier}${string}` |
        `${string}{handle}${string}``` (was ```${string}{handle}${string}```).
     -  The type of `Context.getDocumentLoader()` method's first parameter
        became `{ identifier: string } | { username: string } | { handle:
        string } | { keyId: URL; privateKey: CryptoKey }` (was `{ handle:
        string } | { keyId: URL; privateKey: CryptoKey }`).
     -  Passing `{ handle: string }` to `Context.getDocumentLoader()` method is
        deprecated in favor of `{ username: string }`.
     -  The type of `Context.sendActivity()` method's first parameter became
        `SenderKeyPair | SenderKeyPair[] | { identifier: string } | {
        username: string } | { handle: string }` (was `SenderKeyPair | SenderKeyPair[] | { handle: string }`).
     -  All properties of `ParseUriResult` type became readonly.
     -  Added `identifier` properties next to `handle` properties in
        `ParseUriResult` type.
     -  The `handle` properties of `ParseUriResult` type are deprecated in favor
        of `identifier` properties.
     -  The return type of `SharedInboxKeyDispatcher` callback type became
        `SenderKeyPair | { identifier: string } | { username: string } |
        { handle: string } | null | Promise<SenderKeyPair | { identifier:
        string } | { username: string } | { handle: string } | null>`
        (was `SenderKeyPair | { handle: string } | null |
        Promise<SenderKeyPair | { handle: string } | null>`).

 -  Fedify now supports [Linked Data Signatures], which is outdated but still
    widely used in the fediverse.

     -  A `Federation` object became to verify an activity's Linked Data
        Signatures if it has one.  If Linked Data Signatures are verified,
        Object Integrity Proofs and HTTP Signatures are not verified.
     -  `Context.sendActivity()` method became to sign an activity with Linked
        Data Signatures if there is at least one RSA-PKCS#1-v1.5 key pair.
     -  Added `Signature` interface.
     -  Added `signJsonLd()` function.
     -  Added `SignJsonLdOptions` interface.
     -  Added `createSignature()` function.
     -  Added `CreateSignatureOptions` interface.
     -  Added `verifyJsonLd()` function.
     -  Added `VerifyJsonLdOptions` interface.
     -  Added `verifySignature()` function.
     -  Added `VerifySignatureOptions` interface.
     -  Added `attachSignature()` function.
     -  Added `detachSignature()` function.

 -  In inbox listeners, a received activity now can be forwarded to another
    server.  [[#137]]

     -  Added `InboxContext` interface.
     -  Added `ForwardActivityOptions` interface.
     -  The first parameter of the `InboxListener` callback type became
        `InboxContext` (was `Context`).

 -  Added `cat` property to `Actor` type in Activity Vocabulary API.

     -  Added `Application.cat` property.
     -  `new Application()` constructor now accepts `cat` option.
     -  `Application.clone()` method now accepts `cat` option.
     -  Added `Group.cat` property.
     -  `new Group()` constructor now accepts `cat` option.
     -  `Group.clone()` method now accepts `cat` option.
     -  Added `Organization.cat` property.
     -  `new Organization()` constructor now accepts `cat` option.
     -  `Organization.clone()` method now accepts `cat` option.
     -  Added `Person.cat` property.
     -  `new Person()` constructor now accepts `cat` option.
     -  `Person.clone()` method now accepts `cat` option.
     -  Added `Service.cat` property.
     -  `new Service()` constructor now accepts `cat` option.
     -  `Service.clone()` method now accepts `cat` option.

 -  The `Context.parseUri()` method's parameter type became `URL | null`
    (was `URL`).

 -  `Context.sendActivity()` method now adds Object Integrity Proofs to
    the activity to be sent only once.  It had added Object Integrity Proofs
    to the activity for every recipient before.

 -  The message queue is now able to be stopped manually by providing
    an `AbortSignal` object to the `Federation.startQueue()` method.

     -  Added the optional second parameter to `Federation.startQueue()` method,
        which is a `FederationStartQueueOptions` object.
     -  Added `FederationStartQueueOptions` interface.
     -  Added the optional second parameter to `MessageQueue.listen()` method,
        which is a `MessageQueueListenOptions` object.
     -  Added `MessageQueueListenOptions` interface.
     -  The return type of `MessageQueue.listen()` method became `Promise<void>`
        (was `void`).

 -  Added `ParallelMessageQueue` class.  [[#106]]

 -  WebFinger responses now include <http://webfinger.net/rel/avatar> links
    if the `Actor` object returned by the actor dispatcher has `icon`/`icons`
    property.

 -  `DenoKvMessageQueue` now implements `Disposable` interface.

 -  The `fedify inbox` command now sends `Delete(Application)` activities when
    it's terminated so that the peers can clean up data related to the temporary
    actor.  [[#135]]

 -  Added options for PostgreSQL drivers to `fedify init` command.

     -  Added `postgres` value to the `-k`/`--kv-store` option of the `fedify
        init` command.
     -  Added `postgres` value to the `-q`/`--message-queue` option of
        the `fedify init` command.

 -  The generated project by the `fedify init` command now enables dotenv
    by default.

 -  The `fedify init` command now generates *.env* file with default values.

 -  Added more log messages using the [LogTape] library.  Currently the below
    logger categories are used:

     -  `["fedify", "sig", "ld"]`

[Linked Data Signatures]: https://web.archive.org/web/20170923124140/https://w3c-dvcg.github.io/ld-signatures/
[#106]: https://github.com/fedify-dev/fedify/issues/106
[#135]: https://github.com/fedify-dev/fedify/issues/135
[#137]: https://github.com/fedify-dev/fedify/issues/137


Version 0.15.9
--------------

Released on November 22, 2024.

 -  Fixed a bug where `lookupWebFinger()` function had thrown a `TypeError`
    when the *.well-known/webfinger* redirects to a relative URI.  [[#166]]

[#166]: https://github.com/fedify-dev/fedify/issues/166


Version 0.15.8
--------------

Released on November 19, 2024.

 -  Fix a bug where `Actor`'s `inbox` and `outbox` properties had not been
    able to be set to an `OrderedCollectionPage` object, even though it is
    a subtype of `OrderedCollection` according to Activity Vocabulary
    specification.  [[#165]]

     -  The type of `Application()` constructor's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The type of `Application.clone()` method's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The return type of `Application.getInbox()` and
        `Application.getOutbox()` methods is now `OrderedCollection |
        OrderedCollectionPage | null` (was `OrderedCollection | null`).
     -  The type of `Group()` constructor's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The type of `Group.clone()` method's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The return type of `Group.getInbox()` and `Group.getOutbox()` methods
        is now `OrderedCollection | OrderedCollectionPage | null` (was
        `OrderedCollection | null`).
     -  The type of `Organization()` constructor's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The type of `Organization.clone()` method's `inbox` and `outbox` options
        is now `OrderedCollection | OrderedCollectionPage | null | undefined`
        (was `OrderedCollection | null | undefined`).
     -  The return type of `Organization.getInbox()` and
        `Organization.getOutbox()` methods is now `OrderedCollection |
        OrderedCollectionPage | null` (was `OrderedCollection | null`).
     -  The type of `Person()` constructor's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The type of `Person.clone()` method's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The return type of `Person.getInbox()` and `Person.getOutbox()` methods
        is now `OrderedCollection | OrderedCollectionPage | null` (was
        `OrderedCollection | null`).
     -  The type of `Service()` constructor's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The type of `Service.clone()` method's `inbox` and `outbox` options is
        now `OrderedCollection | OrderedCollectionPage | null | undefined` (was
        `OrderedCollection | null | undefined`).
     -  The return type of `Service.getInbox()` and `Service.getOutbox()`
        methods is now `OrderedCollection | OrderedCollectionPage | null` (was
        `OrderedCollection | null`).

[#165]: https://github.com/fedify-dev/fedify/issues/165


Version 0.15.7
--------------

Released on November 14, 2024.

 -  Suppressed a `TypeError` with a message <q>unusable</q> due to Node.js's
    mysterious behavior.  [[#159]]

     -  The `verifyRequest()` function no longer throws a `TypeError`
        when a given `Request` object's body is already consumed or locked.
        Instead, it logs an error message to the `["fedify", "sig", "http"]`
        logger category and returns `null`.
     -  The `Federation.fetch()` method no longer throws a `TypeError`
        when a given `Request` object's body is already consumed or locked.
        Instead, it logs an error message to the `["fedify", "federation",
        "inbox"]` logger category and responds with a `500 Internal Server
        Error`.

[#159]: https://github.com/fedify-dev/fedify/issues/159


Version 0.15.6
--------------

Released on November 12, 2024.

 -  Fixed a bug where default document loaders had thrown a `TypeError`
    with a message <q>Body is unusable: Body has already been read</q> or
    <q>Body already consumed</q> when the content type of the response was
    an HTML document and there's no link to a JSON-LD document.


Version 0.15.5
--------------

Released on October 30, 2024.

 -  Fixed a bug where `fetchDocumentLoader()` function had disallowed
    redirecting to a private network address when the second parameter,
    a `boolean` value to allow private network addresses, was `true`.


Version 0.15.4
--------------

Released on October 27, 2024.

 -  Fixed default document loaders' incorrect handling of relative URIs in
    `Link` headers with `rel=alternate`.  [[#155] by Emelia Smith]
 -  The `fetchDocumentLoader()` function now preloads the following JSON-LD
    context: <http://schema.org/>.

[#155]: https://github.com/fedify-dev/fedify/pull/155


Version 0.15.3
--------------

Released on October 23, 2024.

 -  The `fetchDocumentLoader()` function now preloads the following JSON-LD
    context: <https://purl.archive.org/socialweb/webfinger>.


Version 0.15.2
--------------

Released on September 26, 2024.

 -  Fixed a bug of `Object.toJsonLd()` method where it had not fall back to
    the proper compact form when the heuristic compact form was not available.


Version 0.15.1
--------------

Released on September 15, 2024.

 -  Fixed a bug where even if the `ActorCallbackSetters.mapHandle()` method was
    called, a WebFinger username was used as an actor's handle.  [[#136]]

[#136]: https://github.com/fedify-dev/fedify/pull/136


Version 0.15.0
--------------

Released on September 11, 2024.

 -  Actors, collections, and objects now can have their URIs that do not consist
    of a WebFinger username, which means actors can change their fediverse
    handles.

     -  Added `ActorCallbackSetters.mapHandle()` method.
     -  Added `ActorHandleMapper` type.

 -  Added `quoteUrl` property to `Article`, `ChatMessage`, `Note`, and
    `Question` classes in Activity Vocabulary API.

     -  Added `Article.quoteUrl` property.
     -  `new Article()` constructor now accepts `quoteUrl` option.
     -  `Article.clone()` method now accepts `quoteUrl` option.
     -  Added `ChatMessage.quoteUrl` property.
     -  `new ChatMessage()` constructor now accepts `quoteUrl` option.
     -  `ChatMessage.clone()` method now accepts `quoteUrl` option.
     -  Added `Note.quoteUrl` property.
     -  `new Note()` constructor now accepts `quoteUrl` option.
     -  `Note.clone()` method now accepts `quoteUrl` option.
     -  Added `Question.quoteUrl` property.
     -  `new Question()` constructor now accepts `quoteUrl` option.
     -  `Question.clone()` method now accepts `quoteUrl` option.

 -  The element type of the liked collection is now `Object` or `URL` instead of
    `Like`.

     -  Changed the type of `Federation.setLikedDispatcher()` method's second
        parameter to `CollectionDispatcher<Object | URL,
        RequestContext<TContextData>, TContextData, void>` (was
        `CollectionDispatcher<Like, RequestContext<TContextData>, TContextData,
        void>`).

 -  Removed `expand` option of `Object.toJsonLd()` method, which was deprecated
    in version 0.14.0.  Use `format: "expand"` option instead.

 -  Added `Context.lookupObject()` method.

 -  Default document loaders now recognize ActivityStream objects in more ways:

     -  Loaders now recognize `alternate` ActivityStreams objects in the `Link`
        header.
     -  Loaders now recognize `alternate` ActivityStreams objects in
        the `<link>`/`<a>` HTML elements.

 -  Added `allowPrivateAddress` option to `CreateFederationOptions` interface.

 -  Fixed a bug where the WebFinger response had had a `subject` property
    with an unmatched URI to the requested resource when a non-`acct:` URI
    was given.

 -  Renamed the short option `-c` for `--compact` of `fedify lookup` command to
    `-C` to avoid conflict with the short option `-c` for `--cache-dir`.

 -  Added `-r`/`--raw` option to `fedify lookup` command to output the raw JSON
    object.


Version 0.14.5
--------------

Released on September 26, 2024.

 -  Fixed a bug of `Object.toJsonLd()` method where it had not fall back to
    the proper compact form when the heuristic compact form was not available.


Version 0.14.4
--------------

Released on September 6, 2024.

 -  Fixed a bug of `Object.fromJsonLd()` method where it had thrown
    a `TypeError` when the given JSON-LD object had an `@id` property
    with an empty string.


Version 0.14.3
--------------

Released on September 1, 2024.

 -  Fixed `fedify inbox` command where it had ignored `-a`/`--accept-follow`
    options when no `-f`/`--follow` option was provided.  [[#132]]


Version 0.14.2
--------------

Released on August 30, 2024.

 -  Fixed an incompatibility with Meta's [Threads] where sent activities had not
    been verified by their inbox.  [[#125]]


Version 0.14.1
--------------

Released on August 29, 2024.

 -  Fixed `fedify inbox` command that had not been able to parse activities
    even if they are valid JSON-LD.  [[#126]]

 -  Fixed a bug where the *Compact Activity* tab of `fedify inbox` command's
    web interface had shown an expanded JSON-LD object instead of a compacted
    one.


Version 0.14.0
--------------

Released on August 27, 2024.

 -  Removed the limitation that the `sendActivity({ handle: string },
    "followers", Activity)` overload is only available for `RequestContext`
    but not for `Context`.  Now it is available for both.  [[#115]]

     -  Added `Context.sendActivity({ handle: string }, "followers", Activity)`
        overload.
     -  Added type parameter `TContext` to `CollectionsDispatcher` type's first
        parameter to distinguish between `RequestContext` and `Context`.
     -  The first parameter of `CollectionDispatcher` type became `TContext`
        (was `RequestContext`).
     -  Added type parameter `TContext` to `CollectionsCursor` type's first
        parameter to distinguish between `RequestContext` and `Context`.
     -  The first parameter of `CollectionCursor` type became `TContext`
        (was `RequestContext`).
     -  Added type parameter `TContext` to `CollectionsCallbackSetters` type's
        first parameter to distinguish between `RequestContext` and `Context`.

 -  Added `source` property to `Object` class in Activity Vocabulary API.
    [[#114]]

     -  Added `Object.source` property.
     -  `new Object()` constructor now accepts `source` option.
     -  `Object.clone()` method now accepts `source` option.

 -  Added `Source` class to Activity Vocabulary API.  [[#114]]

 -  Added `aliases` property to `Actor` type in Activity Vocabulary API.

     -  Added `Application.getAliases()` method.
     -  Added `Application.getAlias()` method.
     -  `new Application()` constructor now accepts `alias` option.
     -  `new Application()` constructor now accepts `aliases` option.
     -  `Application.clone()` method now accepts `alias` option.
     -  `Application.clone()` method now accepts `aliases` option.
     -  Added `Group.getAliases()` method.
     -  Added `Group.getAlias()` method.
     -  `new Group()` constructor now accepts `alias` option.
     -  `new Group()` constructor now accepts `aliases` option.
     -  `Group.clone()` method now accepts `alias` option.
     -  `Group.clone()` method now accepts `aliases` option.
     -  Added `Organization.getAliases()` method.
     -  Added `Organization.getAlias()` method.
     -  `new Organization()` constructor now accepts `alias` option.
     -  `new Organization()` constructor now accepts `aliases` option.
     -  `Organization.clone()` method now accepts `alias` option.
     -  `Organization.clone()` method now accepts `aliases` option.
     -  Added `Person.getAliases()` method.
     -  Added `Person.getAlias()` method.
     -  `new Person()` constructor now accepts `alias` option.
     -  `new Person()` constructor now accepts `aliases` option.
     -  `Person.clone()` method now accepts `alias` option.
     -  `Person.clone()` method now accepts `aliases` option.
     -  Added `Service.getAliases()` method.
     -  Added `Service.getAlias()` method.
     -  `new Service()` constructor now accepts `alias` option.
     -  `new Service()` constructor now accepts `aliases` option.
     -  `Service.clone()` method now accepts `alias` option.
     -  `Service.clone()` method now accepts `aliases` option.

 -  Improved the performance of `Object.toJsonLd()` method.

     -  `Object.toJsonLd()` method no longer guarantees that the returned
        JSON-LD object is compacted unless the `format: "compact"` option is
        provided.
     -  Added `format` option to `Object.toJsonLd()` method.
     -  Deprecated `expand` option of `Object.toJsonLd()` method.
        Use `format: "expand"` option instead.
     -  The `context` option of `Object.toJsonLd()` method is now only
        applicable to `format: "compact"`.  Otherwise, it throws
        a `TypeError`.

 -  The `getActorHandle()` function now supports cross-origin WebFinger
    resources.

 -  The `lookupWebFinger()` and `getActorHandle()` functions no more throw
    an error when they fail to reach the WebFinger resource.

 -  Collection dispatchers now set the `id` property of
    the `OrderedCollection`/`OrderedCollectionPage` objects that they return
    to the their canonical URI.

 -  Now `fedify init` generates a default *tsconfig.json* file on Node.js and
    Bun, and fills the *deno.json* file with the default `compilerOptions` on
    Deno.

[#114]: https://github.com/fedify-dev/fedify/issues/114
[#115]: https://github.com/fedify-dev/fedify/issues/115


Version 0.13.5
--------------

Released on September 6, 2024.

 -  Fixed a bug of `Object.fromJsonLd()` method where it had thrown
    a `TypeError` when the given JSON-LD object had an `@id` property
    with an empty string.


Version 0.13.4
--------------

Released on September 1, 2024.

 -  Fixed `fedify inbox` command where it had ignored `-a`/`--accept-follow`
    options when no `-f`/`--follow` option was provided.  [[#132]]

[#132]: https://github.com/fedify-dev/fedify/issues/132


Version 0.13.3
--------------

Released on August 30, 2024.

 -  Fixed an incompatibility with Meta's [Threads] where sent activities had not
    been verified by their inbox.  [[#125]]

[Threads]: https://www.threads.net/
[#125]: https://github.com/fedify-dev/fedify/issues/125


Version 0.13.2
--------------

Released on August 29, 2024.

 -  Fixed `fedify inbox` command that had not been able to parse activities
    even if they are valid JSON-LD.  [[#126]]

[#126]: https://github.com/fedify-dev/fedify/issues/126


Version 0.13.1
--------------

Released on August 18, 2024.

 -  Fixed a vulnerability where the `getActorHandle()` function had trusted
    the hostname of WebFinger aliases that had not matched the hostname of the
    actor ID (URI).


Version 0.13.0
--------------

Released on August 7, 2024.

 -  Added `closed` property to `Question` class in Activity Vocabulary API.

     -  Added `Question.closed` property.
     -  `new Question()` constructor now accepts `closed` option.
     -  `Question.clone()` method now accepts `closed` option.

 -  Added `voters` property to `Question` class in Activity Vocabulary API.

     -  Added `Question.voters` property.
     -  `new Question()` constructor now accepts `voters` option.
     -  `Question.clone()` method now accepts `voters` option.

 -  HTTP Signatures verification now can be optionally skipped for the sake of
    testing.  [[#110]]

     -  The type of `CreateFederationOptions.signatureTimeWindow` property
        became `Temporal.DurationLike | false` (was `Temporal.DurationLike`).
     -  The type of `VerifyRequestOptions.timeWindow` property became
        `Temporal.DurationLike | false` (was `Temporal.DurationLike`).
     -  Added `CreateFederationOptions.skipSignatureVerification` property.

 -  Removed the singular actor key pair dispatcher APIs which were deprecated
    in version 0.10.0.

     -  Removed the last parameter of the `ActorDispatcher` callback type.
        Use `Context.getActorKeyPairs()` method instead.
     -  Removed `ActorKeyPairDispatcher` type.  Use `ActorKeyPairsDispatcher`
        type instead.
     -  Removed `ActorCallbackSetters.setKeyPairDispatcher()` method.
        Use `ActorCallbackSetters.setKeyPairsDispatcher()` method instead.
     -  Removed `Context.getActorKey()` method.
        Use `Context.getActorKeyPairs()` method instead.

 -  The `Federation` is no more a class, but an interface, which has been
    planned since version 0.10.0.  [[#69]]

     -  `new Federation()` constructor is removed.  Use `createFederation()`
        function instead.
     -  Removed `Federation.sendActivity()` method.
        Use `Context.sendActivity()` method instead.
     -  Removed `Federation` class.
     -  Added `Federation` interface.
     -  Removed `FederationParameters` interface.

 -  Added `fedify tunnel` command to expose a local HTTP server to the public
    internet.

 -  A scaffold project generated by the `fedify init` command has several
    changes:

     -  Added support for [Express] framework.
     -  Added support for [Nitro] framework.
     -  Now a scaffold project uses a [x-forwarded-fetch] middleware to
        support `X-Forwarded-Proto` and `X-Forwarded-Host` headers.
     -  Now a scaffold project has hot reloading by default.
     -  Now a scaffold project has logging configuration using the [LogTape]
        library.

 -  Added more log messages using the [LogTape] library.  Currently the below
    logger categories are used:

     -  `["fedify", "webfinger", "server"]`

[#69]: https://github.com/fedify-dev/fedify/issues/69
[#110]: https://github.com/fedify-dev/fedify/issues/110
[Express]: https://expressjs.com/
[Nitro]: https://nitro.unjs.io/


Version 0.12.3
--------------

Released on August 18, 2024.

 -  Fixed a vulnerability where the `getActorHandle()` function had trusted
    the hostname of WebFinger aliases that had not matched the hostname of the
    actor ID (URI).


Version 0.12.2
--------------

Released on July 31, 2024.

 -  Fixed a bug where incoming activities had not been enqueued even
    if the `queue` option was provided to the `createFederation()` function.


Version 0.12.1
--------------

Released on July 27, 2024.

 -  Fixed a bug where `fedify init -w hono` had generated scaffold files without
    Fedify integration.
 -  Fixed a bug where `fedify init -r bun -w hono` had generated scaffold files
    with a wrong port number (was 3000).


Version 0.12.0
--------------

Released on July 24, 2024.

 -  The `fedify` command is now [available on npm][@fedify/cli].  [[#104]]

 -  Incoming activities are now queued before being dispatched to the inbox
    listener if the `queue` option is provided to the `createFederation()`
    function.  [[#70]]

     -  The type of `InboxListener` callback type's first parameter became
        `Context` (was `RequestContext`).
     -  The type of `InboxErrorHandler` callback type's first parameter became
        `Context` (was `RequestContext`).
     -  The type of `SharedInboxKeyDispatcher` callback type's first parameter
        became `Context` (was `RequestContext`).

 -  Implemented fully customizable retry policy for failed tasks in the task
    queue.  By default, the task queue retries the failed tasks with
    an exponential backoff policy with decorrelated jitter.

     -  Added `outboxRetryPolicy` option to `CreateFederationOptions` interface.
     -  Added `inboxRetryPolicy` option to `CreateFederationOptions` interface.
        [[#70]]
     -  Added `RetryPolicy` callback type.
     -  Added `RetryContext` interface.
     -  Added `createExponentialBackoffPolicy()` function.
     -  Added `CreateExponentialBackoffPolicyOptions` interface.

 -  `Federation` object now allows its task queue to be started manually.
    [[#53]]

     -  Added `manuallyStartQueue` option to `CreateFederationOptions`
        interface.
     -  Added `Federation.startQueue()` method.

 -  Made the router able to be insensitive to trailing slashes in the URL paths.
    [[#81]]

     -  Added `trailingSlashInsensitive` option to `CreateFederationOptions`
        interface.
     -  Added `RouterOptions` interface.
     -  Added an optional parameter to `new Router()` constructor.

 -  Added `ChatMessage` class to Activity Vocabulary API.  [[#85]]

 -  Added `Move` class to Activity Vocabulary API.  [[#65], [#92] by Lee Dogeon]

 -  Added `Read` class to Activity Vocabulary API.  [[#65], [#92] by Lee Dogeon]

 -  Added `Travel` class to Activity Vocabulary API.
    [[#65], [#92] by Lee Dogeon]

 -  Added `View` class to Activity Vocabulary API.  [[#65], [#92] by Lee Dogeon]

 -  Added `TentativeAccept` class to Activity Vocabulary API.
    [[#65], [#92] by Lee Dogeon]

 -  Added `TentativeReject` class to Activity Vocabulary API.
    [[#65], [#92] by Lee Dogeon]

 -  Improved multitenancy (virtual hosting) support.  [[#66]]

     -  Added `Context.hostname` property.
     -  Added `Context.host` property.
     -  Added `Context.origin` property.
     -  The type of `ActorKeyPairsDispatcher<TContextData>`'s first parameter
        became `Context` (was `TContextData`).

 -  During verifying HTTP Signatures and Object Integrity Proofs, once fetched
    public keys are now cached.  [[#107]]

     -  The `verifyRequest()` function now caches the fetched public keys
        when the `keyCache` option is provided.
     -  The `verifyProof()` function now caches the fetched public keys
        when the `keyCache` option is provided.
     -  The `verifyObject()` function now caches the fetched public keys
        when the `keyCache` option is provided.
     -  Added `KeyCache` interface.
     -  Added `VerifyRequestOptions.keyCache` property.
     -  Added `VerifyProofOptions.keyCache` property.
     -  Added `VerifyObjectOptions.keyCache` property.
     -  Added `FederationKvPrefixes.publicKey` property.

 -  The built-in document loaders now recognize JSON-LD context provided in
    an HTTP `Link` header. [[#6]]

     -  The `fetchDocumentLoader()` function now recognizes the `Link` header
        with the `http://www.w3.org/ns/json-ld#context` link relation.
     -  The `getAuthenticatedDocumentLoader()` function now returns a document
        loader that recognizes the `Link` header with
        the `http://www.w3.org/ns/json-ld#context` link relation.

 -  Deprecated `Federation.sendActivity()` method.  Use `Context.sendActivity()`
    method instead.

 -  The last parameter of `Federation.sendActivity()` method is no longer
    optional.  Also, it now takes the required `contextData` option.

 -  Removed `Context.getHandleFromActorUri()` method which was deprecated in
    version 0.9.0.  Use `Context.parseUri()` method instead.

 -  Removed `@fedify/fedify/httpsig` module which was deprecated in version
    0.9.0.  Use `@fedify/fedify/sig` module instead.

     -  Removed `sign()` function.
     -  Removed `verify()` function.
     -  Removed `VerifyOptions` interface.

 -  Fixed a bug where the `lookupWebFinger()` function had incorrectly queried
    if the given `resource` was a URL starts with `http:` or had a non-default
    port number.

 -  Fixed a SSRF vulnerability in the built-in document loader.
    [[CVE-2024-39687]]

     -  The `fetchDocumentLoader()` function now throws an error when the given
        URL is not an HTTP or HTTPS URL or refers to a private network address.
     -  Added an optional second parameter to the `fetchDocumentLoader()`
        function, which can be used to allow fetching private network addresses.
     -  The `getAuthenticatedDocumentLoader()` function now returns a document
        loader that throws an error when the given URL is not an HTTP or HTTPS
        URL or refers to a private network address.
     -  Added an optional second parameter to
        the `getAuthenticatedDocumentLoader()` function, which can be used to
        allow fetching private network addresses.

 -  Added `fedify init` subcommand.  [[#105]]

 -  Added more log messages using the [LogTape] library.  Currently the below
    logger categories are used:

     -  `["fedify", "federation", "queue"]`

[@fedify/cli]: https://www.npmjs.com/package/@fedify/cli
[#6]: https://github.com/fedify-dev/fedify/issues/6
[#53]: https://github.com/fedify-dev/fedify/issues/53
[#66]: https://github.com/fedify-dev/fedify/issues/66
[#70]: https://github.com/fedify-dev/fedify/issues/70
[#81]: https://github.com/fedify-dev/fedify/issues/81
[#85]: https://github.com/fedify-dev/fedify/issues/85
[#92]: https://github.com/fedify-dev/fedify/pull/92
[#104]: https://github.com/fedify-dev/fedify/issues/104
[#105]: https://github.com/fedify-dev/fedify/issues/105
[#107]: https://github.com/fedify-dev/fedify/issues/107


Version 0.11.3
--------------

Released on July 15, 2024.

 -  Fixed a bug where use of `Federation.setInboxDispatcher()` after
    `Federation.setInboxListeners()` had caused a `RouterError` to be
    thrown even if the paths match.  [[#101] by Fabien O'Carroll]

[#101]: https://github.com/fedify-dev/fedify/pull/101


Version 0.11.2
--------------

Released on July 9, 2024.

 -  Fixed a vulnerability of SSRF via DNS rebinding in the built-in document
    loader.  [[CVE-2024-39687]]

     -  The `fetchDocumentLoader()` function now throws an error when the given
        domain name has any records referring to a private network address.
     -  The `getAuthenticatedDocumentLoader()` function now returns a document
        loader that throws an error when the given domain name has any records
        referring to a private network address.


Version 0.11.1
--------------

Released on July 5, 2024.

 -  Fixed a SSRF vulnerability in the built-in document loader.
    [[CVE-2024-39687]]

     -  The `fetchDocumentLoader()` function now throws an error when the given
        URL is not an HTTP or HTTPS URL or refers to a private network address.
     -  The `getAuthenticatedDocumentLoader()` function now returns a document
        loader that throws an error when the given URL is not an HTTP or HTTPS
        URL or refers to a private network address.


Version 0.11.0
--------------

Released on June 29, 2024.

 -  Improved runtime type error messages for Activity Vocabulary API.  [[#79]]

 -  Added `suppressError` option to dereferencing accessors of Activity
    Vocabulary classes.

 -  Added more collection dispatchers.  [[#78]]

     -  Added `Federation.setInboxDispatcher()` method.  [[#71]]
     -  Added `Federation.setLikedDispatcher()` method.
     -  Added `Context.getLikedUri()` method.
     -  Added `{ type: "liked"; handle: string }` case to `ParseUriResult` type.
     -  Renamed `linked` property (which was a typo) to `liked` in
        `Application`, `Group`, `Organization`, `Person`, and `Service` classes.
     -  Added `Federation.setFeaturedDispatcher()` method.
     -  Added `Context.getFeaturedUri()` method.
     -  Added `{ type: "featured"; handle: string }` case to `ParseUriResult`
        type.
     -  Added `Federation.setFeaturedTagsDispatcher()` method.
     -  Added `Context.getFeaturedTagsUri()` method.
     -  Added `{ type: "featuredTags"; handle: string }` case to
        `ParseUriResult` type.

 -  Frequently used JSON-LD contexts are now preloaded.  [[#74]]

     -  The `fetchDocumentLoader()` function now preloads the following JSON-LD
        contexts:

         -  <https://www.w3.org/ns/activitystreams>
         -  <https://w3id.org/security/v1>
         -  <https://w3id.org/security/data-integrity/v1>
         -  <https://www.w3.org/ns/did/v1>
         -  <https://w3id.org/security/multikey/v1>

     -  The default `rules` for `kvCache()` function are now 5 minutes for all
        URLs.

 -  Added `Invite` class to Activity Vocabulary API.
    [[#65], [#80] by Randy Wressell]

 -  Added `Join` class to Activity Vocabulary API.
    [[#65], [#80] by Randy Wressell]

 -  Added `Leave` class to Activity Vocabulary API.
    [[#65], [#80] by Randy Wressell]

 -  Added `Listen` class to Activity Vocabulary API.
    [[#65], [#80] by Randy Wressell]

 -  Added `Offer` class to Activity Vocabulary API.
    [[#65], [#76] by Lee Dogeon]

 -  The below properties of `Collection` and `CollectionPage` in Activity
    Vocabulary API now do not accept `Link` objects:

     -  `Collection.current`
     -  `Collection.first`
     -  `Collection.last`
     -  `CollectionPage.partOf`
     -  `CollectionPage.next`
     -  `CollectionPage.prev`

 -  Added `featured` property to `Actor` types in Activity Vocabulary API.
    [[#78]]

     -  Added `Application.getFeatured()` method.
     -  Added `Application.featuredId` property.
     -  `new Application()` constructor now accepts `featured` option.
     -  `Application.clone()` method now accepts `featured` option.
     -  Added `Group.getFeatured()` method.
     -  Added `Group.featuredId` property.
     -  `new Group()` constructor now accepts `featured` option.
     -  `Group.clone()` method now accepts `featured` option.
     -  Added `Organization.getFeatured()` method.
     -  Added `Organization.featuredId` property.
     -  `new Organization()` constructor now accepts `featured` option.
     -  `Organization.clone()` method now accepts `featured` option.
     -  Added `Person.getFeatured()` method.
     -  Added `Person.featuredId` property.
     -  `new Person()` constructor now accepts `featured` option.
     -  `Person.clone()` method now accepts `featured` option.
     -  Added `Service.getFeatured()` method.
     -  Added `Service.featuredId` property.
     -  `new Service()` constructor now accepts `featured` option.
     -  `Service.clone()` method now accepts `featured` option.

 -  Added `featuredTags` property to `Actor` types in Activity Vocabulary API.
    [[#78]]

     -  Added `Application.getFeaturedTags()` method.
     -  Added `Application.featuredTagsId` property.
     -  `new Application()` constructor now accepts `featuredTags` option.
     -  `Application.clone()` method now accepts `featuredTags` option.
     -  Added `Group.getFeaturedTags()` method.
     -  Added `Group.featuredTagsId` property.
     -  `new Group()` constructor now accepts `featuredTags` option.
     -  `Group.clone()` method now accepts `featuredTags` option.
     -  Added `Organization.getFeaturedTags()` method.
     -  Added `Organization.featuredTagsId` property.
     -  `new Organization()` constructor now accepts `featuredTags` option.
     -  `Organization.clone()` method now accepts `featuredTags` option.
     -  Added `Person.getFeaturedTags()` method.
     -  Added `Person.featuredTagsId` property.
     -  `new Person()` constructor now accepts `featuredTags` option.
     -  `Person.clone()` method now accepts `featuredTags` option.
     -  Added `Service.getFeaturedTags()` method.
     -  Added `Service.featuredTagsId` property.
     -  `new Service()` constructor now accepts `featuredTags` option.
     -  `Service.clone()` method now accepts `featuredTags` option.

 -  Added `target` property to `Activity` class in Activity Vocabulary API.

     -  Added `Activity.getTarget()` method.
     -  Added `Activity.getTargets()` method.
     -  Added `Activity.targetId` property.
     -  Added `Activity.targetIds` property.
     -  `new Activity()` constructor now accepts `target` option.
     -  `new Activity()` constructor now accepts `targets` option.
     -  `Activity.clone()` method now accepts `target` option.
     -  `Activity.clone()` method now accepts `targets` option.

 -  Added `result` property to `Activity` class in Activity Vocabulary API.

     -  Added `Activity.getResult()` method.
     -  Added `Activity.getResults()` method.
     -  Added `Activity.resultId` property.
     -  Added `Activity.resultIds` property.
     -  `new Activity()` constructor now accepts `result` option.
     -  `new Activity()` constructor now accepts `results` option.
     -  `Activity.clone()` method now accepts `result` option.
     -  `Activity.clone()` method now accepts `results` option.

 -  Added `origin` property to `Activity` class in Activity Vocabulary API.

     -  Added `Activity.getOrigin()` method.
     -  Added `Activity.getOrigins()` method.
     -  Added `Activity.originId` property.
     -  Added `Activity.originIds` property.
     -  `new Activity()` constructor now accepts `origin` option.
     -  `new Activity()` constructor now accepts `origins` option.
     -  `Activity.clone()` method now accepts `origin` option.
     -  `Activity.clone()` method now accepts `origins` option.

 -  Added `instrument` property to `Activity` class in Activity Vocabulary API.

     -  Added `Activity.getInstrument()` method.
     -  Added `Activity.getInstruments()` method.
     -  Added `Activity.instrumentId` property.
     -  Added `Activity.instrumentIds` property.
     -  `new Activity()` constructor now accepts `instrument` option.
     -  `new Activity()` constructor now accepts `instruments` option.
     -  `Activity.clone()` method now accepts `instrument` option.
     -  `Activity.clone()` method now accepts `instruments` option.

 -  The `items` property of `OrderedCollection` and `OrderedCollectionPage`
    in Activity Vocabulary API is now represented as `orderedItems`
    (was `items`) in JSON-LD.

 -  The key pair or the key pair for signing outgoing HTTP requests made from
    the shared inbox now can be configured.  This improves the compatibility
    with other ActivityPub implementations that require authorized fetches
    (i.e., secure mode).

     -  Added `SharedInboxKeyDispatcher` type.
     -  Renamed `InboxListenerSetter` interface to `InboxListenerSetters`.
     -  Added `InboxListenerSetters.setSharedKeyDispatcher()` method.

 -  Followed up the [change in `eddsa-jcs-2022` specification][eddsa-jcs-2022]
    for Object Integrity Proofs.  [[FEP-8b32], [#54]]

[eddsa-jcs-2022]: https://codeberg.org/fediverse/fep/pulls/338
[#71]: https://github.com/fedify-dev/fedify/issues/71
[#74]: https://github.com/fedify-dev/fedify/issues/74
[#76]: https://github.com/fedify-dev/fedify/pull/76
[#78]: https://github.com/fedify-dev/fedify/issues/78
[#79]: https://github.com/fedify-dev/fedify/issues/79
[#80]: https://github.com/fedify-dev/fedify/pull/80


Version 0.10.2
--------------

Released on July 9, 2024.

 -  Fixed a vulnerability of SSRF via DNS rebinding in the built-in document
    loader.  [[CVE-2024-39687]]

     -  The `fetchDocumentLoader()` function now throws an error when the given
        domain name has any records referring to a private network address.
     -  The `getAuthenticatedDocumentLoader()` function now returns a document
        loader that throws an error when the given domain name has any records
        referring to a private network address.


Version 0.10.1
--------------

Released on July 5, 2024.

 -  Fixed a SSRF vulnerability in the built-in document loader.
    [[CVE-2024-39687]]

     -  The `fetchDocumentLoader()` function now throws an error when the given
        URL is not an HTTP or HTTPS URL or refers to a private network address.
     -  The `getAuthenticatedDocumentLoader()` function now returns a document
        loader that throws an error when the given URL is not an HTTP or HTTPS
        URL or refers to a private network address.


Version 0.10.0
--------------

Released on June 18, 2024.

Starting with this release, Fedify, previously distributed under [AGPL 3.0],
is now distributed under the [MIT License] to encourage wider adoption.

 -  Besides RSA-PKCS#1-v1.5, Fedify now supports Ed25519 for signing and
    verifying the activities.  [[#55]]

     -  Added an optional parameter to `generateCryptoKeyPair()` function,
        `algorithm`, which can be either `"RSASSA-PKCS1-v1_5"` or `"Ed25519"`.
     -  The `importJwk()` function now accepts Ed25519 keys.
     -  The `exportJwk()` function now exports Ed25519 keys.
     -  The `importSpki()` function now accepts Ed25519 keys.
     -  The `exportJwk()` function now exports Ed25519 keys.

 -  Now multiple key pairs can be registered for an actor.  [[FEP-521a], [#55]]

     -  Added `Context.getActorKeyPairs()` method.
     -  Deprecated `Context.getActorKey()` method.
        Use `Context.getActorKeyPairs()` method instead.
     -  Added `ActorKeyPair` interface.
     -  Added `ActorCallbackSetters.setKeyPairsDispatcher()` method.
     -  Added `ActorKeyPairsDispatcher` type.
     -  Deprecated `ActorCallbackSetters.setKeyPairDispatcher()` method.
     -  Deprecated `ActorKeyPairDispatcher` type.
     -  Deprecated the third parameter of the `ActorDispatcher` callback type.
        Use `Context.getActorKeyPairs()` method instead.

 -  Added `Multikey` class to Activity Vocabulary API.  [[FEP-521a], [#55]]

     -  Added `importMultibaseKey()` function.
     -  Added `exportMultibaseKey()` function.

 -  Added `assertionMethod` property to the `Actor` types in the Activity
    Vocabulary API.  [[FEP-521a], [#55]]

     -  Added `Application.getAssertionMethod()` method.
     -  Added `Application.getAssertionMethods()` method.
     -  `new Application()` constructor now accepts `assertionMethod` option.
     -  `new Application()` constructor now accepts `assertionMethods` option.
     -  `Application.clone()` method now accepts `assertionMethod` option.
     -  `Application.clone()` method now accepts `assertionMethods` option.
     -  Added `Group.getAssertionMethod()` method.
     -  Added `Group.getAssertionMethods()` method.
     -  `new Group()` constructor now accepts `assertionMethod` option.
     -  `new Group()` constructor now accepts `assertionMethods` option.
     -  `Group.clone()` method now accepts `assertionMethod` option.
     -  `Group.clone()` method now accepts `assertionMethods` option.
     -  Added `Organization.getAssertionMethod()` method.
     -  Added `Organization.getAssertionMethods()` method.
     -  `new Organization()` constructor now accepts `assertionMethod` option.
     -  `new Organization()` constructor now accepts `assertionMethods` option.
     -  `Organization.clone()` method now accepts `assertionMethod` option.
     -  `Organization.clone()` method now accepts `assertionMethods` option.
     -  Added `Person.getAssertionMethod()` method.
     -  Added `Person.getAssertionMethods()` method.
     -  `new Person()` constructor now accepts `assertionMethod` option.
     -  `new Person()` constructor now accepts `assertionMethods` option.
     -  `Person.clone()` method now accepts `assertionMethod` option.
     -  `Person.clone()` method now accepts `assertionMethods` option.
     -  Added `Service.getAssertionMethod()` method.
     -  Added `Service.getAssertionMethods()` method.
     -  `new Service()` constructor now accepts `assertionMethod` option.
     -  `new Service()` constructor now accepts `assertionMethods` option.
     -  `Service.clone()` method now accepts `assertionMethod` option.
     -  `Service.clone()` method now accepts `assertionMethods` option.

 -  Added `DataIntegrityProof` class to Activity Vocabulary API.
    [[FEP-8b32], [#54]]

 -  Added `proof` property to the `Object` class in the Activity
    Vocabulary API.  [[FEP-8b32], [#54]]

     -  Added `Object.getProof()` method.
     -  Added `Object.getProofs()` method.
     -  `new Object()` constructor now accepts `proof` option.
     -  `new Object()` constructor now accepts `proofs` option.
     -  `Object.clone()` method now accepts `proof` option.
     -  `Object.clone()` method now accepts `proofs` option.

 -  Implemented Object Integrity Proofs.  [[FEP-8b32], [#54]]

     -  If there are any Ed25519 key pairs, the `Context.sendActivity()` and
        `Federation.sendActivity()` methods now make Object Integrity Proofs
        for the activity to be sent.
     -  If the incoming activity has Object Integrity Proofs, the inbox listener
        now verifies them and ignores HTTP Signatures (if any).
     -  Added `signObject()` function.
     -  Added `SignObjectOptions` interface.
     -  Added `createProof()` function.
     -  Added `CreateProofOptions` interface.
     -  Added `verifyObject()` function.
     -  Added `VerifyObjectOptions` interface.
     -  Added `verifyProof()` function.
     -  Added `VerifyProofOptions` interface.
     -  Added `SenderKeyPair` interface.
     -  The type of `Federation.sendActivity()` method's first parameter became
        `SenderKeyPair[]` (was `{ keyId: URL; privateKey: CryptoKey }`).
     -  The `Context.sendActivity()` method's first parameter now accepts
        `SenderKeyPair[]` as well.

 -  In the future, `Federation` class will become an interface.
    For the forward compatibility, the following changes are made:

     -  Added `createFederation()` function.
     -  Added `CreateFederationOptions` interface.
     -  Deprecated `new Federation()` constructor.  Use `createFederation()`
        function instead.
     -  Deprecated `FederationParameters` interface.

 -  Added `Arrive` class to Activity Vocabulary API.
    [[#65], [#68] by Randy Wressell]

 -  Added `Question` class to Activity Vocabulary API.

 -  Added `context` option to `Object.toJsonLd()` method.  This applies to
    any subclasses of the `Object` class too.

 -  Deprecated `treatHttps` option in `FederationParameters` interface.
    Instead, use the [x-forwarded-fetch] library to recognize the
    `X-Forwarded-Host` and `X-Forwarded-Proto` headers.

 -  Removed the `Federation.handle()` method which was deprecated in version
    0.6.0.

 -  Removed the `integrateHandlerOptions()` function from
    `@fedify/fedify/x/fresh` which was deprecated in version 0.6.0.

 -  Ephemeral actors and inboxes that the `fedify inbox` command spawns are
    now more interoperable with other ActivityPub implementations.

     -  Ephemeral actors now have the following properties: `summary`,
        `following`, `followers`, `outbox`, `manuallyApprovesFollowers`, and
        `url`.
     -  Improved the compatibility of the `fedify inbox` command with Misskey
        and Mitra.

 -  Added more log messages using the [LogTape] library.  Currently the below
    logger categories are used:

     -  `["fedify", "sig", "proof"]`
     -  `["fedify", "sig", "key"]`
     -  `["fedify", "vocab", "lookup"]`
     -  `["fedify", "webfinger", "lookup"]`

[#54]: https://github.com/fedify-dev/fedify/issues/54
[#55]: https://github.com/fedify-dev/fedify/issues/55
[#65]: https://github.com/fedify-dev/fedify/issues/65
[#68]: https://github.com/fedify-dev/fedify/pull/68
[AGPL 3.0]: https://www.gnu.org/licenses/agpl-3.0.en.html
[MIT License]: https://minhee.mit-license.org/
[FEP-521a]: https://w3id.org/fep/521a
[FEP-8b32]: https://w3id.org/fep/8b32
[x-forwarded-fetch]: https://github.com/dahlia/x-forwarded-fetch


Version 0.9.3
-------------

Released on July 9, 2024.

 -  Fixed a vulnerability of SSRF via DNS rebinding in the built-in document
    loader.  [[CVE-2024-39687]]

     -  The `fetchDocumentLoader()` function now throws an error when the given
        domain name has any records referring to a private network address.
     -  The `getAuthenticatedDocumentLoader()` function now returns a document
        loader that throws an error when the given domain name has any records
        referring to a private network address.


Version 0.9.2
-------------

Released on July 5, 2024.

 -  Fixed a SSRF vulnerability in the built-in document loader.
    [[CVE-2024-39687]]

     -  The `fetchDocumentLoader()` function now throws an error when the given
        URL is not an HTTP or HTTPS URL or refers to a private network address.
     -  The `getAuthenticatedDocumentLoader()` function now returns a document
        loader that throws an error when the given URL is not an HTTP or HTTPS
        URL or refers to a private network address.

[CVE-2024-39687]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-p9cg-vqcc-grcx


Version 0.9.1
-------------

Released on June 13, 2024.

 -  Fixed a bug of Activity Vocabulary API that `clone()` method of Vocabulary
    classes had not cloned the `id` property from the source object.


Version 0.9.0
-------------

Released on June 2, 2024.

 -  Added `Tombstone` class to Activity Vocabulary API.

 -  Added `Hashtag` class to Activity Vocabulary API.  [[#48]]

 -  Added `Emoji` class to Activity Vocabulary API.  [[#48]]

 -  Added an actor handle normalization function.

     -  Added `normalizeActorHandle()` function.
     -  Added `NormalizeActorHandleOptions` interface.
     -  The `getActorHandle()` function now guarantees that the returned
        actor handle is normalized.
     -  Added the second optional parameter to `getActorHandle()` function.
     -  The return type of `getActorHandle()` function became
        ``Promise<`@${string}@${string}` | `${string}@${string}`>``
        (was ``Promise<`@${string}@${string}`>``).

 -  Added `excludeBaseUris` option to `Context.sendActivity()` and
    `Federation.sendActivity()` methods.

     -  Added `SendActivityOptions.excludeBaseUris` property.
     -  Added `ExtractInboxesParameters.excludeBaseUris` property.

 -  The `Context` now can parse URIs of objects, inboxes, and collections as
    well as actors.

     -  Added `Context.parseUri()` method.
     -  Added `ParseUriResult` type.
     -  Deprecated `Context.getHandleFromActorUri()` method.

 -  The time window for signature verification is now configurable.  [[#52]]

     -  The default time window for signature verification is now a minute (was
        30 seconds).
     -  Added `signatureTimeWindow` option to `FederationParameters` interface.
     -  Added `VerifyOptions` interface.
     -  The signature of the `verify()` function is revamped; it now optionally
        takes a `VerifyOptions` object as the second parameter.

 -  Renamed the `@fedify/fedify/httpsig` module to `@fedify/fedify/sig`, and
    also:

     -  Deprecated `sign()` function.  Use `signRequest()` instead.
     -  Deprecated `verify()` function.  Use `verifyRequest()` instead.
     -  Deprecated `VerifyOptions` interface.  Use `VerifyRequestOptions`
        instead.

 -  When signing an HTTP request, the `algorithm` parameter is now added to
    the `Signature` header.  This change improves the compatibility with
    Misskey and other implementations that require the `algorithm` parameter.

 -  Added more log messages using the [LogTape] library.  Currently the below
    logger categories are used:

     -  `["fedify", "federation", "actor"]`
     -  `["fedify", "federation", "http"]`
     -  `["fedify", "sig", "http"]`
     -  `["fedify", "sig", "key"]`
     -  `["fedify", "sig", "owner"]`

[#48]: https://github.com/fedify-dev/fedify/issues/48
[#52]: https://github.com/fedify-dev/fedify/issues/52


Version 0.8.0
-------------

Released on May 6, 2024.

 -  The CLI toolchain for testing and debugging is now available on JSR:
    [@fedify/cli].  You can install it with
    `deno install -A --unstable-fs --unstable-kv --unstable-temporal -n fedify
    jsr:@fedify/cli`, or download a standalone executable from the [releases]
    page.

     -  Added `fedify` command.
     -  Added `fedify lookup` subcommand.
     -  Added `fedify inbox` subcommand.

 -  Implemented [followers collection synchronization mechanism][FEP-8fcf].

     -  Added `RequestContext.sendActivity()` overload that takes `"followers"`
        as the second parameter.
     -  Added the second type parameter to `CollectionCallbackSetters`
        interface.
     -  Added the second type parameter to `CollectionDispatcher` type.
     -  Added the fourth parameter to `CollectionDispatcher` type.
     -  Added the second type parameter to `CollectionCounter` type.
     -  Added the third parameter to `CollectionCounter` type.
     -  Added the second type parameter to `CollectionCursor` type.
     -  Added the third parameter to `CollectionCursor` type.

 -  Relaxed the required type for activity recipients.

     -  Added `Recipient` interface.
     -  The type of the second parameter of `Context.sendActivity()` method
        became `Recipient | Recipient[]` (was `Actor | Actor[]`).  However,
        since `Recipient` is a supertype of `Actor`, the existing code should
        work without any change.

 -  Followers collection now has to consist of `Recipient` objects only.
    (It could consist of `URL`s as well as `Actor`s before.)

     -  The type of `Federation.setFollowersDispatcher()` method's second
        parameter became `CollectionDispatcher<Recipient, TContextData, URL>`
        (was `CollectionDispatcher<Actor | URL, TContextData>`).

 -  Some of the responsibility of a document loader was separated to a context
    loader and a document loader.

     -  Added `contextLoader` option to constructors, `fromJsonLd()` static
        methods, `clone()` methods, and all non-scalar accessors (`get*()`) of
        Activity Vocabulary classes.
     -  Renamed `documentLoader` option to `contextLoader` in `toJsonLd()`
        methods of Activity Vocabulary objects.
     -  Added `contextLoader` option to `LookupObjectOptions` interface.
     -  Added `contextLoader` property to `Context` interface.
     -  Added `contextLoader` option to `FederationParameters` interface.
     -  Renamed `documentLoader` option to `contextLoader` in
        `RespondWithObjectOptions` interface.
     -  Added `GetKeyOwnerOptions` interface.
     -  The type of the second parameter of `getKeyOwner()` function became
        `GetKeyOwnerOptions` (was `DocumentLoader`).
     -  Added `DoesActorOwnKeyOptions` interface.
     -  The type of the third parameter of `doesActorOwnKey()` function became
        `DoesActorOwnKeyOptions` (was `DocumentLoader`).

 -  Added `width` and `height` properties to `Document` class for better
    compatibility with Mastodon.  [[#47]]

     -  Added `Document.width` property.
     -  Added `Document.height` property.
     -  `new Document()` constructor now accepts `width` option.
     -  `new Document()` constructor now accepts `height` option.
     -  `Document.clone()` method now accepts `width` option.
     -  `Document.clone()` method now accepts `height` option.

 -  Removed the dependency on *@js-temporal/polyfill* on Deno, and Fedify now
    requires `--unstable-temporal` flag.  On other runtime, it still depends
    on *@js-temporal/polyfill*.

 -  Added more log messages using the [LogTape] library.  Currently the below
    logger categories are used:

     -  `["fedify", "federation", "collection"]`
     -  `["fedify", "httpsig", "verify"]`
     -  `["fedify", "runtime", "docloader"]`

 -  Fixed a bug where the authenticated document loader had thrown `InvalidUrl`
    error when the URL redirection was involved in Bun.

 -  Fixed a bug of `lookupObject()` that it had failed to look up the actor
    object when WebFinger response had no links with
    `"type": "application/activity+json"` but had `"type":
    "application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\""`.

[@fedify/cli]: https://jsr.io/@fedify/cli
[releases]: https://github.com/fedify-dev/fedify/releases
[FEP-8fcf]: https://w3id.org/fep/8fcf
[#47]: https://github.com/fedify-dev/fedify/issues/47


Version 0.7.0
-------------

Released on April 23, 2024.

 -  Added `PUBLIC_COLLECTION` constant for [public addressing].

 -  `Federation` now supports [authorized fetch] for actor dispatcher and
    collection dispatchers.

     -  Added `ActorCallbackSetters.authorize()` method.
     -  Added `CollectionCallbackSetters.authorize()` method.
     -  Added `AuthorizedPredicate` type.
     -  Added `RequestContext.getSignedKey()` method.
     -  Added `RequestContext.getSignedKeyOwner()` method.
     -  Added `FederationFetchOptions.onUnauthorized` option for handling
        unauthorized fetches.
     -  Added `getKeyOwner()` function.

 -  The default implementation of `FederationFetchOptions.onNotAcceptable`
    option now responds with `Vary: Accept, Signature` header.

 -  Added log messages using the [LogTape] library.  Currently the below
    logger categories are used:

     -  `["fedify"]`
     -  `["fedify", "federation"]`
     -  `["fedify", "federation", "inbox"]`
     -  `["fedify", "federation", "outbox"]`

 -  Added `RequestContext.getActor()` method.

 -  Activity Vocabulary classes now have `typeId` static property.

 -  Dispatcher setters and inbox listener setters in `Federation` now take
    a path as `` `${string}{handle}${string}` `` instead of `string`
    so that it is more type-safe.

 -  Added generalized object dispatchers.  [[#33]]

     -  Added `Federation.setObjectDispatcher()` method.
     -  Added `ObjectDispatcher` type.
     -  Added `ObjectAuthorizePredicate` type.
     -  Added `Context.getObjectUri()` method.
     -  Added `RequestContext.getObject()` method.

[public addressing]: https://www.w3.org/TR/activitypub/#public-addressing
[authorized fetch]: https://swicg.github.io/activitypub-http-signature/#authorized-fetch
[LogTape]: https://github.com/dahlia/logtape
[#33]: https://github.com/fedify-dev/fedify/issues/33


Version 0.6.1
-------------

Released on April 17, 2024.

 -  Fixed a bug of `new Federation()` constructor that if it is once called
    the process will never exit.  [[#39]]


Version 0.6.0
-------------

Released on April 9, 2024.

 -  `DocumentLoader` is now propagated to the loaded remote objects from
    Activity Vocabulary objects.  [[#27]]

     -  Added `options` parameter to Activity Vocabulary constructors.
     -  Added `options` parameter to `clone()` method of Activity Vocabulary
        objects.
     -  The Activity Vocabulary object passed to `InboxListener` now implicitly
        loads remote object with an authenticated `DocumentLoader`.

 -  Added `Federation.fetch()` method.

     -  Deprecated `Federation.handle()` method.  Use `Federation.fetch()`
        method instead.
     -  Renamed `FederationHandlerParameters` type to `FederationFetchOptions`.
     -  Added `integrateFetchOptions()` function.
     -  Deprecated `integrateHandlerOptions()` function.

 -  Added `@fedify/fedify/x/hono` module for integrating with [Hono] middleware.
    [[#25]]

     -  Added `federation()` function.
     -  Added `ContextDataFactory` type.

 -  `Context.sendActivity()` method now throws `TypeError` instead of silently
    failing when the given `Activity` object lacks the actor property.

 -  `Context.sendActivity()` method now uses an authenticated document
    loader under the hood.

 -  Added outbox error handler to `Federation`.

     -  Added `onOutboxError` option to `new Federation()` constructor.
     -  Added `OutboxErrorHandler` type.

[Hono]: https://hono.dev/
[#25]: https://github.com/fedify-dev/fedify/issues/25
[#27]: https://github.com/fedify-dev/fedify/issues/27


Version 0.5.2
-------------

Released on April 17, 2024.

 -  Fixed a bug of `new Federation()` constructor that if it is once called
    the process will never exit.  [[#39]]

[#39]: https://github.com/fedify-dev/fedify/issues/39


Version 0.5.1
-------------

Released on April 5, 2024.

 -  Fixed a bug of `Federation` that its actor/collection dispatchers had done
    content negotiation before determining if the resource exists or not.
    It also fixed a bug that `integrateHandler()` from `@fedify/fedify/x/fresh`
    had responded with `406 Not Acceptable` instead of `404 Not Found` when
    the resource does not exist in the web browser.  [[#34]]

[#34]: https://github.com/fedify-dev/fedify/issues/34


Version 0.5.0
-------------

Released on April 2, 2024.

 -  Fedify is now available on npm: [@fedify/fedify].  [[#24]]

 -  Abstract key–value store for caching.

     -  Added `KvStore` interface.
     -  Added `KvStoreSetOptions` interface.
     -  Added `KvKey` type.
     -  Added `DenoKvStore` class.
     -  `KvCacheParameters.kv` option now accepts a `KvStore` instead of
        `Deno.Kv`.
     -  `KvCacheParameters.prefix` option now accepts a `KvKey` instead of
        `Deno.KvKey`.
     -  `FederationParameters.kv` option now accepts a `KvStore` instead of
        `Deno.Kv`.
     -  `FederationKvPrefixes.activityIdempotence` option now accepts a `KvKey`
        instead of `Deno.KvKey`.
     -  `FederationKvPrefixes.remoteDocument` option now accepts a `KvKey`
        instead of `Deno.KvKey`.

 -  Abstract message queue for outgoing activities.

     -  Added `MessageQueue` interface.
     -  Added `MessageQueueEnqueueOptions` interface.
     -  Added `InProcessMessageQueue` class.
     -  Added `FederationParameters.queue` option.

 -  Added `@fedify/fedify/x/denokv` module for adapting `Deno.Kv` to `KvStore`
    and `MessageQueue`.  It is only available in Deno runtime.

     -  Added `DenoKvStore` class.
     -  Added `DenoKvMessageQueue` class.

 -  Added `PropertyValue` to Activity Vocabulary API.  [[#29]]

     -  Added `PropertyValue` class.
     -  `new Object()` constructor's `attachments` option now accepts
        `PropertyValue` objects.
     -  `new Object()` constructor's `attachment` option now accepts
        a `PropertyValue` object.
     -  `Object.getAttachments()` method now yields `PropertyValue` objects
        besides `Object` and `Link` objects.
     -  `Object.getAttachment()` method now returns a `PropertyValue` object
        besides an `Object` and a `Link` object.
     -  `Object.clone()` method's `attachments` option now accepts
        `PropertyValue` objects.
     -  `Object.clone()` method's `attachment` option now accepts
        a `PropertyValue` object.

 -  Removed dependency on *jose*.

     -  Added `exportSpki()` function.
     -  Added `importSpki()` function.

 -  Fixed a bug that `Application.manuallyApprovesFollowers`,
    `Group.manuallyApprovesFollowers`, `Organization.manuallyApprovesFollowers`,
    `Person.manuallyApprovesFollowers`, and `Service.manuallyApprovesFollowers`
    properties were not properly displayed in Mastodon.

[@fedify/fedify]: https://www.npmjs.com/package/@fedify/fedify
[#24]: https://github.com/fedify-dev/fedify/discussions/24
[#29]: https://github.com/fedify-dev/fedify/issues/29


Version 0.4.0
-------------

Released on March 26, 2024.

 -  Added `@fedify/fedify/x/fresh` module for integrating with [Fresh]
    middleware.

     -  Added `integrateHandler()` function.
     -  Added `integrateHandlerOptions()` function.

 -  Added `getActorHandle()` function.

 -  Fedify now has authenticated document loader.  [[#12]]

     -  Added `Context.getDocumentLoader()` method.
     -  Added `getAuthenticatedDocumentLoader()` function.
     -  Added `AuthenticatedDocumentLoaderFactory` type.
     -  Added `authenticatedDocumentLoaderFactory` option to `new Federation()`
        constructor.
     -  `Context.documentLoader` property now returns an authenticated document
        loader in personal inbox listeners.  (Note that it's not affected in
        shared inbox listeners.)

 -  Added singular accessors to `Object`'s `icon` and `image` properties.

     -  `new Object()` constructor now accepts `icon` option.
     -  `new Object()` constructor now accepts `image` option.
     -  Added `Object.getIcon()` method.
     -  Added `Object.getImage()` method.
     -  `Object.clone()` method now accepts `icon` option.
     -  `Object.clone()` method now accepts `image` option.

 -  `Object`'s `icon` and `image` properties no more accept `Link` objects.

     -  `new Object()` constructor's `icons` option no more accepts `Link`
        objects.
     -  `new Object()` constructor's `images` option no more accepts `Link`
        objects.
     -  `Object.getIcons()` method no more yields `Link` objects.
     -  `Object.getImages()` method no more yields `Link` objects.
     -  `Object.clone()` method's `icons` option no more accepts `Link` objects.
     -  `Object.clone()` method's `images` option no more accepts `Link`
        objects.

 -  `Object`'s `attributedTo` property was renamed to `attribution`.

    -  `new Object()` constructor's `attributedTo` option was renamed to
       `attribution`.
    -  `new Object()` constructor's `attributedTos` option was renamed to
       `attributions`.
    -  `Object.getAttributedTo()` method is renamed to
       `Object.getAttribution()`.
    -  `Object.getAttributedTos()` method is renamed to
       `Object.getAttributions()`.
    -  `Object.clone()` method's `attributedTo` option is renamed to
       `attribution`.
    -  `Object.clone()` method's `attributedTos` option is renamed to
       `attributions`.

 -  `Object`'s `attribution` property (was `attributedTo`) now accepts only
    `Actor` objects.

     -  `new Object()` constructor's `attribution` option (was `attributedTo`)
        now accepts only an `Actor` object.
     -  `new Object()` constructor's `attributions` option (was `attributedTos`)
        now accepts only `Actor` objects.
     -  `Object.getAttribution()` method (was `getAttributedTo()`) now returns
        only an `Actor` object.
     -  `Object.getAttributions()` method (was `getAttributedTos()`) now returns
        only `Actor` objects.
     -  `Object.clone()` method's `attribution` option (`attributedTo`) now
        accepts only an `Actor` object.
     -  `Object.clone()` method's `attributions` option (`attributedTos`) now
        accepts only `Actor` objects.

 -  `Activity`'s `object` property no more accepts `Link` objects.

     -  `new Activity()` constructor's `object` option no more accepts a `Link`
        object.
     -  `new Activity()` constructor's `objects` option no more accepts `Link`
        objects.
     -  `Activity.getObject()` method no more returns a `Link` object.
     -  `Activity.getObjects()` method no more returns `Link` objects.
     -  `Activity.clone()` method's `object` option no more accepts a `Link`
        object.
     -  `Activity.clone()` method's `objects` option no more accepts `Link`
        objects.

 -  `Activity`'s `actor` property now accepts only `Actor` objects.

     -  `new Activity()` constructor's `actor` option now accepts only
        an `Actor` object.
     -  `new Activity()` constructor's `actors` option now accepts only `Actor`
        objects.
     -  `Activity.getActor()` method now returns only an `Actor` object.
     -  `Activity.getActors()` method now returns only `Actor` objects.
     -  `Activity.clone()` method's `actor` option now accepts only an `Actor`
        object.
     -  `Activity.clone()` method's `actors` option now accepts only `Actor`
        objects.

 -  Added `sensitive` property to `Object` class.

     -  `new Object()` constructor now accepts `sensitive` option.
     -  Added `Object.sensitive` attribute.
     -  `Object.clone()` method now accepts `sensitive` option.

 -  Now `lookupWebFinger()` follows redirections.

 -  The `http://webfinger.net/rel/profile-page` links in WebFinger responses
    now omit `type` property.

[Fresh]: https://fresh.deno.dev/
[#12]: https://github.com/fedify-dev/fedify/issues/12


Version 0.3.0
-------------

Released on March 15, 2024.

 -  Added utility functions for responding with an ActivityPub object:

     -  Added `respondWithObject()` function.
     -  Added `respondWithObjectIfAcceptable()` function.
     -  Added `RespondWithObjectOptions` interface.

 -  Added utility functions for generating and exporting cryptographic keys
    which are compatible with popular ActivityPub software:

     -  Added `generateCryptoKeyPair()` function.
     -  Added `exportJwk()` function.
     -  Added `importJwk()` function.

 -  The following functions and methods now throw `TypeError` if the specified
    `CryptoKey` is not `extractable`:

     -  `Context.getActorKey()` method
     -  `Context.sendActivity()` method
     -  `Federation.sendActivity()` method

 -  Added `immediate` option to `Context.sendActivity()` and
    `Federation.sendActivity()` methods.

 -  Added `SendActivityOptions` interface.

 -  Now `onNotFound`/`onNotAcceptable` options are optional for
    `Federation.handle()` method.  [[#9]]

[#9]: https://github.com/fedify-dev/fedify/issues/9


Version 0.2.0
-------------

Released on March 10, 2024.

 -  Implemented [NodeInfo] 2.1 protocol.  [[#1]]

     -  Now `Federation.handle()` accepts requests for */.well-known/nodeinfo*.
     -  Added `Federation.setNodeInfoDispatcher()` method.
     -  Added `Context.getNodeInfoUri()` method.
     -  Added `NodeInfo` interface.
     -  Added `Software` interface.
     -  Added `Protocol` type.
     -  Added `Services` interface.
     -  Added `InboundService` type.
     -  Added `OutboundService` type.
     -  Added `Usage` interface.
     -  Added `NodeInfoDispatcher` type.
     -  Added `nodeInfoToJson()` function.

 -  Implemented [WebFinger] client.

     -  Added `lookupObject()` function.
     -  Added `lookupWebFinger()` function.

 -  `Federation.handle()` now responds with `Access-Control-Allow-Origin: *`
    header for WebFinger requests.

 -  `fetchDocumentLoader()`, the default document loader, now sends `Accept:
    application/activity+json, application/ld+json` header (was `Accept:
    application/ld+json` only).

[NodeInfo]: https://nodeinfo.diaspora.software/
[WebFinger]: https://datatracker.ietf.org/doc/html/rfc7033
[#1]: https://github.com/fedify-dev/fedify/issues/1


Version 0.1.0
-------------

Initial release.  Released on March 8, 2024.

<!-- cSpell: ignore Dogeon Fabien Wressell Emelia Fróði Karlsson -->
<!-- cSpell: ignore Hana Heesun Kyunghee Jiyu Revath Kumar Jaeyeol -->
<!-- cSpell: ignore Jiwon Kwon Hyeonseo Chanhaeng Hasang Hyunchae KeunHyeong -->
<!-- cSpell: ignore Jang Hanarae ByeongJun Subin -->
<!-- cSpell: ignore Wayst Konsole Ghostty Aplc -->
