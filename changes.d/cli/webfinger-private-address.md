---
links:
  '#1274': https://github.com/fedify-dev/fedify/issues/1274
  '#1276': https://github.com/fedify-dev/fedify/pull/1276
---
 -  Fixed `fedify webfinger` ignoring `-p`/`--allow-private-address` and the
    `webfinger.allowPrivateAddress` configuration setting, preventing lookups
    against local development servers even with an explicit opt-in.  Private
    addresses remain blocked by default.  [[#1274], [#1276]]
