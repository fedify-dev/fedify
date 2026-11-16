 -  Limited WebFinger lookups used by object resolution to 10 seconds each,
    and actor handle resolution to one 10-second deadline across alias checks.
    Actor handle resolution now checks at most 100 subject/alias candidates and
    skips duplicates.
    [[GHSA-9pmv-w936-hj3f]]

[GHSA-9pmv-w936-hj3f]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-9pmv-w936-hj3f
