<!-- deno-fmt-ignore-file -->

Contributing guide
==================

Thank you for considering contributing to Fedify.  This guide covers the
project's contribution policy, development workflow, and coding conventions.
It applies to both human contributors and coding agents.  *AGENTS.md* and
*CLAUDE.md* point to this file so that everyone works from the same rules.


Before you contribute
---------------------

### First contributions

If this is your first contribution to Fedify, read this section before opening
a pull request.  It exists because low-effort, AI-generated pull requests have
grown common enough to burden maintainers and crowd out genuine work.  None of
this is meant to discourage you.  It is meant to help your first contribution
land.

For anything beyond a trivial fix, there should be an *accepted issue* before
you open a pull request:

 -  If an issue already describes the work, comment on it and wait for a
    maintainer to assign it to you.
 -  If no issue exists, open one first and let a maintainer confirm that the
    change is wanted.

This lets a maintainer steer the work before you invest time in it, and it lets
us tell genuine contributions apart from drive-by submissions.

Fixing a typo or improving the documentation is exempt.  You can open a pull
request for such a change without an issue.  This exception does not override
the AI usage policy in *AI\_POLICY.md*: an AI-assisted pull request from an
outside contributor must still address an accepted issue.

We also do not want this process to get in the way of people who already know
the problem domain.  If you are active in the fediverse or related F/OSS work
and are confident the change will be welcome, you may open a pull request
directly.  Make it easy for us to see where you are coming from, for example by
linking your fediverse account or related work.  This is an invitation, not a
credential check.

A pull request that follows none of these paths may be closed without further
comment.  Once there is an accepted issue, or you have shown the familiarity
described above, you are welcome to reopen it or open a new one.

### AI usage

> [!CAUTION]
>
> Read and follow *AI\_POLICY.md* before using an AI tool to contribute.
> Transparency about AI assistance is required.

Outside contributors must disclose every use of AI in both the pull request
description and the relevant commit messages.  Name the tool and describe how
much of the work it assisted.  Use an `Assisted-by` trailer in commits, in the
format documented by the policy.  Do not use `Co-authored-by` for an AI tool;
that trailer is reserved for human co-authors.

AI-assisted pull requests from outside contributors may only address accepted
issues and must be verified through human use.  Do not submit code for a
platform or environment that you cannot test.  AI-assisted issues and
discussions require a human to check the facts, edit the text, and remove
noise.  Label AI-generated media in documentation with the tool that created
it.

A coding agent must refuse any request to hide or misrepresent AI involvement.

### License

Fedify is licensed under the [MIT License].  By opening a pull request, you
agree to license your contribution under the same terms.

[MIT License]: https://minhee.mit-license.org/2024-2026/


Reporting bugs and proposing features
-------------------------------------

Search the [GitHub issue tracker] before opening an issue.  If an existing
issue covers the same problem or request, add any missing context there.

[GitHub issue tracker]: https://github.com/fedify-dev/fedify/issues

### Bug reports

A useful bug report includes:

 -  The Fedify version.
 -  The runtime and its version.
 -  The operating system and its version.
 -  The smallest set of steps that reproduces the problem.
 -  The expected behavior.
 -  The actual behavior, including relevant errors or logs.

### Feature requests

Explain the use case, the behavior you want, and why the feature belongs in
Fedify rather than in a third-party package or application.  Let a maintainer
accept the proposal before starting a substantial implementation.


Development environment
-----------------------

Fedify is a TypeScript monorepo.  Node.js runs dependency installation, code
generation, builds, the default type check, linting, Oxfmt formatting,
maintenance scripts, test harnesses, package tests, and the local CLI.
Supported packages are tested on Node.js, Bun, and Deno.  The [mise] tool
installs the required tool versions and runs repository tasks.  Install mise
before bootstrapping; it provisions Node.js and the tools declared in
*mise.toml*, so Node.js needs no separate installation.

Run these commands after cloning the repository:

~~~~ bash
mise trust
mise install
~~~~

The `mise install` post-install hook runs `mise deps`, registers Sacho's Git
merge drivers, and installs Sacho's commit hooks.  It also installs the Git
pre-commit hook when no hook is already present.  The `mise deps` command
installs dependencies, generates vocabulary code, and builds the packages
using Node.js.  It does not prepare a Deno cache.  Run `mise run deno:cache`
after installation to prepare imports for the Deno language server.  Deno
workflow tasks also prepare this cache automatically.  You normally need to
run `mise install` only once per checkout.

Install or refresh the pre-commit hook explicitly with
`mise run hooks:install`.  The hook runs the Node.js-only `check` task.
Run `mise run check:all` explicitly for Deno type and generated-code checks.

To bootstrap without installing Deno, set `MISE_DISABLE_TOOLS=deno` before
running `mise install` (for example, `$env:MISE_DISABLE_TOOLS = "deno"` in
PowerShell).  The default `check`, `test`, and `cli` tasks and npm packaging
run without Deno.  Deno is needed for explicit compatibility checks, JSR
validation and publishing, and standalone CLI compilation.

Run development workflows through mise.  Do not call `npm` or `pnpm` directly
for repository tasks.  Start by inspecting the available commands:

~~~~ bash
mise tasks
mise tasks <task>
~~~~

Use `mise run <task>` to run a task.  For example:

~~~~ bash
mise run check
mise run test
~~~~

The recommended editor is [Visual Studio Code] (VS Code) with the
[Oxc extension]. VS Code and Zed use their TypeScript language server by
default.  In both editors, the repository's *Check TypeScript types* task runs
`mise run check:types` with the repository's runtime-specific configurations.
Language servers do not automatically find *tsconfig.check.json*, so
inferred-project diagnostics can differ from that check.  Run the task for
authoritative repository diagnostics.

For Deno-specific work, optionally install the [Deno extension], enable it
locally with `deno.enable` or `deno.enablePaths`, and run `mise run deno:cache`.
In Zed, opt into the `deno` language server in local settings.  The Deno
language server's diagnostics follow `mise run check:types:deno`, which can
differ from the default check.

[mise]: https://mise.jdx.dev/
[Visual Studio Code]: https://code.visualstudio.com/
[Oxc extension]: https://marketplace.visualstudio.com/items?itemName=oxc.oxc-vscode
[Deno extension]: https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno

### Repository layout

The repository uses a few top-level directories:

 -  *packages/* contains the libraries, integrations, adapters, and tools.
 -  *docs/* contains the VitePress documentation site.
 -  *examples/* contains example applications.
 -  *.agents/skills/* contains task-specific guides that coding agents can
    follow and human contributors can consult.

See the “Packages” section of *README.md* for the current package list.  Do not
duplicate that inventory in contribution guides.

### Generated code and builds

Vocabulary code is regenerated automatically before mise tasks when its YAML
schemas, generator or package metadata, Oxfmt configuration, or pnpm catalog
changes.  Run the code generator directly when
you need to refresh generated files for an editor or language server:

~~~~ bash
mise run codegen
~~~~

Build the whole repository with `mise run build`.  While working on a small
set of packages, rebuild only those packages, without the `@fedify/` prefix:

~~~~ bash
mise run prepare-each fedify vocab
~~~~

### Running TypeScript scripts on Node.js

Development tooling uses Node.js 22.18 or later, provided by mise.  Run
TypeScript scripts with
`node --experimental-strip-types path/to/script.ts`.  This removes types
without type checking.  Imports by workspace package name resolve through the
`exports` field in each package's *package.json*, which points to *dist/* and
require the imported packages to be built first with `mise run build` or
`mise run prepare-each <packages>`. Scripts that import source files by
relative path can run before those packages are built, as the vocabulary
generator does.  Use explicit *.ts* extensions for relative imports and
`import type` for type-only names. Resolve dependencies through npm manifests,
not Deno import maps or `tsconfig.json` path aliases.  Native stripping does
not support JSX, enums, parameter properties, or namespaces with runtime code.
Existing tests that need transformations use `--experimental-transform-types`.
The initializer test harness uses the same flag for itself and its initializer
subprocess.  The Astro compatibility harness also uses it when importing
initializer source.  Scripts needing other transformations must choose an
explicit runner rather than relying on Deno resolution.

The vocabulary generator imports `@fedify/vocab-tools` source by relative
path so it can run before any package has been built.  It formats generated
code with the pinned Oxfmt version and the root *.oxfmtrc.json* settings.
Changes to those settings, the root manifests, or the pnpm catalog trigger
regeneration.  Edit vocabulary schemas and run `mise run codegen`
rather than editing the generated file.

Deno compatibility work has explicit preparation and validation commands:

~~~~ bash
mise run deno:cache
mise run codegen:check:deno
mise run check:types:deno
~~~~

The first command caches workspace exports for Deno and its language server;
the second checks generated vocabulary formatting and Deno types; the third
type-checks the Deno workspace with `deno check`, including Deno-only code.
Deno tasks, including `check:all`, `cli:deno`, and `test:deno`, prepare the
cache automatically.  The default `check`, `test`, and `cli` tasks do not.  The
Node.js initializer and example harnesses prepare it only when selected Deno
targets need workspace imports.  Run `mise run deno:cache` explicitly before
using `mise run --skip-deps` with a Deno task, since that option omits task
dependencies. The existing Deno `compile` tasks still generate vocabulary, but
no longer cache or type-check it as a side effect.

### Formatting

Format code and configuration with Oxfmt, and Markdown with Hongdown and Sacho:

~~~~ bash
mise run fmt
mise run check:fmt
~~~~

These formatting tasks run without Deno.  Oxfmt uses the root
*.oxfmtrc.json* and applies the repository's file exclusions.  Hongdown owns
repository Markdown, while Sacho owns changelog fragments and the generated
unreleased changelog.  The generated vocabulary is checked explicitly because
Git ignores it; `mise run codegen` formats it.

The VS Code and Zed settings use the local Oxfmt installation for formatting
and offer the *Check TypeScript types* task for repository diagnostics.
They do not sort imports on save.  See [*FORMATTING.md*][formatting] for
formatting ownership and the reviewed migration differences.

[formatting]: FORMATTING.md

### Linting

Linting uses [Oxlint] and the root *.oxlintrc.json*.  Run it with:

~~~~ bash
mise run check:lint
mise run check-each fedify
~~~~

The configuration mirrors the rule set that the repository previously used
with `deno lint`; [linting.md] documents the mapping and the accepted gaps.
Name rules explicitly in `oxlint-disable` comments and add a short reason when
the suppression is not obvious.  The editor settings disable `deno.lint`, so
Oxlint is the only lint source.

[Oxlint]: https://oxc.rs/docs/guide/usage/linter/
[linting.md]: LINTING.md

### Type checking

`mise run check:types` type-checks the repository with TypeScript on Node.js,
without Deno.  Pass package names, without the `@fedify/` prefix, to check
only those packages:

~~~~ bash
mise run check:types
mise run check:types -- fedify vocab
~~~~

It uses TypeScript 7, currently the 7.1 beta, installed as the `typescript7`
alias.  Tools that need the TypeScript compiler API, such as tsdown's
declaration builds, VitePress Twoslash, and typescript-eslint, keep using
TypeScript 6 through the `typescript` package.

Each package has a *tsconfig.check.json*, plus _tsconfig.check.\*.json_
variants for code that targets another runtime, such as Bun-only modules or
Cloudflare Workers code.  The root *tsconfig.check.json* covers repository
scripts.  These configurations only type-check; they are not named
*tsconfig.json* because Deno would apply such a file to `deno check` and
tsdown would read it for builds.  Extend the environment preset that matches
the code: *tsconfig.node.json* for Node.js, *tsconfig.workers.json* for
Cloudflare Workers, or *tsconfig.bun.json* for Bun.  Each preset loads the
globals of its runtime rather than those of every runtime, so, for example,
Node.js code cannot use `Deno` or `document`, and Workers code cannot use
Node.js's `process` unless its configuration adds Node.js types for the
`nodejs_compat` flag.  The Node.js preset takes web API types from the web
worker libraries, so worker-scope globals such as `self` and `location` are
not rejected there.  Runtime-neutral
code that detects Deno declares the part of the `Deno` global it uses at
module scope instead of loading Deno's types.

Workspace packages resolve through their built declarations, so the task
builds the packages first.  The check is incremental: it keeps TypeScript's
build information under *node\_modules/.cache/fedify-check-types/buildinfo/*
and rechecks only files affected by changes since the last run.  It also fails
when a TypeScript file under *packages/* or *scripts/* belongs to no
type-checking project.  Code that only Deno can check, such as Deno-only
packages, scripts that run on Deno, and `Deno.bench()` benchmarks, is assigned
to `mise run check:types:deno` in *scripts/check\_types\_ownership.ts*, with
the reason.  Add a file there only when the Node.js-based check cannot cover it.

The task also checks the published declarations of every package: it
generates small consumer projects that import each export by package name,
as an ES module and, where the package supports `require()`, as a CommonJS
module, and type-checks them with `skipLibCheck` disabled for Fedify's own
declarations.  Declaration defects found when the check was introduced are
listed, with reasons, in `KNOWN_DECLARATION_PROBLEMS` in
*scripts/check\_types.ts*; remove an entry when fixing its defect, since a
stale entry fails the check.

### Running the CLI

Use the `cli` task to build and run the local Fedify CLI with Node.js:

~~~~ bash
mise run cli -- lookup @fedify@hackers.pub
~~~~

The task runs from the repository root: relative initialization paths and
*.fedify.toml* discovery start there.  `mise run tunnel -- --help` uses the same
Node.js entry point.  To run the TypeScript source with Deno from the CLI
package directory, use `mise run cli:deno -- <arguments>`.

The released CLI remains tested across supported runtimes.  Local CLI tasks
do not replace those compatibility tests.


Implementation guidelines
-------------------------

Keep public APIs strictly typed.  Use generics where applications need to
supply their own types, such as federation context data.  Runtime-neutral code
must work on every runtime supported by its package.  Avoid platform-specific
APIs unless the package is explicitly tied to that platform.

Follow the patterns already used near the code you change.  In federation
code, this usually means fluent methods on `FederationBuilder` and callbacks
that map routes to dispatchers.  Vocabulary objects belong to `@fedify/vocab`,
not the main package.

Several old paths under *packages/fedify/src/* have moved:

 -  Code generation moved from *src/codegen/* to `@fedify/vocab-tools`.
 -  Vocabulary runtime support moved from *src/runtime/* to
    `@fedify/vocab-runtime` and *src/utils/*.
 -  Vocabulary objects moved from *src/vocab/* to `@fedify/vocab`.
 -  WebFinger support moved from *src/webfinger/* to `@fedify/webfinger`.

Do not add new code to the moved directories or recommend those imports to
users.

### Federation and security

Incoming federation data crosses a trust boundary.  Verify HTTP signatures
where the surrounding protocol requires them, validate input, and use Object
Integrity Proofs when verifying signed objects.  Follow the existing key
management, queue, and inbox or outbox patterns.  Public endpoints should
account for abuse and rate limiting.

Keep ActivityPub interoperability in mind.  A locally valid implementation can
still fail when another server serializes an object differently or supports a
smaller part of the protocol.

### Public APIs

Add JSDoc to public APIs.  Update the documentation when behavior or signatures
change, and include an example when the API is not self-explanatory.  Check the
affected examples before submitting the change.

#### Naming

Follow the usual JavaScript naming conventions: `camelCase` for functions,
methods, properties, and variables, and `PascalCase` for classes and types.
Apply these additional rules when designing public APIs:

 -  Treat acronyms as ordinary words: use `UrlError` and `getHttpSignatures`,
    rather than `URLError` and `getHTTPSignatures`.  This simplifies the word
    boundary rules for mechanically converting names to `snake_case` or
    `kebab-case`.
 -  Use `kebab-case` for new Fedify-defined enum-like string values and tagged
    union discriminators, for example `"username-password"` and
    `"missing-actor"`.  Single-word values need no change.  Preserve strings
    defined by external standards or APIs, including vocabulary property
    references such as `"canQuote"`.
 -  Reserve predicate prefixes such as `is`, `does`, and `are` for predicate
    functions and methods.  Omit them from boolean properties and constants:
    use `isOkay(): boolean` for a predicate, but `xxx.okay` rather than
    `xxx.isOkay` for a boolean property.
 -  Prefer metaphorical names that let a value stand for the concept it
    models.  `Actor` is usually better than `ActorInfo`: the API presents the
    value as an actor, rather than emphasizing that it holds information
    about one.

Local variables are not public API, so these API-specific rules need not be
applied as strictly to their names.

These rules guide new API design.  They do not authorize renaming released
values outside the compatibility plan or changing internal persistence and
queue formats.  Telemetry values that mirror a public API tag follow that
tag; other OpenTelemetry and structured log vocabularies retain their own
conventions.


Testing
-------

Add tests for new behavior and regression tests for bug fixes.  Use the
Node.js package tests while developing, and in-memory stores unless the test
specifically exercises a database adapter:

~~~~ bash
mise run test-each:node fedify vocab
~~~~

For a focused source test under Deno, use
`mise run test:deno path/to/file.test.ts --filter "test name"`.  Once the change
is stable, run the affected package suites in all supported runtimes:

~~~~ bash
mise run test-each fedify vocab
~~~~

The default `mise run test` runs quality checks and all Node.js package tests
without Deno.  Run the full compatibility suite before a release or when a
change has broad effects:

~~~~ bash
mise run check:all
mise run test:all
~~~~

`test:all` retains the Node.js, Bun, and Deno suites, Astro and SvelteKit
compatibility checks, Temporal packaging, Deno workspace-link checks, and
isolated testing-package consumers.  `test-each` also requires Deno because it
runs every supported runtime; `test-each:node` is the Node.js-only alternative.
`check-each fresh denokv` and `bench` require Deno as well.  Run
`mise run test:package-files` separately for npm and JSR file and export
validation. The Workers suite is an additional gate, run with
`mise run test:cfworkers`.  Its CI job also verifies that Deno is never
invoked and its cache remains empty.

For local service-backed verification, run the runtime suites one at a time
with their service URLs configured.  Lifecycle packing rebuilds shared
packages, so run it separately from suites reading their build output.

### Updating vocabulary snapshots

Changes to `@fedify/vocab-tools` or the vocabulary YAML schemas can affect the
generated output recorded in snapshots.  Update the Node.js, Bun, and Deno
snapshots together from the repository root:

~~~~ bash
mise run test:update_snapshots
~~~~

Review and commit every changed snapshot file.  Do not update only one
runtime's snapshot.

### Test APIs

Most packages use `node:test` and `node:assert/strict`, which Deno, Node.js,
and Bun all support:

~~~~ typescript
import { deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

describe("my feature", () => {
  it("does the thing", () => {
    deepStrictEqual(1 + 1, 2);
  });
});
~~~~

The `@fedify/fedify` and `@fedify/vocab` packages are exceptions.  Selected
tests from these packages and `@fedify/vocab-runtime` run in the Cloudflare
Workers harness through the `testDefinitions` registry from the private
`@fedify/fixture` package, so tests included there must use its `test()`
wrapper:

~~~~ typescript
import { deepStrictEqual } from "node:assert/strict";
import { test } from "@fedify/fixture";

test("my feature does the thing", () => {
  deepStrictEqual(1 + 1, 2);
});
~~~~

Any test file may import `mockDocumentLoader()`, `TestSpanExporter`, or
`createTestTracerProvider()` from `@fedify/fixture`.  The package is not
published to npm or JSR, so restrict every such import to a file matching
`**/*.test.ts`.  Verify that boundary with:

~~~~ bash
mise run check:fixture-usage
~~~~

Reuse helpers from `@fedify/testing`, or from
*packages/fedify/src/testing/* when they depend on the main package, before
creating new test infrastructure.

See *packages/fixture/README.md* for the fixture APIs and runtime-specific
notes.

### Testing the initializer

The `test:init` task runs on Node.js and exercises `fedify init` across web
frameworks, package managers, key-value stores, and message queues.  The default
matrix includes Deno targets, so it also requires Deno:

~~~~ bash
mise run test:init
~~~~

Pass options after `--` to limit the matrix:

~~~~ bash
mise run test:init -- -w hono -p npm -k in-memory -m in-process
mise run test:init -- -w hono -p deno
~~~~

The first command selects only Node.js targets and needs no Deno executable or
cache.  Deno targets remain available through `-p deno`.

The test artifacts are written under */tmp/fedify-init/&lt;run-id&gt;/* on Unix.
The internal `test-init` command uses `FEDIFY_TEST_MODE` to select local
workspace packages and is not part of the public CLI.

### Testing examples

The example harness runs on Node.js.  Run all example tests, or name the
examples that your change affects:

~~~~ bash
mise run test:examples
mise run test:examples -- astro sveltekit-sample
~~~~

The full suite includes Deno applications and requires Deno.  Selecting only
Node.js or Bun examples needs no Deno executable or cache.

Maintenance script and harness regression tests run on Node.js with:

~~~~ bash
mise run test:tooling
~~~~

### npm and JSR validation

Check npm contents and the lifecycle-enabled publishing path without Deno:

~~~~ bash
mise run test:package-files:npm
mise run test:npm-pack
~~~~

The lifecycle check packs all packages serially and verifies that packaged
skills are present and skill symlinks or link text files are restored.  Use
`mise run test:tooling:no-deno` to run the default checks, local CLI, npm
validation, and a Node.js initializer smoke test with Deno blocked and an empty
cache.  The task's `--default-test` profile runs the default Node.js suite with
Deno blocked, inheriting configured database and message-queue URLs:

~~~~ bash
mise run test:tooling:no-deno -- --default-test
~~~~

JSR file checks and the typed publishing dry run remain explicit:

~~~~ bash
mise run test:package-files:jsr
mise exec -- deno publish --dry-run --allow-slow-types
~~~~

### Remaining Deno standard-library dependencies

Shared Fedify tests still use `@std/assert` through their declared npm
compatibility package; these assertions run on Node.js and Bun as well as Deno.
The vocabulary generator already has separate Node.js, Bun, and Deno snapshots.
`@std/testing/snapshot` remains for Deno's snapshot format.  Tests for
`Deno.inspect()` also use it and run only on Deno.  Workers test discovery uses
`node:fs/promises` and `node:path` in place of `@std/fs` and `@std/path`.
Deno cache preparation and standalone CLI compilation still use `@std/path`,
so its import-map entry stays.  The unused `@std/fs` entry is left for the
dependency cleanup in [issue #1284].  Changing the default runtime must not
drop assertions or alter path handling.

[issue #1284]: https://github.com/fedify-dev/fedify/issues/1284


Dependencies
------------

The repository commits both *deno.lock* and *pnpm-lock.yaml*.  After adding,
updating, or removing a dependency, run both commands:

~~~~ bash
mise deps
mise run deno:cache
~~~~

`mise deps` installs npm dependencies and updates *pnpm-lock.yaml*;
`mise run deno:cache` resolves Deno workspace imports and updates
*deno.lock*.  Review and commit the lockfile changes they produce.

A dependency used by code that runs on Deno and Node.js or Bun must be declared
in both places:

 -  Add the Deno mapping to `imports` in the root *deno.json*.
 -  Add the npm package to `dependencies` or `devDependencies` in the relevant
    *package.json* file.

Forgetting the npm declaration can leave Deno tests passing while Node.js and
Bun fail with `ERR_MODULE_NOT_FOUND`.

Use the pnpm catalog in *pnpm-workspace.yaml* for shared versions.  Refer to a
catalog entry from *package.json* with `"catalog:"` instead of copying the
version.

When a dependency is published to both JSR and npm, use its JSR specifier in
*deno.json* and its npm package in *package.json*.  If the package names differ,
map the npm import name to the JSR package in *deno.json*.  Hono is an example:

~~~~ json
{
  "imports": {
    "hono": "jsr:@hono/hono@^4.0.0"
  }
}
~~~~

Check the current release before choosing a version.  You can query npm with
`npm view <package> version` or use the [JSR API].

[JSR API]: https://jsr.io/docs/api

### Initializer dependencies

Third-party versions used by `fedify init` live in
*packages/init/src/json/*.  Web framework and common tool versions usually
belong in *deps.json*.  Key-value store and message queue versions belong in
*kv.json* and *mq.json*.

Update the existing version ranges and test the generated projects with:

~~~~ bash
mise run update-init-deps
mise run test:init
~~~~

When a framework template needs a new dependency, add it to *deps.json* and
refer to it through the template's `deps` import.


Common repository changes
-------------------------

### Adding a package

Do not add a package to this guide's repository overview.  The current package
inventory belongs in *README.md*.

A new package requires these updates:

1.  Add the package directory and its metadata.  Published npm packages need a
    `repository` field for provenance.
2.  Add a *tsconfig.check.json* that extends the environment preset matching
    the package, as described in “Type checking.”
3.  Add the package path to the `workspace` array in the root *deno.json* when
    Deno should include it.
4.  Add the path to `packages` in *pnpm-workspace.yaml*.
5.  Add the package to the table in *README.md*.
6.  Add its path and owners to *.github/CODEOWNERS*.

Some packages need more updates:

 -  Add web framework integrations to *docs/manual/integration.md*.
 -  Add `KvStore` implementations to *docs/manual/kv.md*.
 -  Add `MessageQueue` implementations to *docs/manual/mq.md*.
 -  Give JSR packages the correct `name` and `publish` metadata in their
    *deno.json* file.  The documentation reference list is generated from
    publishable workspace packages, so do not edit
    *docs/.vitepress/config.mts* for it.
 -  Add shared dependency versions to the pnpm catalog when appropriate.

### Adding a web framework integration

The integration workflow is documented in three guides:

 -  *.agents/skills/create-integration-package/SKILL.md* covers feasibility
    research and the integration package.
 -  *.agents/skills/add-to-fedify-init/SKILL.md* covers `fedify init`.
 -  *.agents/skills/create-example-app-with-integration/SKILL.md* covers the
    example application.

The guides are written for coding agents but are also useful as checklists for
human contributors.  Test initializer changes with `mise run test:init` and
examples with `mise run test:examples`.

### Adding vocabulary types

Vocabulary schemas live under *packages/vocab/src/*.  Follow the existing
YAML files and run `mise run codegen`.  Generated vocabulary types are exported
automatically, so do not edit *packages/vocab/src/vocab.ts* or add exports by
hand.  The detailed workflow is in *.agents/skills/add-vocab/SKILL.md*.

### Adding database adapters

The core `KvStore` and `MessageQueue` interfaces live in
*packages/fedify/src/federation/kv.ts* and
*packages/fedify/src/federation/mq.ts*.  A database-specific implementation
belongs in its own package.  Follow a nearby adapter and implement both
interfaces when the backend can support them.


Documentation
-------------

Use the same style in repository documentation, issue descriptions, pull
request descriptions, and comments unless a section below says otherwise.

When adding features or changing user-visible behavior, update the
documentation and any affected agent skills in the same change.  Check the
user-facing skills under *claude-plugin/skills/* and the contributor skills
under *.agents/skills/*, and keep the relevant API guidance, command examples,
and workflows consistent with the implementation.

### Markdown style

Most Markdown formatting is enforced by [Hongdown].  Follow these conventions
when writing or reviewing prose:

 -  Let Hongdown wrap prose in repository Markdown.  URLs and code blocks are
    exempt.
 -  Prefer reference links over inline links outside *docs/*.
 -  Use setext headings for document titles and sections.  Use ATX headings
    only for subsections.
 -  Use sentence case for headings.
 -  Leave two blank lines before a level-one or level-two heading.
 -  Use one space before and two spaces after a list marker.
 -  Wrap file paths and document names in asterisks.
 -  Wrap commands, package names, identifiers, and inline code in backticks.
 -  Use quadruple tildes for code blocks and specify the language after one
    space.
 -  Avoid bold text.  Use headings for structure and admonitions for warnings.
 -  In narrative text, write an em dash without surrounding spaces.  Spaces
    are allowed when it separates a term and description in a list or stands
    in for an empty table cell.

Run `mise run fmt` to format code and documentation when a check reports a
formatting problem.

[Hongdown]: https://github.com/dahlia/hongdown

### VitePress documentation

Read *docs/README.md* before changing the VitePress site.  It documents
internal links, Twoslash blocks, fixtures, code groups, and definition lists.

Preview the site while writing, then run the production build to check
Twoslash and the generated site:

~~~~ bash
mise run docs
mise run docs:build
~~~~


Pull requests
-------------

### Branch policy

Choose the target branch from the kind of change:

 -  Breaking changes target *next*.
 -  New, backward-compatible features target *main*.
 -  Bug fixes target the oldest maintenance branch that contains the bug.

Maintenance branches are named *x.y-maintenance*, such as
*1.5-maintenance*.  Fixes move forward through later maintenance branches,
then *main*, and finally *next*.  Ask in the issue if you are unsure which
branch contains the bug.

### Bug fixes

A bug-fix pull request should include:

 -  A regression test that fails without the patch and passes with it.
 -  The fix.
 -  A Sacho changelog fragment for a user-visible change, with both issue and
    pull request references and the external contributor's name.  See
    “Changelog entries” below for the requirements.

Link the accepted issue in the pull request.

### Features

A feature pull request should include:

 -  Tests for the new behavior.
 -  The implementation.
 -  Documentation and updates to affected agent skills.
 -  Any example changes needed to keep the examples working.
 -  A Sacho changelog fragment.

Describe the change, why it is needed, and how it was tested.  Link the
accepted issue.

### Issue and pull request descriptions

Explain the background and motivation, not only the resulting diff.  Keep each
prose paragraph on one source line and use `#123` for issue and pull request
references.

Before submitting an issue or pull request, pass its description to Hongdown on
standard input and use the formatted output:

~~~~ bash
hongdown --stdin --no-line-width
~~~~

This applies the repository's Markdown style without adding line breaks to
prose paragraphs.

Disclose AI assistance as required by *AI\_POLICY.md*.

### Pull request builds

A maintainer can publish a pre-release build for a pull request on request.
Ask in the pull request comments.  Published versions include the base version,
pull request number, build number, and commit hash, for example
`1.2.3-pr.456.789+abcdef01`.  The publishing workflow comments with the exact
versions and installation commands.


Commits and changelog entries
-----------------------------

### Commit messages

Do not use Conventional Commit prefixes such as `fix:` or `feat:`.  Keep the
subject under 50 characters when practical and explain why the change was
made.  Use permalink URLs for issues and pull requests so references survive a
repository move.

Leave a blank line after a colon before starting a list:

~~~~
This commit includes the following changes:

- Added foo
- Fixed bar
~~~~

When an AI tool assists with a commit, add the trailer required by
*AI\_POLICY.md*:

~~~~
Assisted-by: AGENT_NAME:MODEL_VERSION
~~~~

Use one trailer for each tool.  Do not use `Co-authored-by` for AI assistance.

For `MODEL_VERSION`, identify the model actually used and look up its official
identifier in the model maker's documentation, using a web search if needed.
Use that identifier, or the documented name of that model if no identifier is
available, including any variant or version needed to distinguish the model.
Do not invent an identifier or guess it from the tool's name, a model family,
or an old example.

### Changelog entries

Fedify uses [Sacho] to build *CHANGES.md* from Markdown fragments under
*changes.d/*.  This repository sets `materialize = true`, so Sacho regenerates
the unreleased region of *CHANGES.md* from the fragments.  A pull request that
adds or updates a fragment therefore changes *CHANGES.md* as a generated side
effect, and that is expected.  The fragments remain the source of truth: never
hand-edit the generated unreleased region of *CHANGES.md*; edit the fragment
instead and let Sacho refresh the region.

#### When to add a fragment

Add a fragment only when Fedify users can observe a change, for example through
the public API or CLI.  Internal refactoring, fixes to test code, and tests
added for coverage must not have changelog entries unless the same change also
affects behavior users can observe.  For changes with no user-visible effect,
omit the fragment and add this trailer to the commit message:

~~~~
Changelog: none
~~~~

For each user-visible change, create a fragment for the affected package using
a topic-based name rather than an issue or pull request number:

~~~~ bash
sacho add --section @fedify/fedify clearer-errors
~~~~

Each fragment must contain exactly one top-level unordered list.  Start each
entry with a past-tense verb such as “Added,” “Changed,” “Deprecated,” “Fixed,”
“Removed,” or “Security.”  Describe the user-visible change, why it was made,
and what users should do differently.  Keep implementation details and
development history out of the entry.  If the change evolves before release,
update the existing fragment so that it describes only the behavior users will
receive.

#### Issue and pull request links

Every changelog entry must include both the accepted issue number and the pull
request number at the end of its first paragraph, using shortcut links:

~~~~ markdown
 -  Fixed a bug where foo would bar.  [[#123], [#456] by John Doe]
~~~~

Before opening a pull request, its number is not yet known.  Use either of
these workflows:

1.  Predict the number if you will open the pull request immediately.  Find
    the highest issue, pull request, or discussion number in
    `fedify-dev/fedify` and add one.  First save the fragment with only the
    issue reference and run `sacho resolve-links` to create its `links`
    frontmatter.  Then manually add the predicted PR number to both that
    metadata and the entry's trailing references.  Use
    `https://github.com/fedify-dev/fedify/pull/<number>` for the predicted URL.
    For example, if the issue is #123 and the predicted PR is #456:

    ~~~~ yaml
    links:
      '#123': https://github.com/fedify-dev/fedify/issues/123
      '#456': https://github.com/fedify-dev/fedify/pull/456
    ~~~~

    Open the PR, verify its actual number, and correct both the metadata and
    the entry if the prediction was wrong.  Another contributor may have
    taken the predicted number in the meantime.

2.  Open the pull request with only the issue reference in the fragment.
    Then add the actual PR number to the entry and run `sacho resolve-links`
    to record its URL in the `links` frontmatter.  Amend the commit with the
    updated fragment and push the amended commit to the PR branch with
    `--force-with-lease`.

`sacho resolve-links` pins reference URLs so that Sacho can generate the
corresponding link definitions.  Review its diff, including any changes to
other fragments and the generated *CHANGES.md*.  Whichever workflow you use,
both references must be present before merging.

#### Contributor names

External contributors must include their name after the references, as in
`[[#123], [#456] by John Doe]`.  Maintainers may also include their name.
Prefer your real name, or a close rendering of it in Latin letters, rather
than copying your GitHub handle.  A pseudonym is welcome if that is how you
want to be credited.  Normally capitalize the first letter of each part of
the name, as in “John Doe.”  These naming conventions are guidelines; use
your preferred spelling and capitalization if you have a deliberate
preference.

#### Checking fragments

Keep the fragment on the same branch and in the same commit series as the
change.  Format it, preview the compiled section, and check it before
committing:

~~~~ bash
mise run fmt
sacho preview --section @fedify/fedify
sacho check
~~~~

[Sacho]: https://sacho.dev/guide/everyday-workflow

### Version bumps

Maintainers should update the next release version across the monorepo with the
following command instead of editing package metadata or *changes.d/next.txt*
by hand:

~~~~ bash
mise run bump-version <version>
~~~~


Final checks
------------

Run focused checks while working.  Before committing, check every package that
the change affects:

~~~~ bash
mise run check-each fedify vocab
mise run test-each fedify vocab
~~~~

For documentation-only changes, run the Markdown check and build the docs when
the rendered site is affected:

~~~~ bash
mise run check:md
mise run docs:build
~~~~

Run the repository-wide checks when a change crosses package boundaries or is
ready for release:

~~~~ bash
mise run check:all
mise run test:all
~~~~

Do not submit hypothetical code.  Verify the behavior in every environment
that the pull request claims to support, and report what you actually ran.
