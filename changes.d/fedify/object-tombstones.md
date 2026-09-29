---
links:
  '#1112': https://github.com/fedify-dev/fedify/issues/1112
  '#1117': https://github.com/fedify-dev/fedify/pull/1117
---
 -  Allowed object dispatchers to return `Tombstone` for deleted objects, as
    actor dispatchers already can.  Fedify now serves such object URIs with
    `410 Gone` and the serialized tombstone body, as ActivityPub recommends,
    after applying the authorization predicate as for other objects, so that
    applications no longer need a separate route in front of Fedify for
    deleted posts.  Fedify logs a warning if the tombstone's `id` does not
    match `Context.getObjectUri()`.  [[#1112], [#1117]]

     -  Changed the return type of `ObjectDispatcher` from
        `TObject | null` to `TObject | Tombstone | null`.
     -  Added a `RequestContext.getObject()` overload that takes
        a `GetObjectOptions` object.  By default, `getObject()` still returns
        `null` for a tombstone unless the tombstone is an instance of
        the requested class, e.g., `Object` or `Tombstone`.  Pass
        `{ tombstone: "passthrough" }` to receive tombstones.
     -  Added the `GetObjectOptions` interface.
     -  Changed object dispatchers registered for `Tombstone` or `Object`
        that return tombstones to be served with `410 Gone` instead of
        `200 OK`.
     -  Tombstones of [FEP-ef61] portable objects requested through
        the gateway endpoint are still served as other portable objects.

[FEP-ef61]: https://w3id.org/fep/ef61
