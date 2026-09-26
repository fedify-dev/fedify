---
links:
  '#1057': https://github.com/fedify-dev/fedify/issues/1057
  '#1067': https://github.com/fedify-dev/fedify/pull/1067
---
 -  Added the `outbox-listener-delivery-not-awaited` rule to `@fedify/lint`.
    It reports an outbox listener that calls `ctx.sendActivity()` or
    `ctx.forwardActivity()` and drops the returned promise, so that the
    activity may never leave on a runtime such as Cloudflare Workers, which
    discards pending work once the response is returned. A call counts as
    handled when its promise is awaited, returned, passed to `Promise.all()`
    and its siblings, or handed to `waitUntil()`, and `void` opts a call out.
    The ESLint `recommended` configuration enables the rule as a warning and
    `strict` as an error, and Oxlint users enable it by name. It is not
    available in Deno Lint, which turns on every rule of a plugin at once.
    [[#1057], [#1067] by Jae-Hyuk-Jang]
