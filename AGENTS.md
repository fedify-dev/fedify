<!-- deno-fmt-ignore-file -->

Fedify LLM Coding Agent Instructions
====================================

This file contains instructions for LLM coding agents working with the Fedify
codebase.


Project Overview
----------------

Fedify is a TypeScript library for building federated server applications
powered by ActivityPub and related standards, facilitating integration with
the Fediverse. The project aims to eliminate complexity and boilerplate code
when implementing federation protocols.

Main features:

 -  Type-safe ActivityPub vocabulary implementation
 -  WebFinger client and server
 -  HTTP Signatures and Linked Data Signatures
 -  Object Integrity Proofs
 -  Federation middleware for handling webhooks
 -  NodeInfo protocol support
 -  Interoperability with Mastodon and other fediverse software
 -  Integration with various web frameworks (Express, h3, Hono, SvelteKit)
 -  Database adapters (PostgreSQL, Redis, AMQP/RabbitMQ)
 -  CLI toolchain for testing and debugging


Development Environment
-----------------------

 -  Primary development environment: [Deno]
 -  Additional test environments: [Node.js] and [Bun]
 -  Recommended editor: [Visual Studio Code] with [Deno extension]
 -  Important: Run `deno task codegen` before working with the codebase (for
    code generation)
 -  Lockfiles: Both *deno.lock* and *pnpm-lock.yaml* are committed to the
    repository for reproducible builds.  Update them when changing dependencies.

[Deno]: https://deno.com/
[Node.js]: https://nodejs.org/
[Bun]: https://bun.sh/
[Visual Studio Code]: https://code.visualstudio.com/
[Deno extension]: https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno


Repository Structure
--------------------

The repository is organized as a monorepo with the following packages:

 -  *packages/fedify/*: Main Fedify library (@fedify/fedify)
    -  ~~src/codegen/~~: **Don't use.** Moved to `@fedify/vocab-tools`. If user code imports from here, notice and suggest migration.
    -  *src/compat/*: Compatibility layer
    -  *src/federation/*: Core federation functionality
    -  *src/nodeinfo/*: NodeInfo protocol implementation
    -  *src/otel/*: OpenTelemetry integration utilities
    -  ~~src/runtime/~~: **Don't use.** Moved to `@fedify/vocab-runtime` and `src/utils/*`. If user code imports from here, notice and suggest migration.
    -  *src/shim/*: Platform abstraction layer
    -  *src/sig/*: Signature implementation
    -  *src/testing/*: Testing utilities
    -  *src/utils/*: Utility functions
    -  *src/vocab/*: ActivityPub vocabulary implementation
    -  *src/webfinger/*: WebFinger protocol implementation
    -  ~~src/x/~~: **Don't use.** This directory will be removed in version 2.0.0. Use packages from the `@fedify` scope, which are located in the `packages/` directory (e.g., `@fedify/hono` is in `packages/hono/`).
 -  *packages/cli/*: Fedify CLI implementation (@fedify/cli, built with Deno)
 -  *packages/amqp/*: AMQP/RabbitMQ driver (@fedify/amqp)
 -  *packages/cfworkers/*: Cloudflare Workers integration (@fedify/cfworkers)
 -  *packages/denokv/*: Deno KV integration (@fedify/denokv)
 -  *packages/elysia/*: Elysia integration (@fedify/elysia)
 -  *packages/express/*: Express.js integration (@fedify/express)
 -  *packages/fastify/*: Fastify integration (@fedify/fastify)
 -  *packages/h3/*: h3 framework integration (@fedify/h3)
 -  *packages/hono/*: Hono integration (@fedify/hono)
 -  *packages/koa/*: Koa integration (@fedify/koa)
 -  *packages/postgres/*: PostgreSQL drivers (@fedify/postgres)
 -  *packages/redis/*: Redis drivers (@fedify/redis)
 -  *packages/lint/*: Linting utilities (@fedify/lint)
 -  *packages/nestjs/*: NestJS integration (@fedify/nestjs)
 -  *packages/next/*: Next.js integration (@fedify/next)
 -  *packages/sqlite/*: SQLite driver (@fedify/sqlite)
 -  *packages/sveltekit/*: SvelteKit integration (@fedify/sveltekit)
 -  *packages/testing/*: Testing utilities (@fedify/testing)
 -  *packages/vocab-runtime/*: Runtime utilities and types (@fedify/vocab-runtime)
 -  *packages/vocab-tools/*: Utilities and types for code-generated Activity Vocabulary APIs (@fedify/vocab-runtime)
 -  *docs/*: Documentation built with Node.js and VitePress
 -  *examples/*: Example projects demonstrating Fedify usage


Code Patterns and Principles
----------------------------

1. **Builder Pattern**: The `FederationBuilder` class follows a fluent builder
   pattern for configuring federation components.

2. **Dispatcher Callbacks**: Use function callbacks for mapping routes to
   handlers, following the pattern in existing dispatchers.

3. **Type Safety**: Maintain strict TypeScript typing throughout. Use generics
   like `<TContextData>` to allow applications to customize context data.

4. **Testing**: Follow the existing test patterns using Deno's testing
   framework. Use in-memory stores for testing.

5. **Framework Agnostic**: Code should work across Deno, Node.js, and Bun
   environments.

6. **ActivityPub Objects**: All vocabulary objects follow the class pattern
   established in the *vocab/* directory.


Development Workflow
--------------------

1. **Code Generation**: Run `deno task codegen` whenever vocabulary YAML files
   or code generation scripts change.

2. **Checking Code**: Before committing, run `deno task check-all` from the
   root directory to check all packages.

3. **Running Tests**: Use `deno task test` for basic tests or
   `deno task test-all` to test across all environments and packages.

4. **Documentation**: Follow the Markdown conventions in CONTRIBUTING.md:
    -  80 characters per line (except for code blocks and URLs)
    -  Use reference links over inline links
    -  Use setext headings over ATX headings
    -  Two new lines before H1/H2 headings
    -  Wrap file paths in asterisks
    -  Code blocks should use quadruple tildes with language specified


Federation Handling
-------------------

When working with federation code:

1. Use the builder pattern following the `FederationBuilder` class
2. Implement proper HTTP signature verification for security
3. Keep ActivityPub compliance in mind for interoperability
4. Follow existing patterns for handling inbox/outbox operations
5. Use the queue system for background processing of federation activities


Common Tasks
------------

### Adding ActivityPub Vocabulary Types

1. Create a new YAML file in *packages/fedify/src/vocab/* following existing patterns
2. Run `deno task codegen` to generate TypeScript classes
3. Export the new types from appropriate module files

### Implementing Framework Integrations

1. Create a new package in *packages/* directory for new integrations
2. Follow pattern from existing integration packages (*packages/hono/*, *packages/sveltekit/*)
3. Use standard request/response interfaces for compatibility
4. Consider creating example applications in *examples/* that demonstrate usage

### Creating Database Adapters

1. For core KV/MQ interfaces: implement in *packages/fedify/src/federation/kv.ts*
   and *packages/fedify/src/federation/mq.ts*
2. For specific database adapters: create dedicated packages
   (*packages/sqlite/*, *packages/postgres/*, *packages/redis/*, *packages/amqp/*)
3. Follow the pattern from existing database adapter packages
4. Implement both KV store and message queue interfaces as needed

### Adding a New Package

When adding a new package to the monorepo, the following files must be updated:

**Required updates:**

 1. *AGENTS.md* and *CONTRIBUTING.md*: Add the package to the repository
    structure list
 2. *README.md*: Add the package to the "Packages" section table
 3. *package.json*: Add the `repository` field to the package metadata.
    This is required for provenance information when publishing to npm.
 4. Root *deno.json*: Add the package path to the `workspace` array
 5. *pnpm-workspace.yaml*: Add the package path to the `packages` array

**Conditional updates:**

 -  If the package is a web framework integration: Update
    *docs/manual/integration.md*
 -  If the package implements `KvStore`: Update *docs/manual/kv.md*
 -  If the package implements `MessageQueue`: Update *docs/manual/mq.md*
 -  If the package is published to JSR: Add JSR link to the `REFERENCES` data
    in *docs/.vitepress/config.mts* (note: only JSR links are added here,
    not npm links)

**Optional updates:**

 -  If special dependencies are needed: Add to `imports` in root *deno.json*
 -  If using pnpm catalog for dependency management: Add to `catalog` in
    *pnpm-workspace.yaml*


Important Security Considerations
---------------------------------

1. **HTTP Signatures**: Always verify HTTP signatures for incoming federation
   requests
2. **Object Integrity**: Use Object Integrity Proofs for content verification
3. **Key Management**: Follow best practices for key storage and rotation
4. **Rate Limiting**: Implement rate limiting for public endpoints
5. **Input Validation**: Validate all input from federated sources


Testing Requirements
--------------------

1. Write unit tests for all new functionality
2. Follow the pattern of existing tests
3. Use the testing utilities in *packages/fedify/src/testing/* or *packages/testing/*
4. Consider interoperability with other fediverse software
5. For package-specific tests, follow the testing patterns in each package


Documentation Standards
-----------------------

1. Include JSDoc comments for public APIs
2. Update documentation when changing public APIs
3. Follow Markdown conventions as described in CONTRIBUTING.md
4. Include examples for new features


Branch Policy
-------------

Fedify follows a structured branching strategy for managing releases and
maintenance:

### Branch Types

1. **next**: Contains unreleased development for the next major version
2. **main**: Contains unreleased development for the next minor version
3. **x.y-maintenance**: Maintenance branches for released major/minor versions
   (e.g., `1.5-maintenance`, `1.6-maintenance`)

### Development Workflow

- **Breaking changes**: Target the `next` branch
- **New features**: Target the `main` branch
- **Bug fixes**: Target the oldest applicable maintenance branch that contains
  the bug

### Release and Merge Strategy

When a bug is fixed in a maintenance branch:

1. Fix the bug in the oldest affected maintenance branch (e.g., `1.5-maintenance`)
2. Create a new patch release tag (e.g., `1.5.1`)
3. Merge the fix into the next maintenance branch (e.g., `1.6-maintenance`)
4. Create a new patch release tag for that branch (e.g., `1.6.1`)
5. Continue merging forward through all subsequent maintenance branches
6. Merge into `main`
7. Finally merge into `next`

This ensures that all maintenance branches and the development branches
include the fix.


Bugfix Process
--------------

When fixing bugs:

1. Add regression tests that demonstrate the bug
2. Fix the bug
3. Update CHANGES.md with the issue number, PR number, and your name
4. Target the oldest applicable maintenance branch


Feature Implementation Process
------------------------------

When adding features:

1. Add unit tests for the new feature
2. Implement the feature
3. Update documentation for API changes
4. Verify examples work with the change
5. Update CHANGES.md with details
6. Target the main branch for non-breaking changes, or the next branch for breaking changes


Build and Distribution
----------------------

The monorepo uses different build processes for different packages:

1. **@fedify/fedify**: Uses a custom build process to support multiple environments:
   - Deno-native modules
   - npm package via dnt (Deno to Node Transform)
   - JSR package distribution

2. **@fedify/cli**: Built with Deno, distributed via JSR and npm

3. **Database adapters and integrations**: Use tsdown for TypeScript compilation:
   - *packages/amqp/*, *packages/elysia*, *packages/express/*, *packages/h3/*,
     *packages/sqlite/*, *packages/postgres/*, *packages/redis/*,
     *packages/nestjs/*
   - Built to support Node.js and Bun environments

Ensure changes work across all distribution formats and target environments.
