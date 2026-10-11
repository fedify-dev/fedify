 -  Fixed inboxes accepting signed activities whose IDs had a different origin
    from their actors.  Such deliveries now receive `401 Unauthorized` before
    they can supply trusted embedded objects or reserve the genuine activity's
    idempotency entry.  Queued and manually routed activities apply the same
    origin check.  [[GHSA-4qhx-hhwf-8685]]

[GHSA-4qhx-hhwf-8685]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-4qhx-hhwf-8685
