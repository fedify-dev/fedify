---
links:
  '#1369': https://github.com/fedify-dev/fedify/issues/1369
  '#1435': https://github.com/fedify-dev/fedify/pull/1435
---
 -  Added the draft [FEP-f799] `DeliverySuspension` vocabulary type,
    `Collection.deliveryController`, and `controlledOrigins` on all five
    actor classes.  The TypeScript `suspensionStatus` accessor preserves the
    FEP's `status` wire term without merging unrelated status properties.
    Origin strings retain their spelling, and inbox/controller links are
    URL-valued without fetching resources.  These additions do not enable
    handling of suspension notices or suspend delivery.  [[#1369], [#1435]]

    `getRawPropertyValues()` now encodes these modeled properties from their
    typed values.  `withRawProperty()` and `withRawProperties()` decode writes
    into the typed fields and reject unsupported values.

[FEP-f799]: https://w3id.org/fep/f799
