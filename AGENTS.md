<!-- deno-fmt-ignore-file -->

Fedify LLM coding agent instructions
====================================

This file contains instructions for LLM coding agents working with the Fedify
codebase.


Project overview
----------------

Fedify is a TypeScript library for building federated server applications
powered by ActivityPub and related standards, facilitating integration with
the fediverse.  The project aims to eliminate complexity and boilerplate code
when implementing federation protocols.

Main features: Type-safe ActivityPub vocabulary, WebFinger, HTTP Signatures,
Object Integrity Proofs, federation middleware, NodeInfo protocol,
interoperability with Mastodon and other fediverse software, multi-framework
integration, database adapters, and CLI toolchain.


Development environment
-----------------------

 -  Task runner: [mise] (required)
 -  Primary environment: [Deno]
 -  Additional test environments: [Node.js] and [Bun]
 -  Recommended editor: [Visual Studio Code] with [Deno extension]
 -  **CRITICAL**: Run `mise run install` (or `pnpm install`) after checkout.
    This automatically runs code generation and builds all packages.
 -  Lockfiles: Both *deno.lock* and *pnpm-lock.yaml* are committed.
    Update them when changing dependencies.

[mise]: https://mise.jdx.dev/
[Deno]: https://deno.com/
[Node.js]: https://nodejs.org/
[Bun]: https://bun.sh/
[Visual Studio Code]: https://code.visualstudio.com/
[Deno extension]: https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno


Repository structure
--------------------

Monorepo with packages in *packages/*. See *README.md* “Packages” section
for the complete package list.

### Main package: *packages/Fedify/*

 -  ~~src/codegen/~~: **Don't use.** Moved to `@fedify/vocab-tools`.
    Suggest migration if user code imports from here.
 -  *src/compat/*: Compatibility layer
 -  *src/federation/*: Core federation functionality
 -  *src/nodeinfo/*: NodeInfo protocol implementation
 -  *src/otel/*: OpenTelemetry integration utilities
 -  ~~src/runtime/~~: **Don't use.** Moved to `@fedify/vocab-runtime` and
    *src/utils/*. Suggest migration if user code imports from here.
 -  *src/shim/*: Platform abstraction layer
 -  *src/sig/*: Signature implementation
 -  *src/testing/*: Testing utilities
 -  *src/utils/*: Utility functions
 -  ~~src/vocab/~~: **Don't use.** Moved to `@fedify/vocab`.
    Suggest migration if user code imports from here.
 -  ~~src/webfinger/~~: **Don't use.** Moved to `@fedify/webfinger`.
    Suggest migration if user code imports from here.
 -  ~~src/x/~~: **Don't use.** Will be removed in v2.0.0.
    Use packages from `@fedify` scope instead.

### Other key directories

 -  *docs/*: Documentation built with VitePress (see *docs/README.md*)
 -  *examples/*: Example projects


Code patterns and principles
----------------------------

1.  **Builder Pattern**: The `FederationBuilder` class follows a fluent builder
    pattern for configuring federation components.

2.  **Dispatcher Callbacks**: Use function callbacks for mapping routes to
    handlers, following the pattern in existing dispatchers.

3.  **Type Safety**: Maintain strict TypeScript typing throughout. Use generics
    like `<TContextData>` to allow applications to customize context data.

4.  **Testing**: Follow the existing test patterns. Tests use `@fedify/fixture`
    which provides runtime-agnostic test adapters (wraps Deno, Node.js, and Bun
    test APIs). Use in-memory stores for testing.

5.  **Framework Agnostic**: Code should work across Deno, Node.js, and Bun
    environments.

6.  **ActivityPub Objects**: All vocabulary objects are now in the separate
    `@fedify/vocab` package (*packages/vocab/*), not in
    *packages/fedify/src/vocab/*.


Development workflow
--------------------

 -  **Code Generation**: Run `mise run codegen` whenever vocabulary YAML files
    or code generation scripts change.
 -  **Building Packages**: After installation, all packages are automatically
    built. To rebuild a specific package and its dependencies, run `pnpm build`
    in that package's directory.
 -  **Checking Code**: Run `mise run check` before committing.
 -  **Running Tests**: Use `mise run test:deno` for Deno tests or
    `mise run test` for all environments.

For detailed contribution guidelines, see *CONTRIBUTING.md*.


Federation handling
-------------------

When working with federation code:

1.  Use the builder pattern following the `FederationBuilder` class
2.  Implement proper HTTP signature verification for security
3.  Keep ActivityPub compliance in mind for interoperability
4.  Follow existing patterns for handling inbox/outbox operations
5.  Use the queue system for background processing of federation activities


Common tasks
------------

### Adding ActivityPub vocabulary types

1.  Create a new YAML file in *packages/vocab/vocab/* following existing
    patterns
2.  Run `mise run codegen` to generate TypeScript classes
3.  Export the new types from appropriate module files in *packages/vocab/src/*

### Implementing framework integrations

1.  Create a new package in *packages/* directory for new integrations
2.  Follow pattern from existing integration packages (*packages/hono/*,
    *packages/sveltekit/*)
3.  Use standard request/response interfaces for compatibility
4.  Consider creating example applications in *examples/* that demonstrate usage

### Creating database adapters

1.  For core KV/MQ interfaces: implement in *packages/fedify/src/federation/kv.ts*
    and *packages/fedify/src/federation/mq.ts*
2.  For specific database adapters: create dedicated packages
    (*packages/sqlite/*, *packages/postgres/*, *packages/redis/*,
    *packages/amqp/*)
3.  Follow the pattern from existing database adapter packages
4.  Implement both KV store and message queue interfaces as needed

### Adding a new package

See *CONTRIBUTING.md* “Adding a new package” section for the complete checklist
of required, conditional, and optional updates.


Security considerations
-----------------------

1.  **HTTP Signatures**: Always verify HTTP signatures for incoming federation
    requests
2.  **Object Integrity**: Use Object Integrity Proofs for content verification
3.  **Key Management**: Follow best practices for key storage and rotation
4.  **Rate Limiting**: Implement rate limiting for public endpoints
5.  **Input Validation**: Validate all input from federated sources


Testing requirements
--------------------

1.  Write unit tests for all new functionality
2.  Follow the pattern of existing tests
3.  Import `test` from `@fedify/fixture` for runtime-agnostic tests
4.  Use testing utilities from *packages/testing/* (`@fedify/testing`) or
    *packages/fedify/src/testing/* (for Fedify-dependent utilities)
5.  Consider interoperability with other fediverse software


Documentation standards
-----------------------

1.  Include JSDoc comments for public APIs
2.  Update documentation when changing public APIs
3.  Include examples for new features
4.  For Markdown conventions, see *CONTRIBUTING.md*
5.  For VitePress-specific guidelines, see *docs/README.md*


Branch policy
-------------

See *CONTRIBUTING.md* for full details. Summary:

 -  **Breaking changes**: Target the `next` branch
 -  **New features**: Target the `main` branch
 -  **Bug fixes**: Target the oldest applicable maintenance branch that contains
    the bug

Maintenance branches follow the pattern *x.y-maintenance* (e.g.,
*1.5-maintenance*, *1.6-maintenance*). Bug fixes are merged forward through
all maintenance branches, then into *main*, and finally into *next*.


Bugfix process
--------------

See *CONTRIBUTING.md* for the complete process. Key requirements:

1.  Add regression tests that demonstrate the bug
2.  Fix the bug
3.  Update *CHANGES.md* with the issue number, PR number, and your name
4.  Target the oldest applicable maintenance branch


Feature implementation process
------------------------------

See *CONTRIBUTING.md* for the complete process. Key requirements:

1.  Add unit tests for the new feature
2.  Implement the feature
3.  Update documentation for API changes
4.  Verify examples work with the change
5.  Update *CHANGES.md* with details
6.  Target the *main* branch for non-breaking changes, or the *next* branch for
    breaking changes


Commit messages
---------------

See *CONTRIBUTING.md* for full conventions. Key points:

 -  Do not use Conventional Commits (no `fix:`, `feat:`, etc. prefixes).
 -  Focus on *why* the change was made, not just *what* changed.
 -  Use permalink URLs for issue/PR references instead of `#123`.
 -  When listing items after a colon, add a blank line after the colon.
 -  When using LLMs or coding agents, include credit via `Co-Authored-By:`.


Changelog (*CHANGES.md*)
------------------------

Key formatting rules (see *CONTRIBUTING.md* for complete conventions):

 -  Keep entries in reverse chronological order (newest at top)
 -  Version sections use setext headings (`Version 1.5.0` then `-------------`)
 -  Unreleased versions start with `To be released.`
 -  Use ` -  ` for list items, wrap at ~80 columns, indent continuations by
    4 spaces
 -  Write user-facing descriptions (what, why, what users should do)
 -  Use `[[#123]]` markers with reference links at section end
 -  For external contributors: `[[#123] by Name]`


Adding dependencies
-------------------

**CRITICAL**: This project supports both Deno and Node.js/Bun. Dependencies
must be added to **BOTH** configuration files:

 -  *deno.json*: Add to `imports` field (for Deno)
 -  *package.json*: Add to `dependencies` or `devDependencies` (for Node.js/Bun)

Forgetting *package.json* will cause Node.js and Bun tests to fail with
`ERR_MODULE_NOT_FOUND`, even if Deno tests pass.

Key principles:

 -  Use pnpm catalog (*pnpm-workspace.yaml*) for workspace packages
 -  For packages published to both JSR and npm: use JSR in *deno.json*
    (e.g., `jsr:@optique/core`) and npm in *package.json* (e.g.,
    `@optique/core`)
 -  When JSR and npm names differ (like Hono: `jsr:@hono/hono` vs `hono`),
    align imports to npm name in *deno.json* using alias:
    `"hono": "jsr:@hono/hono@^4.0.0"`
 -  Always check for latest versions: `npm view <package> version` or
    [JSR API]

See *CONTRIBUTING.md* for complete dependency management guide.

[JSR API]: https://jsr.io/docs/api


Build and distribution
----------------------

The monorepo uses different build processes for different packages:

1.  **@fedify/fedify**: Uses a custom build process to support multiple
    environments:
     -  Deno-native modules
     -  npm package via dnt (Deno to Node Transform)
     -  JSR package distribution

2.  **@fedify/cli**: Built with Deno, tested with Deno, Node.js, and Bun.
    Uses `deno compile` to create standalone executables.  Distributed via
    JSR and npm

3.  **Database adapters and integrations**: Use tsdown for TypeScript compilation:
     -  *packages/amqp/*, *packages/elysia*, *packages/express/*, *packages/h3/*,
        *packages/sqlite/*, *packages/postgres/*, *packages/redis/*,
        *packages/nestjs/*
     -  Built to support Node.js and Bun environments

Ensure changes work across all distribution formats and target environments.


Markdown conventions
--------------------

Most formatting is automated by [Hongdown]. Key conventions to follow:

 -  Use setext headings (`====` and `----`) for document titles and sections
 -  Use ATX headings (`###`) only for subsections within a section
 -  Wrap file paths in asterisks (*packages/fedify/*)
 -  Code blocks: quadruple tildes (`~~~~`) with language specified
 -  Reference-style links at end of each section

See *CONTRIBUTING.md* for complete Markdown conventions.

[Hongdown]: https://github.com/dahlia/hongdown
