 -  Fixed the inbox accepting activities from any actor at all.  Fedify
    verified the signature on an incoming delivery, but took the signing key's
    own word for whom it belonged to: the `owner` of a `CryptographicKey` and
    the `controller` of a `Multikey` were believed as served, even though the
    key document and the claim inside it come from the same host.  Anyone with
    an ordinary HTTP server could therefore have an activity accepted as
    coming from any actor in the world, whether or not that actor existed.
    All three inbound authentication paths were affected—HTTP Signatures,
    Linked Data Signatures, and Object Integrity Proofs—and the latter two
    require no HTTP signature on the request at all.  A key's claimed owner is
    now resolved and has to link back to the key before the key is usable, and
    a key that names no owner of its own is attributed to the actor whose
    document carried it.  \[[GHSA-q9f8-5hc7-898f]]
 -  Fixed `getKeyOwner()`, and therefore `Context.getSignedKeyOwner()`,
    accepting a key document dressed up as another origin's actor document.
    A host that served a key could describe itself as any actor and list the
    key as that actor's own, which let an attacker pass an authorized fetch
    under a borrowed identity and read whatever access control had reserved
    for it.  Only the origin that serves an actor id can now speak for it.
    [[GHSA-q9f8-5hc7-898f]]
 -  Public keys cached before this release are no longer read back, since the
    owner recorded in them was never verified.  Applications using the
    built-in key cache need no action; those passing a custom `KeyCache`
    implementation to `verifyRequest()`, `verifyJsonLd()`, or `verifyObject()`
    should discard its contents once on upgrade.  \[[GHSA-q9f8-5hc7-898f]]
 -  Fixed an SSRF vulnerability in outbound activity delivery that allowed inbox
    URLs and redirects to target private network addresses.  Delivery now checks
    each destination unless `allowPrivateAddress` is explicitly enabled for
    local testing.  \[[GHSA-f59r-8gcj-68f2]]
 -  Fixed unbounded reads of authenticated documents, NodeInfo responses, and
    inbox bodies that could exhaust memory.  JSON bodies are now limited to 16
    MiB.  Oversized inbox requests receive `413 Content Too Large`.
    [[GHSA-mc44-6cfg-2v6w]]

[GHSA-q9f8-5hc7-898f]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-q9f8-5hc7-898f
[GHSA-f59r-8gcj-68f2]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-f59r-8gcj-68f2
[GHSA-mc44-6cfg-2v6w]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-mc44-6cfg-2v6w
