---
links:
  '#1059': https://github.com/fedify-dev/fedify/issues/1059
  '#1061': https://github.com/fedify-dev/fedify/pull/1061
  '#1068': https://github.com/fedify-dev/fedify/pull/1068
---
 -  Fixed `integrateFederation()` breaking the request bodies of routes that
    Fedify does not handle.  The middleware started reading the body of every
    non-`GET` request before Fedify decided whether the route was its own, so
    a body parser mounted after it could receive a truncated body or wait
    forever.  Small bodies usually got through, which is why the problem
    tended to show up only with large ones, such as long posts submitted to
    an application's own API.  The middleware now reads the body only when
    Fedify handles the request.  If you limited the middleware to federation
    paths to work around this, you can remove that workaround.
    [[#1059], [#1061], [#1068]]
