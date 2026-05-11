<!-- deno-fmt-ignore-file -->

@fedify/lint with Oxlint
========================

This example demonstrates how to use [`@fedify/lint`] together with [Oxlint]
to catch common Fedify federation mistakes.  Note that Oxlint's JS plugin
support is upstream alpha and may be unstable.

[`@fedify/lint`]: https://www.npmjs.com/package/@fedify/lint
[Oxlint]: https://oxc.rs/docs/guide/usage/linter/


Layout
------

 -  *.oxlintrc.json* — Oxlint configuration that enables `@fedify/lint`
    via the JS plugin API.
 -  *federation.ts* — code that intentionally violates several rules
    (missing `id`, `inbox`, `outbox`, `followers`).
 -  *federation.fixed.ts* — corrected version that passes all rules.


Usage
-----

Install dependencies and run the linter:

~~~~ sh
pnpm install
pnpm lint
~~~~

You should see at least one `@fedify/lint(actor-id-required)` error on
*federation.ts*. Running against *federation.fixed.ts* alone produces no
diagnostics:

~~~~ sh
pnpm lint:fixed
~~~~


How it works
------------

The plugin is loaded via the `jsPlugins` field in *.oxlintrc.json*:

~~~~ json
{
  "jsPlugins": ["@fedify/lint/oxlint"],
  "rules": {
    "@fedify/lint/actor-id-required": "error"
  }
}
~~~~

`@fedify/lint/oxlint` is a subpath export that exposes the same rules as the
ESLint plugin in Oxlint's plugin shape. Rule IDs are namespaced under
`@fedify/lint/`.

See the [Linting] manual for the full rule reference.

[Linting]: https://fedify.dev/manual/lint
