# Vendored anti-slop

- Source: https://github.com/dmmulroy/anti-slop
- Revision: 13909c9e07590f5a85d93c62712259fe14a883f7 (2026-10-14)
- Copied with: `.agents/skills/install-anti-slop/scripts/install.mjs`
- Installed path: `tools/oxlint/anti-slop/`
- License: MIT; see `LICENSE` and `vendor/eslint-stylistic/LICENSE`

The upstream skill bundle strips the upstream test files. `src/` is the
canonical upstream source; the vendored copy keeps the plugin entry point,
generic rules, shared helpers, the Effect rules, and the vendored ESLint
Stylistic padding-line helpers with their provenance.

Local changes:

- Only the rules enabled in `.oxlintrc.json` are active. Rules that need
  broad type or API refactoring remain disabled and are tracked separately.
- `require-readable-spacing` is not enabled because formatting is owned by the
  repository formatter.
- `shared/type-alias-resolution.ts` starts alias substitutions from an empty map
  so caller type parameters do not leak into an alias body.  This avoids a
  false `no-unknown-type-aliases` report and is worth upstreaming.
- `rules/no-widen-then-assert.ts` ignores locally declared `Record`,
  `Readonly`, and `PropertyKey` bindings instead of treating them as the
  built-in utility types.  This avoids false reports when a local type shadows
  those names and is worth upstreaming.
- The vendored directory is excluded from Oxlint, `deno fmt`, and Hongdown.

Update procedure: reinstall the skill, run its installer into a staging
directory, diff against this copy, review rule changes, then replace the
vendored files and update the revision above. Keep `oxlint` and
`@oxlint/plugins` on the same exact version.
