---
links:
  '#1098': https://github.com/fedify-dev/fedify/issues/1098
  '#1127': https://github.com/fedify-dev/fedify/pull/1127
---
 -  Fixed mock actor, object, and collection dispatcher setters returning the
    federation instead of the setters object, which caused chained settings
    to fail with a `TypeError`.  Settings can now be chained as with a real
    federation.  [[#1098], [#1127]]
