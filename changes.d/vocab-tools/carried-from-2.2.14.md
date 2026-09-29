---
links:
  '#1015': https://github.com/fedify-dev/fedify/issues/1015
  '#1043': https://github.com/fedify-dev/fedify/pull/1043
  '#1136': https://github.com/fedify-dev/fedify/pull/1136
  '#937': https://github.com/fedify-dev/fedify/issues/937
---
 -  Fixed generated decoders for properties whose range is `fedify:url`
    reading only literal (`@value`) values, so an IRI-valued (`@id`) value
    made them throw `TypeError: Invalid URL`.  They now read both forms,
    accept ATProto `at://` URIs, and skip a value that cannot be parsed
    instead of throwing.
    [[#1015], [#1043] by Jang Hanarae\]
 -  Fixed generated vocabulary accessors ignoring `suppressError: true` when
    parsing embedded JSON-LD values.  Generated iterators now skip malformed
    values, and singular accessors return `null`; calls without suppression
    continue to throw.
    [[#937], [#1136]]
