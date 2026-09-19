---
links:
  '#1040': https://github.com/fedify-dev/fedify/pull/1040
  '#900': https://github.com/fedify-dev/fedify/issues/900
---
 -  Fixed `outbox-listener-delivery-required` (`@fedify/lint`) missing an
    undelivered outbox listener when the only `ctx.sendActivity()` or
    `ctx.forwardActivity()` call in its source never actually runs—for
    example, inside an unused nested helper function, behind a
    statically-dead branch, or inside a callback passed to an unrelated
    function.  The rule now checks whether a delivery call is reachable
    before treating the listener as compliant.
    [[#900], [#1040] by Jae-Hyuk-Jang]
