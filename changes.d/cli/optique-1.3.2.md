---
links:
  '#1197': https://github.com/fedify-dev/fedify/pull/1197
---
 -  Updated Optique to 1.3.2.  This fixes several command-line parsing
    issues, so options with attached values such as `--timeout=30` are
    handled consistently, typo suggestions for mistyped options are more
    accurate, and errors for known options are no longer hidden by
    positional arguments before `--`.  [[#1197]]
