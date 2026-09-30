---
links:
  '#1126': https://github.com/fedify-dev/fedify/issues/1126
  '#1174': https://github.com/fedify-dev/fedify/pull/1174
---
 -  Fixed `outbox-listener-delivery-required` treating a delivery function
    installed by an uncalled or late local setup helper as delivered.  The rule
    now considers a direct setup call before the installed function is used.
    [[#1126], [#1174]]
