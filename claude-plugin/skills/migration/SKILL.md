---
name: migration
description: >-
  Help the user migrate Fedify code between versions. Use when the user
  needs to upgrade their Fedify version, fix breaking-change errors, or
  update deprecated API usage.
argument-hint: <from-version> [to-version]
---

Help the user migrate Fedify code from “$ARGUMENTS”.


Migration workflow
------------------

1.  Fetch *CHANGES.md* from the repo to identify breaking changes between
    the versions in question:
    `https://raw.githubusercontent.com/fedify-dev/fedify/main/CHANGES.md`
2.  List the breaking changes between those versions that affect the user's
    code.
3.  For each breaking change, show the old API, the new API, and a concrete
    before/after code snippet.
4.  Search the user's codebase for usages of deprecated symbols and suggest
    the replacement.
5.  Note any dependency changes (e.g., vocabulary moved to `@fedify/vocab`,
    runtime to `@fedify/vocab-runtime`).


Key migration hints
-------------------

 -  `@fedify/fedify/vocab` → `@fedify/vocab` (dedicated package)
 -  `@fedify/fedify/runtime` → `@fedify/vocab-runtime`
 -  In-tree *src/webfinger* → `@fedify/webfinger`
 -  *src/x/* exports removed in 2.0.0
