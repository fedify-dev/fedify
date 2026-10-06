---
links:
  '#1212': https://github.com/fedify-dev/fedify/issues/1212
  '#1241': https://github.com/fedify-dev/fedify/pull/1241
---
 -  Added vocabulary support for the [FEP-6757] draft, which marks
    ActivityPub content with explicit copyright license URIs.
    [[#1212], [#1241]]

     -  Added `Object.licenses` and `Link.licenses` properties for the
        alternative licenses of an object or a link.  They write the Dublin
        Core `license` property and also read the Schema.org and Creative
        Commons `license` properties when it is absent.  Values that are not
        absolute URIs, such as license names or SPDX short identifiers, are
        skipped.
     -  Added `preferredLicense` property to `Application`, `Group`,
        `Organization`, `Person`, and `Service` for the license an actor
        prefers for its new objects.  It is not a fallback for objects without
        their own license.
     -  Fedify does not fill in a default license for objects without license
        metadata and never fetches a license URI.

[FEP-6757]: https://w3id.org/fep/6757
