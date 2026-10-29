---
links:
  '#1335': https://github.com/fedify-dev/fedify/issues/1335
  '#1340': https://github.com/fedify-dev/fedify/pull/1340
---
 -  Changed the interactive `fedify init` prompts to label the `denokv`
    key-value store and message queue as `denokv (deprecated)`.  The option
    stays selectable, `-k denokv` and `-m denokv` still work, and generated
    Deno projects keep the unstable flag and exclude the corresponding
    `@fedify/lint` deprecation rule so that `deno lint` succeeds.
    [[#1335], [#1340]]
