---
links:
  '#1233': https://github.com/fedify-dev/fedify/issues/1233
  '#1235': https://github.com/fedify-dev/fedify/pull/1235
---
 -  Fixed the preloaded Mastodon context treating `attributionDomains` values
    as IRIs instead of plain domain name strings.  Values now expand as string
    literals and remain arrays when compacted, matching Mastodon's context.
    [[#1233], [#1235]]
