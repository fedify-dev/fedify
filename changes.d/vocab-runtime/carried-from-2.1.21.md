---
links:
  '#1002': https://github.com/fedify-dev/fedify/issues/1002
  '#1003': https://github.com/fedify-dev/fedify/pull/1003
  '#928': https://github.com/fedify-dev/fedify/pull/928
  '#982': https://github.com/fedify-dev/fedify/issues/982
---
 -  Added the [FEP-ef61] context to preloaded JSON-LD contexts.  The
    <https://w3id.org/fep/ef61> URL redirects to a Codeberg Pages host which
    suffers recurring outages; during one, JSON-LD expansion of any document
    referencing this URL fails before application handlers can run.
    [[#982], [#928]]
 -  Changed `miscellany` context to match public version 1.0.1,
    which fixes a bug with re-compacting Mastodon and similar content using
    `boolean` flags (`manuallyApprovesFollowers`, `sensitive`).
    [[#1002], [#1003] by Evan Prodromou\]

[FEP-ef61]: https://w3id.org/fep/ef61
