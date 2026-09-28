---
links:
  '#1041': https://github.com/fedify-dev/fedify/pull/1041
  '#1094': https://github.com/fedify-dev/fedify/issues/1094
  '#1102': https://github.com/fedify-dev/fedify/pull/1102
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#938': https://github.com/fedify-dev/fedify/issues/938
---
 -  Security: Inbox processing now independently verifies each portable actor,
    activity, and object in a compound JSON document against its own map-local
    Object Integrity Proof before dispatch.  A valid outer proof no longer
    authenticates an unsigned or invalid nested portable object.
    Portable documents with proof sets or which exceed the inbox compound
    traversal limits are rejected as unsupported.  The top-level Linked
    Data Signature of an activity is not part of any proof input, so an
    activity that carries both proofs and a Linked Data Signature is
    accepted.  [[#288], [#938], [#1041], [#1094], [#1102]]
