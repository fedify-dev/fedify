Linting
=======

Fedify lints its TypeScript and JavaScript sources with [Oxlint].  The default
lint task no longer invokes `deno lint`; Deno remains supported for formatting,
type checking, JSR publishing, and the published `@fedify/lint` plugin.

Run the repository lint task with:

~~~~ bash
mise run check:lint
~~~~

To lint only a package while developing:

~~~~ bash
mise run check-each fedify
~~~~

The root *.oxlintrc.json* is authoritative.  Pass it explicitly with
`-c .oxlintrc.json`; an explicit config disables Oxlint's nested-config lookup
and keeps command-line and editor behavior consistent.  Oxlint walks up to the
nearest config when run inside a package, so an unqualified `oxlint` usually
finds the root config too, but repository tasks always pass it explicitly.
`check:lint` and `check-each` use `--quiet` so warning-level rules do not flood
the gate; `mise run lint` shows them.

[Oxlint]: https://oxc.rs/docs/guide/usage/linter/


Rule mapping
------------

The configuration disables all Oxlint categories and lists rules explicitly, so
the enabled set does not change when Oxlint updates its defaults.  The parity
target is Deno 2.9.7's `recommended` tag plus the React rules from the `fresh`
tag.  Direct mappings use the same rule name under the `eslint/`, `typescript/`,
or `react/` plugin.

The following mappings need options or replacement rules:

| Deno rule                       | Oxlint rule                                                                                                   | Notes                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ban-ts-comment`                | `typescript/ban-ts-comment`                                                                                   | Descriptions required for `@ts-ignore`, `@ts-expect-error`, and `@ts-nocheck`; bare `@ts-check` allowed. |
| `ban-types`                     | `typescript/no-wrapper-object-types`, `typescript/no-unsafe-function-type`, `typescript/no-empty-object-type` | Deno rejects `{}` in intersections; Oxlint deliberately permits `T & {}`.                                |
| `no-unused-vars`                | `eslint/no-unused-vars`                                                                                       | Uses `args: "all"`, `caughtErrors: "all"`, and `^_` ignore patterns.                                     |
| `no-empty-interface`            | `typescript/no-empty-interface`                                                                               | Allows interfaces that extend a single base.                                                             |
| `no-empty-object-type`          | `typescript/no-empty-object-type`                                                                             | Allows empty interfaces; `no-empty-interface` owns those.                                                |
| `no-new-symbol`                 | `eslint/no-new-native-nonconstructor`                                                                         | Also rejects `new BigInt()`.                                                                             |
| `prefer-const`                  | `eslint/prefer-const`                                                                                         | Uses `destructuring: "all"` to match Deno.                                                               |
| `no-constant-condition`         | `eslint/no-constant-condition`                                                                                | Uses `checkLoops: false`.                                                                                |
| `jsx-curly-braces`              | `react/jsx-curly-brace-presence`                                                                              | Uses `propElementValues: "always"`.                                                                      |
| `jsx-key`                       | `react/jsx-key`                                                                                               | Uses `checkKeyMustBeforeSpread: false`.                                                                  |
| `react-no-danger`               | `react/no-danger`                                                                                             | Scoped to _examples/fresh/\*\*_ with the other Fresh React rules.                                        |
| `react-no-danger-with-children` | `react/no-danger-with-children`                                                                               | Scoped to _examples/fresh/\*\*_.                                                                         |
| `react-rules-of-hooks`          | `react/rules-of-hooks`                                                                                        | Scoped to _examples/fresh/\*\*_.                                                                         |

The remaining recommended rules map directly to their Oxlint names.  The
following Deno rules have no equivalent and are accepted gaps:

| Deno rule                                             | Reason                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `ban-untagged-ignore`                                 | Oxlint allows an unqualified `oxlint-disable`; a focused audit checks rule names. |
| `no-deprecated-deno-api`                              | Deno API surface only.                                                            |
| `no-sloppy-imports`                                   | Deno `--unstable-sloppy-imports` only.                                            |
| `no-unversioned-import`                               | Deno import specifiers only.                                                      |
| `no-window`, `no-window-prefix`                       | Deno global rules.                                                                |
| `no-invalid-triple-slash-reference`                   | Oxlint's `typescript/triple-slash-reference` has different semantics.             |
| `no-empty-enum`                                       | No Oxlint rule.                                                                   |
| `no-octal`                                            | Oxlint's parser only rejects legacy octal in module mode.                         |
| `no-import-assertions`                                | Oxlint accepts the deprecated `assert` syntax.                                    |
| `no-import-prefix`                                    | Deno-specific; only historical files used it.                                     |
| `fresh-handler-export`, `fresh-server-event-handlers` | Fresh support is deprecated; no Oxlint equivalent.                                |
| `no-slow-types`                                       | Deno-only JSR check, already disabled in *packages/init*.                         |

`no-dupe-args` and `no-await-in-sync-fn` are parser-covered.
`no-new-symbol` is handled by `no-new-native-nonconstructor` above.


Suppressions
------------

Use Oxlint's comment syntax and name the rules explicitly:

~~~~ typescript
// oxlint-disable-next-line typescript/no-explicit-any
const value: any = source;

// oxlint-disable-next-line eslint/no-unused-vars -- The generic is public API.
type Result<T> = unknown;
~~~~

Prefer a short reason comment above the directive when the suppression is not
obvious.  Do not use a bare `// oxlint-disable`;
`scripts/check_lint_directives.ts` rejects it.  A file-level directive is
allowed when a generated or vendored file would otherwise need many line-level
suppressions.

Run `mise run check:lint` after changing a suppression.  Oxlint reports unused
directives as errors, so remove a directive when the underlying violation no
longer exists.


File scope
----------

*.oxlintrc.json* mirrors the Deno lint scope.  In particular it ignores
documentation and agent skills, generated build outputs, Deno package
`exclude` entries that contain lintable files, the Fresh example's build
directory, and framework files (`.vue`, `.svelte`, `.astro`) that Deno lint did
not parse.

Two special cases:

 -  *packages/vocab/src/vocab.ts* is generated and gitignored.  Oxlint's
    directory traversal skips it, so `check:lint` and `check-each vocab` name
    it explicitly.
 -  *examples/lint/oxlint* deliberately violates `@fedify/lint` rules.  The
    repository lint task uses the root config, while the example's own
    `pnpm lint` task exercises its nested plugin configuration.


Additional rules and anti-slop
------------------------------

Additional Oxlint rules are added one at a time, each with its own commit and
a note here.  The current additions are:

 -  `eslint/no-await-in-loop` as a warning.  Fedify contains many loops that
    deliberately await sequentially, especially in tests and protocol code,
    so this stays advisory rather than failing the gate.
 -  `eslint/no-console` as a warning, except in *packages/cli/* where console
    output is the user interface.  The init package suppresses the one
    intentional user-facing warning.
 -  `import/no-duplicates`.
 -  `promise/no-nesting`.
 -  `promise/no-return-wrap`.
 -  `eslint/no-throw-literal`.
 -  `eslint/no-unsafe-optional-chaining`.
 -  `eslint/no-self-compare`.

Vendored [anti-slop] rules live in *tools/oxlint/anti-slop/*.  They are copied
from upstream and recorded in *tools/oxlint/anti-slop/UPSTREAM.md*; update
them by following the upstream install skill and recording the new revision.
The vendored directory is excluded from Oxlint, `deno fmt`, and Hongdown, and
`@oxlint/plugins` is pinned to the same exact version as `oxlint`.

The enabled generic rules are:

 -  `oxc/no-accumulating-spread`
 -  `anti-slop/no-array-filter-map`
 -  `anti-slop/no-module-mocking`
 -  `anti-slop/no-reduce-accumulator-copy`
 -  `anti-slop/no-reflect-apply`
 -  `anti-slop/no-reflect-get`
 -  `anti-slop/no-unknown-type-aliases`
 -  `anti-slop/no-widen-then-assert`

The remaining generic rules are deferred because they require broad type or
API refactoring: `no-chained-type-assertions`,
`no-conditional-empty-object-spread`, `no-known-value-widening`,
`no-object-parameters`, `no-runtime-typeof`, `no-shape-in-symbol-names`,
`no-unknown-parameters`, `no-unknown-returns`, `no-unsafe-dictionary-type`, and
`require-safety-comment-for-type-assertion`. `require-readable-spacing` is not
enabled because formatting is owned by the formatter.

[anti-slop]: https://github.com/dmmulroy/anti-slop
