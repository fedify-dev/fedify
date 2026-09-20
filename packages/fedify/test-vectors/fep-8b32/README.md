<!-- deno-fmt-ignore-file -->

Map-local create(note) vector
=============================

*map-local-create-note.json* is Fedify's deterministic baseline for the initial
map-local compound-proof profile.  It contains one portable `Create` signed by
DID A and one embedded portable `Note` signed by DID B.  Both maps carry an
explicit local `@context` and one direct literal `proof` property.

*map-local-context-conflict.json* uses the same deterministic test keys but
gives the parent a default language that the child's local context does not
reset.  Both map-local proofs remain cryptographically valid.  However, the
child's `content` has no language when the exact child map is expanded alone
and inherits `en` when expanded in the parent.  This records why a verifier
must distinguish proof verification over an immutable raw map from the
separate requirement that an embedded map be interpretable independently.

Both fixtures record the final secured compound document, the exact secured
inner map extracted from it, each current-map unsecured document and proof
configuration, the JCS canonical strings, the SHA-256 hashes, the combined
`eddsa-jcs-2022` input, the verification methods and test keys, proof values,
and expected outcomes.  JSON member order and source formatting are not
significant; the recorded JSON values and their JCS canonicalizations are.

The outer unsecured document retains the complete secured inner
representation.  Consequently, changing inner content invalidates both proofs,
while replacing the inner proof with another valid proof invalidates only the
original outer proof.  The vector does not define proof aliases, proof sets,
proof chains, remote proof references, or a profile marker.

This is a raw JSON cryptographic vector, not a claim that Fedify's typed object
producer can emit the same compound representation.  Typed `Create`
serialization currently compacts an embedded signed `Note` under the parent's
context and drops the child's explicit local `@context`, including the context
on its proof.  The producer regression test records that limitation.  Exact
producer support needs a representation carrier that retains the signed child
JSON instead of reconstructing it from the parent.

The private JWKs are deterministic test material and must not be used as real
credentials.  Regenerate both fixtures from the repository root with:

~~~~ bash
mise x -- deno run --allow-write packages/fedify/scripts/generate-map-local-vector.ts
~~~~
