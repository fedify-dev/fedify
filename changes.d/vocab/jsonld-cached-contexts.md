---
links:
  '#1394': https://github.com/fedify-dev/fedify/issues/1394
  '#1397': https://github.com/fedify-dev/fedify/pull/1397
---
 -  Fixed invalid JSON-LD when a collection page embeds a parsed item whose
    context redefines a protected parent term, such as `proof`.  Default
    serialization now isolates independent child contexts while preserving
    their cached documents and extension meanings.  The parent's `@context`
    array gains property-scoped definitions, including for generated children
    with matching contexts; context-aware consumers need JSON-LD 1.1 support.
    Resolving the parent context uses `contextLoader`; URL references alongside
    isolated children are represented as objects with `id` and their own
    context.
    [[#1394], [#1397]]
