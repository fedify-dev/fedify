 -  Fixed a remotely triggerable denial-of-service vulnerability where the
    outbound delivery circuit breaker, when configured with a custom `failure`
    policy without an explicit `stateTtl`, stored per-host state in the
    configured key–value store without any expiry.  A remote attacker could
    accumulate unbounded permanent records—one per distinct inbox
    `host:port`—by advertising inbox URLs that fail delivery, gradually
    exhausting storage.  Custom failure policies now derive a default
    `stateTtl` of `recoveryDelay` plus `heldActivityTtl` (7 days 30 minutes
    with the default values), and the automatic upgrade sweep on CAS-backed
    stores now stamps a TTL on circuit state that earlier 2.3 releases wrote
    without one, including state written by custom policies on 2.3.2–2.3.4.
    Set `stateTtl` explicitly if your custom policy needs its failure history
    retained for a different length of time.  [[CVE-2026-69132]]

[CVE-2026-69132]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-fx98-wc5v-jrg5
