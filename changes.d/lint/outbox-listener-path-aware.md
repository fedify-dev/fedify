---
links:
  '#1050': https://github.com/fedify-dev/fedify/pull/1050
  '#900': https://github.com/fedify-dev/fedify/issues/900
---
 -  Changed `outbox-listener-delivery-required` (`@fedify/lint`) to decide
    whether a `ctx.sendActivity()`/`ctx.forwardActivity()` call actually
    runs,
    instead of scanning the listener's source as a flat block of text. It
    now reports a listener whose only delivery call sits behind a dead
    branch, after an unconditional `return`/`throw`, or inside a local
    helper function that is never actually called. A helper that is
    called still counts, regardless of how it's referenced: by name,
    passed by reference to another function, or reached through a local
    object literal. An inline callback whose result is awaited or
    returned counts too, such as `await Promise.all(recipients.map(...))`.
    [[#900], [#1050] by Jae-Hyuk-Jang]
