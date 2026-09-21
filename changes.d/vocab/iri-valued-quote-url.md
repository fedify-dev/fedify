---
links:
  '#1015': https://github.com/fedify-dev/fedify/issues/1015
---
 -  Updated the `fedify:url` decoder to read `@id` when `@value` is absent,
    allowing it to accept IRI-valued quote URL aliases (`_misskey_quote` or
    `quoteUri`). Also widened its `dataCheck()` to accept both forms.
    [[#1015] by Jang Hanarae]
