 -  Added the `activityOriginMismatch` reason to rejected `InboxAuthentication`
    decisions in `onRequestFinished` reports.  Inbox deliveries rejected
    because the activity's ID does not have the same origin as its actors now
    report this reason, along with the activity ID and actor IDs, instead of
    `verificationFailed`.  The `activitypub.verification.failure_reason` span
    attribute uses the same value.  \[[GHSA-4qhx-hhwf-8685]]

[GHSA-4qhx-hhwf-8685]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-4qhx-hhwf-8685
