---
links:
  '#1015': https://github.com/fedify-dev/fedify/issues/1015
  '#1043': https://github.com/fedify-dev/fedify/pull/1043
---
 -  Fixed generated decoders for properties whose range is `fedify:url`
    reading only literal (`@value`) values, so an IRI-valued (`@id`) value
    made them throw `TypeError: Invalid URL`.  They now read both forms,
    accept ATProto `at://` URIs, and skip a value that cannot be parsed
    instead of throwing.  [[#1015], [#1043] by Jang Hanarae]
