---
links:
  '#1296': https://github.com/fedify-dev/fedify/pull/1296
  '#897': https://github.com/fedify-dev/fedify/issues/897
---
 -  Added a `withDiagnostics` option to `lookupWebFinger()`.  When turned on,
    the function returns an object describing why the lookup failed—a
    network error, a malformed response, or the resource genuinely not
    existing—instead of returning `null` for every failure.
    `Context.lookupWebFinger()` does not support this option.
    [[#897], [#1296]]
