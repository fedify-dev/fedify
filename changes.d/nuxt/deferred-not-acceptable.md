---
links:
  '#1278': https://github.com/fedify-dev/fedify/issues/1278
  '#1279': https://github.com/fedify-dev/fedify/pull/1279
---
 -  Fixed deferred `406 Not Acceptable` responses becoming 404 when no
    application route or Nuxt page could serve a representation.  Renderer
    404s are now converted back to 406 before Nitro's error handler runs,
    so these responses do not reach Nitro's error handler or error hooks.
    Deliberate 404s from matched server routes are preserved.
    [[#1278], [#1279]]
