---
links:
  '#1041': https://github.com/fedify-dev/fedify/pull/1041
  '#1045': https://github.com/fedify-dev/fedify/issues/1045
  '#1073': https://github.com/fedify-dev/fedify/pull/1073
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Changed `Context.sendActivity()` so that an activity containing
    [FEP-ef61] portable objects gets at most one Object Integrity Proof.
    Previously Fedify signed every outgoing activity once for each Ed25519
    key, which produced a proof set that Fedify's own inbox rejects in a
    compound portable document.  [[#288], [#1041], [#1045], [#1073]]

     -  An activity that already carries a proof is sent as is.
     -  With several Ed25519 keys, a portable activity is signed only by the
        key whose ID is a DID URL for the activity's DID.
     -  If no single key qualifies, or a non-portable activity that embeds
        portable objects has several Ed25519 keys, `sendActivity()` rejects
        with a `TypeError` before anything is delivered or queued.  Pass
        explicit sender keys with exactly one Ed25519 key, or sign the
        activity with `signObject()` beforehand.
     -  An activity with portable objects in which any map carries a proof
        set is rejected the same way.
     -  Activities without portable objects are signed as before.

[FEP-ef61]: https://w3id.org/fep/ef61
