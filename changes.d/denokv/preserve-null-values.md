---
links:
  '#1175': https://github.com/fedify-dev/fedify/issues/1175
  '#1181': https://github.com/fedify-dev/fedify/pull/1181
---
 -  Fixed `DenoKvStore` treating stored `null` values as missing keys when
    reading, listing, or comparing values.  Applications can now store and
    retrieve `null` without losing it.  [[#1175], [#1181]]
