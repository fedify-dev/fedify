---
links:
  '#1146': https://github.com/fedify-dev/fedify/issues/1146
  '#1171': https://github.com/fedify-dev/fedify/pull/1171
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Changed `Context.routeActivity()` to compare an activity that has no
    valid proof with its actors by their [FEP-fe34] origins once it has
    dereferenced the activity, where the origin of an [FEP-ef61] portable ID,
    i.e., an `ap:` or `ap+ef61:` URI or a compatible identifier, is its DID
    rather than the gateway that serves it.  Previously, it compared their web
    origins, so a portable activity was routed even if its actors had other
    DIDs.  Now a portable activity is routed only if all of its actors have
    the same DID as the activity itself, and an activity with an ordinary
    HTTP(S) ID is not routed if any of its actors has a portable ID.
    A portable activity dereferenced through a compatible identifier also
    matches its `ap:` ID, and vice versa.  [[#288], [#1146], [#1171]]

[FEP-fe34]: https://w3id.org/fep/fe34
[FEP-ef61]: https://w3id.org/fep/ef61
