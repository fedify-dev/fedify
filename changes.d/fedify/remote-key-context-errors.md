---
links:
  '#1267': https://github.com/fedify-dev/fedify/issues/1267
  '#1270': https://github.com/fedify-dev/fedify/pull/1270
---
 -  Fixed signature verification throwing an exception when a remote actor
    supplied a malformed JSON-LD context or its context could not be fetched.
    These requesters are now treated as unverifiable.  [[#1267], [#1270]]
