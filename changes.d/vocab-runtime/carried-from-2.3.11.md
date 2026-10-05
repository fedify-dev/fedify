---
links:
  '#1211': https://github.com/fedify-dev/fedify/issues/1211
  '#1216': https://github.com/fedify-dev/fedify/pull/1216
  '#1229': https://github.com/fedify-dev/fedify/issues/1229
  '#1231': https://github.com/fedify-dev/fedify/pull/1231
  '#1233': https://github.com/fedify-dev/fedify/issues/1233
  '#1235': https://github.com/fedify-dev/fedify/pull/1235
---
 -  Added the [FEP-6757] context to the preloaded JSON-LD contexts.  The default
    document loader now resolves <https://w3id.org/fep/6757> locally, so
    transient Codeberg Pages outages no longer prevent otherwise valid inbound
    documents from being parsed or verified.
    [[#1211], [#1216]]
 -  Fixed the `LanguageString` constructor throwing a `RangeError` for
    language tags with extended language subtags, such as `zh-YUE`.  It now
    stores their canonical form (`yue`) as its `locale`.
    [[#1229], [#1231]]
 -  Fixed the preloaded Mastodon context treating `attributionDomains` values
    as IRIs instead of plain domain name strings.  Values now expand as string
    literals and remain arrays when compacted, matching Mastodon's context.
    [[#1233], [#1235]]

[FEP-6757]: https://w3id.org/fep/6757
