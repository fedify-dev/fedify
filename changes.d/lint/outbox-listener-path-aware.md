---
links:
  '#1050': https://github.com/fedify-dev/fedify/pull/1050
  '#900': https://github.com/fedify-dev/fedify/issues/900
---
 -  Changed `outbox-listener-delivery-required` (`@fedify/lint`) to decide
    whether a `ctx.sendActivity()`/`ctx.forwardActivity()` call actually
    runs, instead of scanning the listener's source as a flat block of text.
    It now reports a listener whose only delivery calls sit behind a dead
    branch, after an unconditional `return`/`throw`, or inside a function
    that is never used. When it cannot tell whether a delivery call runs, it
    stays quiet: a function held under a name counts as used as soon as that
    name is mentioned, however it is passed around, and an inline callback
    counts wherever it is passed.
    [[#900], [#1050] by Jae-Hyuk-Jang]
