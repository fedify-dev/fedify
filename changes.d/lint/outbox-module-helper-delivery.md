---
links:
  '#1054': https://github.com/fedify-dev/fedify/issues/1054
  '#1103': https://github.com/fedify-dev/fedify/pull/1103
---
 -  Fixed `outbox-listener-delivery-required` reporting a warning when an outbox
    listener delegates delivery to a helper declared in the same file.  Called
    helpers are now followed through function declarations, function bindings,
    and object-literal methods, including recursive helper calls.  Helpers
    imported from other files are not analyzed.  [[#1054], [#1103]]
