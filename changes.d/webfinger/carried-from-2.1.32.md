 -  Limited WebFinger lookups to 10 seconds across DNS resolution, redirects,
    and response reading.  A caller's abort signal can end a lookup sooner.
    This prevents slow endpoints from occupying lookup workers indefinitely.
    [[GHSA-9pmv-w936-hj3f]]

[GHSA-9pmv-w936-hj3f]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-9pmv-w936-hj3f
