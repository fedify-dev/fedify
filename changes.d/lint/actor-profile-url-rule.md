---
links:
  '#1352': https://github.com/fedify-dev/fedify/pull/1352
  '#894': https://github.com/fedify-dev/fedify/issues/894
---
 -  Added the `actor-profile-url-required` lint rule, which warns when an
    actor dispatcher's return value does not include a `url` (or `urls`)
    profile URL.  The diagnostic explains the interoperability benefit without
    treating the actor document as invalid.  [[#894], [#1352]]
