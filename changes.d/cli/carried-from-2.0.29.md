---
links:
  '#1063': https://github.com/fedify-dev/fedify/issues/1063
  '#1116': https://github.com/fedify-dev/fedify/pull/1116
---
 -  The `fedify lookup` command now reports HTTP, DNS, and parsing failures
    instead of suggesting authorized fetch for every failure.  It only suggests
    `-a`/`--authorized-fetch` for unsigned object requests that return HTTP 401,
    403, or 404.  Failed lookups retain successful results from other URLs, and
    request timeouts report the `-T`/`--timeout` guidance.
    [[#1063], [#1116]]
