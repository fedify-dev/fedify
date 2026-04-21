---
description: >-
  How to migrate an existing federated service to Fedify from another
  JavaScript ActivityPub library — activitypub-express, @activity-kit,
  hand-rolled Express code, and activitystrea.ms.
---

Migrating from other libraries
==============================

If you already run a federated service on another JavaScript ActivityPub
library, this guide helps you move it to Fedify without losing your existing
followers.  The hard part of any such migration is not rewriting the
handlers — it is preserving the bits of state that remote servers have cached
about you.  A migration survives silently only when three things stay stable
across the switch:

 -  The actor IRIs that remote servers already follow (e.g.
    `https://example.com/u/alice`).
 -  The public keys those remote servers have cached alongside each actor.
 -  The HTTP Signature format on outbound deliveries (Fedify defaults to
    draft-cavage for backward compatibility, which matches every library in
    this guide).

Pick the section that matches your stack:

 -  [From `activitypub-express` (apex)](#apex) —
    the Express middleware backed by MongoDB.
 -  [From `@activity-kit/*` (ActivityKit)](#activity-kit) —
    the TypeScript-first, spec-oriented framework on the `@activity-kit`
    npm scope.
 -  [From hand-rolled Express code](#hand-rolled) —
    custom Express apps that sign outbound requests with the `node:crypto`
    module, typically descended from Darius Kazemi's `express-activitypub`
    reference.
 -  [From `activitystrea.ms`](#activity-streams) —
    a vocabulary-only migration where federation is handled elsewhere.

Each section follows the same shape: *When to migrate*, *Mental-model
mapping*, *Code migration*, *Data migration*, *Common pitfalls*, and a small
worked example.  Read the one that matches and skip the rest.


From `activitypub-express` (apex) {#apex}
-----------------------------------------

*To be written.*


From `@activity-kit/*` (ActivityKit) {#activity-kit}
----------------------------------------------------

*To be written.*


From hand-rolled Express code {#hand-rolled}
--------------------------------------------

*To be written.*


From `activitystrea.ms` {#activity-streams}
-------------------------------------------

*To be written.*
