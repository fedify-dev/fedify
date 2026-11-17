---
links:
  '#1339': https://github.com/fedify-dev/fedify/issues/1339
  '#1347': https://github.com/fedify-dev/fedify/pull/1347
  '#1351': https://github.com/fedify-dev/fedify/pull/1351
  '#1391': https://github.com/fedify-dev/fedify/pull/1391
  '#1394': https://github.com/fedify-dev/fedify/issues/1394
  '#1397': https://github.com/fedify-dev/fedify/pull/1397
  '#554': https://github.com/fedify-dev/fedify/issues/554
  '#664': https://github.com/fedify-dev/fedify/issues/664
---
 -  Fixed `CryptographicKey` and `Multikey` rejecting a `publicKey` obtained
    from `node:crypto` in their constructors and `clone()` when `@types/node`
    24.7.0 or later is installed.  The property accepts a structural key type
    now, while the getters still return the ambient `CryptoKey` type.
    [[#554], [#1391]]
 -  Fixed an origin-check bypass that allowed crafted JSON-LD without a parent
    `id` to return forged embedded objects claiming another origin.
    [[GHSA-r388-57j3-5fgp]]
 -  Fixed invalid JSON-LD when a collection page embeds a parsed item whose
    context redefines a protected parent term, such as `proof`.  Default
    serialization now isolates independent child contexts while preserving
    their cached documents and extension meanings.  The parent's `@context`
    array gains property-scoped definitions, including for generated children
    with matching contexts; context-aware consumers need JSON-LD 1.1 support.
    Resolving the parent context uses `contextLoader`; URL references alongside
    isolated children are represented as objects with `id` and their own
    context.
    [[#1394], [#1397]]
 -  Fixed parsing of date-times without seconds, such as `2024-01-01T10:00Z`,
    `2024-01-01T10:00+09:00`, or `2024-01-01T10:00.5Z`, which Activity Streams
    2.0 allows.  They raised a `RangeError`, or were ignored in
    `Question.closed` when they had a fraction.  Date-like but impossible
    values in `Question.closed`, such as `2024-02-31T10:00.5Z`, now raise a
    `RangeError` instead of being silently dropped.
    [[#1339], [#1347] by ChanHaeng Lee\]
 -  Limited WebFinger lookups used by object resolution to 10 seconds each,
    and actor handle resolution to one 10-second deadline across alias checks.
    Actor handle resolution now checks at most 100 subject/alias candidates and
    skips duplicates.
    [[GHSA-9pmv-w936-hj3f]]
 -  Replaced <https://w3id.org/identity/v1> with
    <https://w3id.org/security/v1> in the default JSON-LD contexts of activity
    types.  The former no longer resolves, and <https://w3id.org/security/v1>
    defines the same terms the signatures use.
    [[#664], [#1351]]

[GHSA-r388-57j3-5fgp]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-r388-57j3-5fgp
[GHSA-9pmv-w936-hj3f]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-9pmv-w936-hj3f
