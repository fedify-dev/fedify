---
links:
  '#1287': https://github.com/fedify-dev/fedify/issues/1287
  '#1357': https://github.com/fedify-dev/fedify/pull/1357
---
 -  Fixed the `ContextDataFactory` type to declare the Express `Request` and
    `Response` objects that `integrateFederation()` actually passes to the
    factory, instead of the Fetch API's `Request` and `Response`.  Factories
    can now use Express APIs such as `req.get()` without type errors.
    Factories whose parameters are annotated with the Fetch API types need
    those annotations updated.  [[#1287], [#1357]]
