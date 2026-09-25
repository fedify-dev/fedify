---
links:
  '#1059': https://github.com/fedify-dev/fedify/issues/1059
  '#1061': https://github.com/fedify-dev/fedify/pull/1061
---
 -  Fixed the plugin failing every request with a body on Node.js.  Building
    the `Request` for Fedify threw
    `RequestInit: duplex option is required when sending a body.`, so every
    `POST` or `PUT` got a 500 response, including activities delivered to the
    inbox.  [[#1059], [#1061]]

 -  Fixed the plugin breaking the request bodies of routes that Fedify does
    not handle.  The plugin started reading the body of every non-`GET`
    request in its `onRequest` hook, before Fedify decided whether the route
    was its own.  On Deno, which does not require the `duplex` option,
    Fastify's own parsing of a large body could then hang.  The plugin now
    reads the body only when Fedify handles the request.  [[#1059], [#1061]]
