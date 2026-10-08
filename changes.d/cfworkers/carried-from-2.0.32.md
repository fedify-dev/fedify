---
links:
  '#1255': https://github.com/fedify-dev/fedify/issues/1255
  '#1260': https://github.com/fedify-dev/fedify/pull/1260
---
 -  Fixed npm refusing to install `@fedify/cfworkers` alongside
    `@cloudflare/workers-types` 5.x, which recent versions of Wrangler
    require, unless `--legacy-peer-deps` or an override was used.  The peer
    dependency on `@cloudflare/workers-types` now accepts both 4.x and 5.x,
    so you can drop such workarounds.
    [[#1255], [#1260]]
