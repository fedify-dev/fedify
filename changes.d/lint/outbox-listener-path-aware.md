---
links:
  '#1040': https://github.com/fedify-dev/fedify/pull/1040
  '#900': https://github.com/fedify-dev/fedify/issues/900
---
 -  Changed `outbox-listener-delivery-required` (`@fedify/lint`) to check
    whether its `ctx.sendActivity()`/`forwardActivity()` call is reachable,
    rather than merely present somewhere in the source.  It now reports a
    listener whose only delivery call sits in an unused nested helper
    function, behind a statically-dead branch (such as `if (false)` or code
    after an unconditional `return`), or inside a callback passed to an
    unrelated function (such as `array.map()`).  Existing listeners that
    deliver through a plain call, an aliased or destructured method, or a
    helper function that is actually called are unaffected.
    [[#900], [#1040] by Jae-Hyuk-Jang]
