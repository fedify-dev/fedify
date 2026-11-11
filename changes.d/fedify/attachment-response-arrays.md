---
links:
  '#1421': https://github.com/fedify-dev/fedify/issues/1421
  '#1422': https://github.com/fedify-dev/fedify/pull/1422
---
 -  Fixed singleton `attachment` values being serialized as objects in actor,
    object, and collection responses, which caused Mastodon to ignore a single
    profile field.  Served responses and newly generated activity deliveries
    now preserve attachment arrays when the JSON-LD context permits it.
    Documents containing existing proofs or Linked Data signatures are left
    unchanged by the compatibility rewrite.  New normalized deliveries are
    signed over the same JSON used for queueing and transport.
    [[#1421], [#1422], [mastodon/mastodon#41640]]

[mastodon/mastodon#41640]: https://github.com/mastodon/mastodon/issues/41640
