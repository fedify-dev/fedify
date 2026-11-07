Formatting
==========

The Oxfmt migration is tracked in [#1285], part of [#1281].  The configuration
in *.oxfmtrc.json* keeps the existing Deno style where Oxfmt supports it:
80 columns, two spaces, LF endings, double quotes, semicolons, trailing commas,
and parentheses around arrow function parameters.  Quoted property names are
preserved.  Import sorting, package metadata sorting, Tailwind class sorting,
and JSDoc rewriting are disabled.

[#1281]: https://github.com/fedify-dev/fedify/issues/1281
[#1285]: https://github.com/fedify-dev/fedify/issues/1285


Formatting commands
-------------------

Format the repository and check its code formatting with:

~~~~ bash
mise run fmt
mise run check:fmt
~~~~

Both tasks run without Deno.  `fmt` runs Oxfmt, Hongdown, and Sacho;
`check:fmt` checks only Oxfmt-owned files using the root configuration.
`mise run check` also runs the Markdown checks.
`mise run check-each <packages>` checks formatting, linting, and types for
selected packages.  Node.js packages do not need Deno for that command;
Deno-only packages prepare the Deno cache before their type check.

The VS Code and Zed settings use the project-local Oxfmt installation.  Make
sure the Node.js that mise provisions is on the editor's `PATH`.  Deno's
language server remains enabled for type diagnostics, and save actions do not
reorder imports.  Use `oxfmt-ignore` for an intentional JavaScript or
TypeScript layout exception.


Formatting ownership
--------------------

Oxfmt covers the JavaScript, TypeScript, JSON, JSONC, CSS, YAML, Astro, Vue, and
Svelte files previously checked by Deno.  The root and workspace exclusions
are carried into its ignore patterns, including initializer templates,
Cloudflare Workers test infrastructure, vocabulary schemas, and vendored tools.
TOML, HTML, SVG, and previously unmanaged formats remain outside this check.

Hongdown continues to format repository Markdown.  Sacho continues to format
changelog fragments and materialize the unreleased changelog.  Oxfmt excludes
Markdown, including fragments and *CHANGES.md*.  Embedded formatting is
disabled in JavaScript and TypeScript template literals; it remains enabled in
Astro, Vue, and Svelte so their script and style blocks retain coverage.

*packages/vocab/src/vocab.ts* is generated and Git-ignored, so a directory-wide
Oxfmt run skips it.  `mise run check:fmt` passes it to Oxfmt by explicit path.
The generator formats it with the same Oxfmt options used for hand-written
code.  `mise run codegen:check:deno` checks that formatting with Oxfmt, then
checks Deno types.  Update the schemas or generator and run `mise run codegen`
rather than editing the output by hand.

Published benchmark JSON schemas under *schema/bench/* retain the exact
`JSON.stringify()` serialization emitted by their generator.  They are excluded
from Oxfmt because the CLI's schema guards check both generator parity and
byte-for-byte immutability of published versions.  Other JSON files remain
covered by Oxfmt.


Reviewed differences
--------------------

Before adoption, an audit found that the pinned Deno formatter managed
1,368 files, including generated vocabulary.  The Oxfmt preview preserved that
scope, with generated vocabulary checked separately.  The mechanical formatting
commit, including the preparation files, changed 818 tracked files, adding
42,758 lines and removing 43,882.  Four Oxfmt ignore comments preserve
intentional layouts.  Five existing lint or TypeScript suppression comments
were relocated to their diagnostic lines after wrapping.

Most differences are line wrapping: Oxfmt collapses short
arrays and calls, including JSON arrays that Deno preserves across multiple
lines.  It also indents conditional expressions differently and inserts
parentheses around mixed logical operators.  Those layouts have no matching
configuration option.  Keeping quoted property names avoids extra churn.
Raising the line width would change the style, and excluding affected source
files would reduce coverage.

The preview's TypeScript syntax trees and parsed JSON and YAML values were
compared with the original sources, ignoring syntax trivia and transparent
parentheses.  JSX whitespace differences were checked by comparing the output
of TypeScript's JSX transform for both versions, treating adjacent rendered
string children as one.  The only other syntax-tree difference is reordered
regular-expression flags; the set of flags is unchanged.  Raw generator
snapshots were unchanged.  Four existing empty-comment layouts needed a second
normalization pass. After normalization, consecutive Oxfmt runs produced no
further changes.

Oxfmt, `@astrojs/compiler-rs`, and `svelte` are pinned.  Review a formatter
upgrade's diff before adopting it, and keep mechanical formatting separate
from behavior changes so maintenance fixes remain easier to forward-merge.

Keep Oxfmt pinned to 0.76.0: the 0.77.0 CLI crashed intermittently in the
Windows formatter tests.  A formatter upgrade must pass the Windows bootstrap
job, which runs *scripts/formatting.test.ts* in 100 fresh Node.js processes.


Generated-code differences
--------------------------

The generator now sends its raw output directly to Oxfmt.  Unlike the
previous dprint pass, Oxfmt leaves named import bindings in their emitted
order and does not add braces around a single wrapped return statement.
These differences do not change module evaluation order or control flow.
The complete generated vocabulary was compared before and after the switch,
accounting for those transformations, and its Oxfmt output is stable.
