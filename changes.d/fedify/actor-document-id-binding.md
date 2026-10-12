 -  Fixed key ownership checks accepting another actor's document when
    resolving an actor ID.  When an actor ID redirected to, or directly
    served, the document of a different actor, keys listed by that other
    actor were attributed to the requested one, so an attacker whose actor
    document was reached through a victim's actor ID could sign activities
    that passed authentication as the victim's.  This affected HTTP
    Signatures, Linked Data Signatures, and Object Integrity Proofs.  Fetched
    actor documents are now accepted only when their `id` is exactly the
    requested actor ID.  [[GHSA-8863-8468-7hq7]]
 -  As a consequence of the above fix, an actor whose ID redirects to
    a document with a different `id`, even on the same origin and for the
    same account, can no longer have its keys confirmed through that
    redirect.  Servers that normalize actor URLs should use the canonical
    actor ID, which responds without redirecting, as the `owner` or
    `controller` of their keys and as the `actor` of their activities.
    [[GHSA-8863-8468-7hq7]]
 -  The built-in `KvStore`-backed key cache now uses a new generation, so
    keys cached under the weaker check are fetched and verified again after
    upgrading.  Applications with a custom `KeyCache` implementation should
    clear it once when upgrading.  [[GHSA-8863-8468-7hq7]]

[GHSA-8863-8468-7hq7]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-8863-8468-7hq7
