---
links:
  '#1325': https://github.com/fedify-dev/fedify/pull/1325
---
 -  Fixed incoming requests failing to reach dispatchers when Mastodon decoded
    percent-encoded colons in path identifiers.  Generated URIs and HTTP
    signature verification retain their existing behavior.  [[#1325]]
