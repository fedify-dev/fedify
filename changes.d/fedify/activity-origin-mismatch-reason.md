---
links:
  '#1318': https://github.com/fedify-dev/fedify/issues/1318
  '#1328': https://github.com/fedify-dev/fedify/pull/1328
---
 -  Added the `activity-origin-mismatch` reason to rejected
    `InboxAuthentication` decisions in `onRequestFinished` reports.  Inbox
    deliveries rejected because the activity's ID does not have the same origin
    as its actors now report this reason, along with the activity ID and actor
    IDs, instead of `verificationFailed`.  The
    `activitypub.verification.failure_reason` span attribute uses the same
    value.  \[[GHSA-4qhx-hhwf-8685], [#1318], [#1328]]

[GHSA-4qhx-hhwf-8685]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-4qhx-hhwf-8685
