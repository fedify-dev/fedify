---
links:
  '#1156': https://github.com/fedify-dev/fedify/issues/1156
  '#1199': https://github.com/fedify-dev/fedify/pull/1199
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Added support for [FEP-ef61] portable objects to `fedify lookup`.  It now
    looks up portable objects by their `ap:` and `ap+ef61:` IDs, compatible
    identifiers, and the WebFinger handles of portable actors, and verifies
    their Object Integrity Proofs.  Previously,
    it failed to look up portable IDs, and refused portable objects found
    through compatible identifiers as cross-origin objects.  The same applies
    to the collections that `-t`/`--traverse` traverses and the objects that
    `--recurse` follows.  When no gateway returns an acceptable object, the
    command tells why, e.g., that the object's proof is invalid.
    [[#288], [#1156], [#1199]]

 -  Added the `--gateway` option to `fedify lookup`, `fedify inbox`, and
    `fedify webfinger`, which specifies the FEP-ef61 gateways to look up
    portable objects from, e.g., for portable IDs without `@gateway` location
    hints.  [[#288], [#1156], [#1199]]

 -  Changed `fedify inbox -f`/`--follow` to follow FEP-ef61 portable actors,
    and changed the `-a`/`--accept-follow` option of `fedify inbox` and the
    `-a`/`--accept-follow` and `-r`/`--reject-follow` options of `fedify relay`
    to accept portable IDs and compatible identifiers, which match the actor
    regardless of `@gateway` location hints and the gateway of a compatible
    identifier.  [[#288], [#1156], [#1199]]

 -  Changed `fedify webfinger` to accept FEP-ef61 portable actor IDs.  As such
    an ID does not tell which server to ask, the command looks up the actor and
    then its WebFinger address, which consists of its `preferredUsername` and
    the host of its first gateway, and reports whether the response links back
    to the actor.  [[#288], [#1156], [#1199]]

 -  Fixed `fedify lookup --recurse` reporting a timeout or another network
    failure of the first object or of a linked object as a possibly private
    object, suggesting the `-a`/`--authorized-fetch` option.  It now reports
    the actual cause, e.g., “Request timed out after 10 seconds,” like the
    other modes of `fedify lookup` do.  [[#1156], [#1199]]

 -  Fixed the `-p`/`--allow-private-address` option of `fedify webfinger`
    being ignored.  [[#1156], [#1199]]

[FEP-ef61]: https://w3id.org/fep/ef61
