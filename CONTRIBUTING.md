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

Fedify is a TypeScript monorepo.  Deno is the primary development environment,
and the project also tests supported packages on Node.js and Bun.  [mise]
installs the required tool versions and runs repository tasks.

Run these commands after cloning the repository:

~~~~ bash
mise trust
mise install
~~~~

The `mise install` post-install hook runs `mise deps`.  That command generates
code, installs dependencies, builds the packages, and installs the Git
pre-commit hook when no hook is already present.  You normally need to run
`mise install` only once per checkout.

Install or refresh the pre-commit hook explicitly with
`mise run hooks:install`.

Run development workflows through mise.  Do not call `npm` or `pnpm` directly
for repository tasks.  Start by inspecting the available commands:

~~~~ bash
mise tasks
mise tasks <task>
~~~~

Use `mise run <task>` to run a task.  For example:

~~~~ bash
mise run check
mise run test:deno
~~~~

The recommended editor is [Visual Studio Code] with the [Deno extension], but
any editor with Deno support will work.

[mise]: https://mise.jdx.dev/
[Visual Studio Code]: https://code.visualstudio.com/
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
inputs or `@fedify/vocab-tools` change.  Run the code generator directly when
you need to refresh generated files for an editor or language server:

~~~~ bash
mise run codegen
~~~~

Build the whole repository with `mise run build`.  While working on a small
set of packages, rebuild only those packages, without the `@fedify/` prefix:

~~~~ bash
mise run prepare-each fedify vocab
~~~~

### Running the CLI

Use the `cli` task to run the local Fedify CLI through Deno:

~~~~ bash
mise run cli -- lookup @fedify@hackers.pub
~~~~

The released CLI is also tested on Node.js and Bun.  The local `cli` task is a
quick development path, not a replacement for the multi-runtime tests.


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


Testing
-------

Add tests for new behavior and regression tests for bug fixes.  Prefer a
focused Deno test while developing because Deno runs the TypeScript sources
directly.  Use in-memory stores unless the test is specifically exercising a
database adapter:

~~~~ bash
mise run test:deno path/to/file.test.ts --filter "test name"
~~~~

Use `test:node` or `test:bun` instead when the behavior is specific to one of
those runtimes.  Once the change is stable, run the affected package suites in
all supported runtimes:

~~~~ bash
mise run test-each fedify vocab
~~~~

Run the repository-wide suite before a release or when the change has broad
effects:

~~~~ bash
mise run test
~~~~

### Updating vocabulary snapshots

Changes to `@fedify/vocab-tools` or the vocabulary YAML schemas can affect the
generated output recorded in snapshots.  Update the Deno, Node.js, and Bun
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

The `@fedify/fedify` and `@fedify/vocab` packages are exceptions.  Their
Cloudflare Workers test harness consumes the `testDefinitions` registry from
the private `@fedify/fixture` package, so their tests must use its `test()`
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

The `test:init` task exercises `fedify init` across web frameworks, package
managers, key-value stores, and message queues:

~~~~ bash
mise run test:init
~~~~

Pass options after `--` to limit the matrix:

~~~~ bash
mise run test:init -- -w hono -p deno
mise run test:init -- -w hono -w express -p deno -p npm -k denokv -m denokv
~~~~

The test artifacts are written under */tmp/fedify-init/&lt;run-id&gt;/* on Unix.
The internal `test-init` command uses `FEDIFY_TEST_MODE` to select local
workspace packages and is not part of the public CLI.

### Testing examples

Run all example tests, or name the examples that your change affects:

~~~~ bash
mise run test:examples
mise run test:examples -- astro sveltekit-sample
~~~~


Dependencies
------------

The repository commits both *deno.lock* and *pnpm-lock.yaml*.  Use `mise deps`
after adding, updating, or removing a dependency, and commit the lockfile
changes that it produces.

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
2.  Add the package path to the `workspace` array in the root *deno.json* when
    Deno should include it.
3.  Add the path to `packages` in *pnpm-workspace.yaml*.
4.  Add the package to the table in *README.md*.
5.  Add its path and owners to *.github/CODEOWNERS*.

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
 -  A *CHANGES.md* entry with the issue, pull request, and contributor name,
    unless the contributor wants to remain anonymous.

Link the accepted issue in the pull request.

### Features

A feature pull request should include:

 -  Tests for the new behavior.
 -  The implementation.
 -  Documentation for public API changes.
 -  Any example changes needed to keep the examples working.
 -  A *CHANGES.md* entry.

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

### Changelog entries

Keep *CHANGES.md* entries in reverse chronological order.  Version sections use
setext headings and unreleased versions begin with `To be released.`

Use ` -  ` for list items and indent continuation lines by four spaces.
Describe the user-visible change, why it was made, and what users should do
differently.  Add a `[[#123]]` marker and define its reference link at the end
of the version section:

~~~~ markdown
 -  Fixed a bug where foo would bar.  [[#123]]

[#123]: https://github.com/fedify-dev/fedify/pull/123
~~~~

For an external contributor, add their name after the marker, for example
`[[#123] by John Doe]`.


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
mise run check
mise run test
~~~~

Do not submit hypothetical code.  Verify the behavior in every environment
that the pull request claims to support, and report what you actually ran.
