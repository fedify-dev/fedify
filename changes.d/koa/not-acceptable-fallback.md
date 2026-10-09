---
links:
  '#1277': https://github.com/fedify-dev/fedify/issues/1277
  '#1280': https://github.com/fedify-dev/fedify/pull/1280
---
 -  Fixed federation endpoints returning `404 Not Found` instead of
    `406 Not Acceptable` when the application cannot handle a request with an
    unsupported `Accept` header. Application responses, including explicit
    404s, are preserved.  The fallback includes `Vary: Accept`.
    [[#1277], [#1280]]
