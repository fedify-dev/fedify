<!-- deno-fmt-ignore-file -->

Fedify LLM coding agent instructions
====================================

This file contains instructions for LLM coding agents working with the Fedify
codebase.


Project overview
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


Development environment
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


Repository structure
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


Code patterns and principles
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


Development workflow
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


Federation handling
-------------------

When working with federation code:

1. Use the builder pattern following the `FederationBuilder` class
2. Implement proper HTTP signature verification for security
3. Keep ActivityPub compliance in mind for interoperability
4. Follow existing patterns for handling inbox/outbox operations
5. Use the queue system for background processing of federation activities


Common tasks
------------

### Adding ActivityPub vocabulary types

1. Create a new YAML file in *packages/fedify/src/vocab/* following existing patterns
2. Run `deno task codegen` to generate TypeScript classes
3. Export the new types from appropriate module files

### Implementing framework integrations

1. Create a new package in *packages/* directory for new integrations
2. Follow pattern from existing integration packages (*packages/hono/*, *packages/sveltekit/*)
3. Use standard request/response interfaces for compatibility
4. Consider creating example applications in *examples/* that demonstrate usage

### Creating database adapters

1. For core KV/MQ interfaces: implement in *packages/fedify/src/federation/kv.ts*
   and *packages/fedify/src/federation/mq.ts*
2. For specific database adapters: create dedicated packages
   (*packages/sqlite/*, *packages/postgres/*, *packages/redis/*, *packages/amqp/*)
3. Follow the pattern from existing database adapter packages
4. Implement both KV store and message queue interfaces as needed

### Adding a new package

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


Important security considerations
---------------------------------

1. **HTTP Signatures**: Always verify HTTP signatures for incoming federation
   requests
2. **Object Integrity**: Use Object Integrity Proofs for content verification
3. **Key Management**: Follow best practices for key storage and rotation
4. **Rate Limiting**: Implement rate limiting for public endpoints
5. **Input Validation**: Validate all input from federated sources


Testing requirements
--------------------

1. Write unit tests for all new functionality
2. Follow the pattern of existing tests
3. Use the testing utilities in *packages/fedify/src/testing/* or *packages/testing/*
4. Consider interoperability with other fediverse software
5. For package-specific tests, follow the testing patterns in each package


Documentation standards
-----------------------

1. Include JSDoc comments for public APIs
2. Update documentation when changing public APIs
3. Follow Markdown conventions as described in CONTRIBUTING.md
4. Include examples for new features


Branch policy
-------------

Fedify follows a structured branching strategy for managing releases and
maintenance:

### Branch types

1. **next**: Contains unreleased development for the next major version
2. **main**: Contains unreleased development for the next minor version
3. **x.y-maintenance**: Maintenance branches for released major/minor versions
   (e.g., `1.5-maintenance`, `1.6-maintenance`)

### Development workflow

- **Breaking changes**: Target the `next` branch
- **New features**: Target the `main` branch
- **Bug fixes**: Target the oldest applicable maintenance branch that contains
  the bug

### Release and merge strategy

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


Bugfix process
--------------

When fixing bugs:

1. Add regression tests that demonstrate the bug
2. Fix the bug
3. Update CHANGES.md with the issue number, PR number, and your name
4. Target the oldest applicable maintenance branch


Feature implementation process
------------------------------

When adding features:

1. Add unit tests for the new feature
2. Implement the feature
3. Update documentation for API changes
4. Verify examples work with the change
5. Update CHANGES.md with details
6. Target the main branch for non-breaking changes, or the next branch for breaking changes


Commit messages
---------------

 -  Do not use Conventional Commits (no `fix:`, `feat:`, etc. prefixes).
    Keep the first line under 50 characters when possible.
 -  Focus on *why* the change was made, not just *what* changed.
 -  When referencing issues or PRs, use permalink URLs instead of just
    numbers (e.g., `#123`).  This preserves context if the repository
    is moved later.
 -  When listing items after a colon, add a blank line after the colon:

    ~~~~
    This commit includes the following changes:

    - Added foo
    - Fixed bar
    ~~~~

 -  When using LLMs or coding agents, include credit via `Co-Authored-By:`.
    Include a permalink to the agent session if available.


Changelog (*CHANGES.md*)
------------------------

This repository uses *CHANGES.md* as a human-readable changelog.  Follow these
conventions:

 -  *Structure*: Keep entries in reverse chronological order (newest version at
    the top).

 -  *Version sections*: Each release is a top-level section:

    ~~~~
    Version 1.5.0
    -------------
    ~~~~

 -  *Unreleased version*: The next version should start with:

    ~~~~
    To be released.
    ~~~~

 -  *Released versions*: Use a release-date line right after the version header:

    ~~~~
    Released on December 30, 2025.
    ~~~~

 -  *Bullets and wrapping*: Use ` -  ` list items, wrap around ~80 columns, and
    indent continuation lines by 4 spaces so they align with the bullet text.

 -  *Write useful change notes*: Prefer concrete, user-facing descriptions.
    Include what changed, why it changed, and what users should do differently
    (especially for breaking changes, deprecations, and security fixes).

 -  *Multi-paragraph items*: For longer explanations, keep paragraphs inside the
    same bullet item by indenting them by 4 spaces and separating paragraphs
    with a blank line (also indented).

 -  *Code blocks in bullets*: If a bullet includes code, indent the entire code
    fence by 4 spaces so it remains part of that list item.  Use `~~~~` fences
    and specify a language (e.g., `~~~~ typescript`).

 -  *Nested lists*: If you need sub-items (e.g., a list of added exports), use a
    nested list inside the parent bullet, indented by 4 spaces.

 -  *Issue and PR references*: Use `[[#123]]` markers in the text and add
    reference links at the end of the version section.

    When listing multiple issues/PRs, list them like `[[#123], [#124]]`.

    When the reference is for a PR authored by an external contributor, append
    `by <NAME>` after the last reference marker (e.g., `[[#123] by Hong Minhee]`
    or `[[#123], [#124] by Hong Minhee]`).

    ~~~~
    [#123]: https://github.com/fedify-dev/fedify/issues/123
    [#124]: https://github.com/fedify-dev/fedify/pull/124
    ~~~~


Adding dependencies
-------------------

When adding new dependencies, always check for the latest version:

 -  *npm packages*: Use `npm view <package> version` to find the latest version
 -  *JSR packages*: Use the [JSR API] to find the latest version

Always prefer the latest stable version unless there is a specific reason
to use an older version.

Because this project supports both Deno and Node.js/Bun, dependencies must
be added to *both* configuration files:

 -  *deno.json*: Add to the `imports` field (for Deno)
 -  *package.json*: Add to `dependencies` or `devDependencies` (for Node.js/Bun)

For workspace packages, use the pnpm catalog (*pnpm-workspace.yaml*) to manage
versions centrally.  In *package.json*, reference catalog versions with
`"catalog:"` instead of hardcoding version numbers.

Forgetting to add a dependency to *package.json* will cause Node.js and Bun
tests to fail with `ERR_MODULE_NOT_FOUND`, even if Deno tests pass.

[JSR API]: https://jsr.io/docs/api


Build and distribution
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


Markdown style guide
--------------------

When creating or editing Markdown documentation files in this project,
follow these style conventions to maintain consistency with existing
documentation:

### Headings

 -  *Setext-style headings*: Use underline-style for the document title
    (with `=`) and sections (with `-`):

    ~~~~
    Document title
    ==============

    Section name
    ------------
    ~~~~

 -  *ATX-style headings*: Use only for subsections within a section:

    ~~~~
    ### Subsection name
    ~~~~

 -  *Heading case*: Use sentence case (capitalize only the first word and
    proper nouns) rather than Title Case:

    ~~~~
    Development commands    ← Correct
    Development Commands    ← Incorrect
    ~~~~

### Text formatting

 -  *Italics* (`*text*`): Use for package names (*@fedify/fedify*,
    *@fedify/hono*), file paths (*packages/fedify/*), emphasis, and to
    distinguish concepts
 -  *Bold* (`**text**`): Use sparingly for strong emphasis
 -  *Inline code* (`` `code` ``): Use for code spans, function names,
    and command-line options

### Lists

 -  Use ` -  ` (space-hyphen-two spaces) for unordered list items
 -  Indent nested items with 4 spaces
 -  Align continuation text with the item content:

    ~~~~
     -  *First item*: Description text that continues
        on the next line with proper alignment
     -  *Second item*: Another item
    ~~~~

### Code blocks

 -  Use four tildes (`~~~~`) for code fences instead of backticks
 -  Always specify the language identifier:

    ~~~~~
    ~~~~ typescript
    const example = "Hello, world!";
    ~~~~
    ~~~~~

 -  For shell commands, use `bash`:

    ~~~~~
    ~~~~ bash
    deno test
    ~~~~
    ~~~~~

### Links

 -  Use reference-style links placed at the *end of each section*
    (not at document end)
 -  Format reference links with consistent spacing:

    ~~~~
    See the [Deno] runtime for more information.

    [Deno]: https://deno.com/
    ~~~~

### Spacing and line length

 -  Wrap lines at approximately 80 characters for readability
 -  Use one blank line between sections and major elements
 -  Use two blank lines before setext-style section headings
 -  Place one blank line before and after code blocks
 -  End sections with reference links (if any) followed by a blank line


VitePress documentation
-----------------------

The *docs/* directory contains VitePress documentation with additional features
beyond standard Markdown.

### Twoslash code blocks

Use the `twoslash` modifier to enable TypeScript type checking and hover
information in code blocks:

~~~~~
~~~~ typescript twoslash
import { createFederation } from "@fedify/fedify";

const federation = createFederation({ kv: undefined! });
~~~~
~~~~~

### Fixture variables

When code examples need variables that shouldn't be shown to readers,
declare them *before* the `// ---cut-before---` directive.  Content before
this directive is compiled but hidden from display:

~~~~~
~~~~ typescript twoslash
import type { KvStore } from "@fedify/fedify";
declare const kv: KvStore;
// ---cut-before---
import { createFederation } from "@fedify/fedify";

const federation = createFederation({ kv });
~~~~
~~~~~

The reader sees only the code after `---cut-before---`, but TypeScript
checks the entire block including the hidden fixture.

### Code groups

Use code groups to show the same content for different package managers
or environments:

~~~~
::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/fedify
~~~~

~~~~ bash [npm]
npm add @fedify/fedify
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/fedify
~~~~

:::
~~~~

### Links

 -  *Internal links*: When linking to other VitePress documents within
    the *docs/* directory, use inline link syntax (e.g.,
    `[text](./path/to/file.md)`) instead of reference-style links.
 -  *Relative paths*: Always use relative paths for internal links.
 -  *File extensions*: Include the `.md` extension in internal link paths.

### Building documentation

~~~~ bash
cd docs
pnpm build    # Build for production (runs Twoslash type checking)
pnpm dev      # Start development server
~~~~

Always run `pnpm build` before committing to catch Twoslash type errors.
