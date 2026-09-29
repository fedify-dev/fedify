---
links:
  '#1015': https://github.com/fedify-dev/fedify/issues/1015
  '#1043': https://github.com/fedify-dev/fedify/pull/1043
  '#1136': https://github.com/fedify-dev/fedify/pull/1136
  '#937': https://github.com/fedify-dev/fedify/issues/937
---
 -  Fixed parsing a `Note`, `Article`, `ChatMessage`, or `Question` throwing
    `TypeError: Invalid URL` when the sender's JSON-LD context declared
    `_misskey_quote`, `quoteUri`, or `quoteUrl` with `"@type": "@id"`, as
    Misskey-compatible servers do.  Such terms expand to a node carrying `@id`
    rather than `@value`, and only `@value` was read.  A quote URL that cannot
    be parsed at all, such as an inlined quote object without an `id`, is now
    ignored instead of failing the whole object, and ATProto `at://` quote
    URLs are accepted.
    [[#1015], [#1043] by Jang Hanarae\]
 -  Fixed `suppressError: true` being ignored when vocabulary accessors parsed
    embedded JSON-LD values.  Malformed values are now skipped by iterators or
    returned as `null` by singular accessors; calls without suppression continue
    to throw.
    [[#937], [#1136]]
