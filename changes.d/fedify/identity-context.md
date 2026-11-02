---
links:
  '#664': https://github.com/fedify-dev/fedify/issues/664
---
 -  Fixed Linked Data Signatures being emitted with a JSON-LD context that no
    longer resolves.  The attached `signature` object now uses
    `https://w3id.org/security/v1` instead of
    `https://w3id.org/identity/v1`, which redirects to an unreachable host.
    Documents signed through `signJsonLd()` or `attachSignature()` whose
    context does not define `signature` now also get a minimal inline
    definition of that term, so the signed document remains valid JSON-LD.
    Documents that already carry a `proof` are left unchanged, since a new
    context definition would invalidate the proof.  Activities queued for
    fanout before the upgrade also keep their original proof-covered JSON when
    replayed.  Incoming signatures that still use `identity/v1` continue to
    verify.  [[#664]]
