---
links:
  '#1071': https://github.com/fedify-dev/fedify/issues/1071
  '#1088': https://github.com/fedify-dev/fedify/pull/1088
---
 -  Fixed `outbox-listener-delivery-required` and
    `outbox-listener-delivery-not-awaited` (`@fedify/lint`) to properly
    evaluate reachability in statically false loops (like `while (false)`) and
    to correctly traverse `for...of` and `for...in` loop binding patterns.
    Unreachable loop branches no longer count as deliveries, and
    `outbox-listener-delivery-not-awaited` now correctly catches dropped
    promises inside loop binding patterns.
    Loop default functions are checked only when the bound value or target
    object is referenced.
    [[#1071], [#1088] by @ArchieTansaria]
