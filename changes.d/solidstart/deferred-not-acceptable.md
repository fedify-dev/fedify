---
links:
  '#1278': https://github.com/fedify-dev/fedify/issues/1278
  '#1279': https://github.com/fedify-dev/fedify/pull/1279
---
 -  Fixed deferred `406 Not Acceptable` responses becoming 404 when an
    application returned a `Response` with status 404, returned no response,
    or threw a 404 error.  Responses with other statuses are preserved.  The
    406 is restored for buffered 404 responses before headers are sent;
    responses whose headers have already been sent cannot be changed.  Thrown
    errors still reach Nitro's error hooks.  [[#1278], [#1279]]
