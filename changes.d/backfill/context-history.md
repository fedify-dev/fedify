---
links:
  '#1250': https://github.com/fedify-dev/fedify/issues/1250
  '#1396': https://github.com/fedify-dev/fedify/pull/1396
---
 -  Added `contextSource: "history-first"` to backfill options to read the
    seed's first `contextHistory` collection, falling back to `context` when
    history is absent or unavailable. A resolved empty history does not trigger
    fallback, and later history references are not tried. Existing source
    selection remains the default. Referenced histories use the configured
    loader, including portable `ap://`, `ap+ef61://`, and FEP-ef61-compatible
    HTTPS identifiers. [[#1250], [#1396] by Jiwon Kwon]
