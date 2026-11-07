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


Migration commands
------------------

During the transition, `mise run fmt` still writes Deno formatting.
`mise run check:fmt` accepts a complete tree formatted by either Deno or
Oxfmt, then separately checks the generated vocabulary with Deno.
`mise run check-each` uses the same transition gate.  Mixing the two styles
within a tree does not pass.  This temporary gate allows a separate mechanical
formatting commit before the default writer, editor settings, and generator
switch together.

Preview the new configuration without writing files:

~~~~ bash
mise run check:fmt:oxfmt
~~~~

Apply the previewed configuration with `mise run fmt:oxfmt`.  Do not save files
through the old editor formatter between the mechanical formatting commit and
the final switch.  The temporary gate and commands are removed at that switch.


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

Generated *packages/vocab/src/vocab.ts* is Git-ignored.  A directory-wide check
therefore never sees it, so the task checks the file by explicit path.  It
remains under the existing generator's dprint formatter until the final
migration commit, which replaces both generation and validation together.


Reviewed differences
--------------------

Before adoption, an audit of the pinned Deno formatter found 1,368 managed
files, including generated vocabulary.  The Oxfmt preview preserved that
scope, with generated vocabulary checked separately.  The preview changed
814 tracked files, adding 43,760 lines and removing 44,854.  These figures
describe the original sources, before adding migration tooling.

The remaining differences are mostly line wrapping: Oxfmt collapses short
arrays and calls, including JSON arrays that Deno preserves across multiple
lines.  It also indents conditional expressions differently and inserts
parentheses around mixed logical operators.  Those layouts have no matching
configuration option.  Keeping quoted property names avoids additional churn;
raising the line width or excluding affected source files would change the
style or reduce coverage.

The preview's TypeScript syntax trees and parsed JSON and YAML values were
compared with the original sources, ignoring syntax trivia and transparent
parentheses.  JSX whitespace differences were checked by comparing the output
of TypeScript's JSX transform for both versions, treating adjacent rendered
string children as one.  The remaining
regular-expression flag reordering preserves the same flags.  Raw generator
snapshots were unchanged.  A second Oxfmt pass produced no further changes.

Oxfmt, `@astrojs/compiler-rs`, and `svelte` are pinned.  Review a formatter
upgrade's diff before adopting it, and keep mechanical formatting separate
from behavior changes so maintenance fixes remain easier to forward-merge.
