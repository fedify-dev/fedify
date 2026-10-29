---
links:
  '#1335': https://github.com/fedify-dev/fedify/issues/1335
  '#1340': https://github.com/fedify-dev/fedify/pull/1340
---
 -  Changed `fedify init` to label the `denokv` key-value store and message
    queue as `denokv (deprecated)` in the interactive prompts.  The option
    stays selectable, `-k denokv` and `-m denokv` still work, and the generated
    project excludes the matching deprecation lint rule so that `deno lint`
    succeeds.  [[#1335], [#1340]]
