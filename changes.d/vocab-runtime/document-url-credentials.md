---
links:
  '#1294': https://github.com/fedify-dev/fedify/issues/1294
  '#1295': https://github.com/fedify-dev/fedify/pull/1295
---
 -  Fixed `getDocumentLoader()` accepting URLs with a username or password.
    Such URLs now throw `UrlError` before fetching on all runtimes, including
    redirect and alternate document targets, regardless of
    `allowPrivateAddress`.  [[#1294], [#1295]]
