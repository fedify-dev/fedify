---
links:
  '#1131': https://github.com/fedify-dev/fedify/issues/1131
  '#1169': https://github.com/fedify-dev/fedify/pull/1169
---
 -  Changed `fedify lookup` to time out each request after 10 seconds when
    the `-T`/`--timeout` option is not given, since the document loaders it
    uses now have a default timeout.  Previously, there was no timeout by
    default.  The `-T`/`--timeout` option now also limits how long
    a request waits for a DNS lookup, though it cannot stop the lookup
    itself.  [[#1131], [#1169]]
