---
links:
  '#1244': https://github.com/fedify-dev/fedify/issues/1244
  '#1261': https://github.com/fedify-dev/fedify/pull/1261
---
 -  Fixed asynchronous `contextDataFactory` and `federation.fetch()` failures
    being left as unhandled rejections in the Express integration.  Errors
    that occur before Fedify passes the request to the next middleware now
    reach Express error-handling middleware, so applications can send their
    usual error response.
    [[#1244], [#1261]]
