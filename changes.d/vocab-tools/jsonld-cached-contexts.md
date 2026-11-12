---
links:
  '#1394': https://github.com/fedify-dev/fedify/issues/1394
  '#1397': https://github.com/fedify-dev/fedify/pull/1397
---
 -  Fixed generated default encoders combining independent child documents
    with conflicting inherited JSON-LD contexts.  Child documents retain their
    original contexts and extension meanings, including in collections and
    inherited properties.  Generated parents gain property-scoped definitions
    in their `@context` arrays even when child and parent contexts match.
    Regenerate your vocabulary code to apply the fix.
    [[#1394], [#1397]]
