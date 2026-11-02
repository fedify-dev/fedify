---
links:
  '#1352': https://github.com/fedify-dev/fedify/pull/1352
  '#894': https://github.com/fedify-dev/fedify/issues/894
---
 -  Changed `fedify init` to exclude the `actor-profile-url-required` lint
    rule from generated Deno projects, because Deno Lint reports plugin rules
    as errors and the default scaffold has no profile page.
    [[#894], [#1352]]
