---
links:
  '#754': https://github.com/fedify-dev/fedify/issues/754
  '#810': https://github.com/fedify-dev/fedify/issues/810
  '#823': https://github.com/fedify-dev/fedify/issues/823
  '#914': https://github.com/fedify-dev/fedify/pull/914
  '#925': https://github.com/fedify-dev/fedify/pull/925
  '#927': https://github.com/fedify-dev/fedify/pull/927
---
 -  Added vocabulary support for [FEP-7aa9], including
    `FeaturedCollection`, `FeaturedItem`, `FeatureRequest`, and
    `FeatureAuthorization`, plus actor `featuredCollections` and
    `InteractionPolicy.canFeature` properties.
    [[#810], [#914]]
 -  Added the `Endpoints.uploadMedia` property, the standard ActivityStreams
    endpoint for the [ActivityPub Media Upload extension].
    [[#754], [#927]]
 -  Fixed the CommonJS vocabulary build so it no longer requires
    `@js-temporal/polyfill` at runtime.  The build now bundles
    `temporal-polyfill`, while type declarations rely on the standard
    `esnext.temporal` lib reference.
    [[#823], [#925]]

[FEP-7aa9]: https://w3id.org/fep/7aa9
[ActivityPub Media Upload extension]: https://www.w3.org/wiki/SocialCG/ActivityPub/MediaUpload
