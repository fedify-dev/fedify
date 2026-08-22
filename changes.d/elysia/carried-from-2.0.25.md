---
links:
  '#970': https://github.com/fedify-dev/fedify/issues/970
  '#972': https://github.com/fedify-dev/fedify/pull/972
---
 -  Fixed duplicate response headers on Elysia 1.4.18 and earlier, which
    append both `set.headers` and the returned `Response`'s own headers
    without deduplication.  The `fedify()` plugin no longer sets the headers
    in both places.
    [[#970], [#972] by Kyujin Lim\]
