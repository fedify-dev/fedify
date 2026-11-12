---
links:
  '#1369': https://github.com/fedify-dev/fedify/issues/1369
  '#1435': https://github.com/fedify-dev/fedify/pull/1435
---
 -  Added the `fedify:typedString` and `fedify:positiveSafeInteger` schema
    ranges for vocabulary fields that need explicit `xsd:string` or
    `xsd:integer` datatypes during JSON-LD compaction.  The integer range
    accepts only positive safe numbers; incompatible incoming values are
    skipped by these codecs, while raw-property writes reject them.
    Existing scalar ranges retain their behavior.  [[#1369], [#1435]]
