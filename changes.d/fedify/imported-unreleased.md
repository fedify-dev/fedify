---
links:
  '#206': https://github.com/fedify-dev/fedify/issues/206
  '#754': https://github.com/fedify-dev/fedify/issues/754
  '#797': https://github.com/fedify-dev/fedify/issues/797
  '#798': https://github.com/fedify-dev/fedify/issues/798
  '#799': https://github.com/fedify-dev/fedify/issues/799
  '#803': https://github.com/fedify-dev/fedify/pull/803
  '#806': https://github.com/fedify-dev/fedify/pull/806
  '#812': https://github.com/fedify-dev/fedify/pull/812
  '#823': https://github.com/fedify-dev/fedify/issues/823
  '#923': https://github.com/fedify-dev/fedify/pull/923
  '#925': https://github.com/fedify-dev/fedify/pull/925
  '#927': https://github.com/fedify-dev/fedify/pull/927
  '#930': https://github.com/fedify-dev/fedify/issues/930
  '#934': https://github.com/fedify-dev/fedify/pull/934
  '#968': https://github.com/fedify-dev/fedify/pull/968
---
 -  Fixed `verifyProof()` so Ed25519 JCS proofs authenticate every received
    proof option except `proofValue`, including `expires`, `domain`,
    `challenge`, `nonce`, and extension options.  It now rejects expired or
    malformed proof options, and callers can provide expected `domain` and
    `challenge` values through `VerifyProofOptions` to prevent cross-domain or
    replay use.  [[#968]]

 -  Added support for the [ActivityPub Media Upload extension] so that servers
    can accept client-to-server media uploads:
    [[#754], [#927]]

     -  `Federation` and `FederationBuilder` gained a `setMediaUploader()`
        method (through the new `MediaUploaderSetters` interface) that registers
        a `multipart/form-data` upload endpoint.  Its callback finalizes the
        uploaded `file` alongside the posted `object` shell and returns either
        the created object (`201 Created`) or the `URL` at which it will become
        available once processing finishes (`202 Accepted`).
     -  `Context` gained a `getMediaUploaderUri()` method for building the
        endpoint URI, which actor dispatchers advertise under the new
        `Endpoints.uploadMedia` property.
     -  A new metric endpoint category, `media_upload`, classifies these
        requests in the `fedify.endpoint` attribute.
     -  Fedify logs a runtime warning when a callback's returned URI does not
        point at a registered object dispatcher route, when a registered
        media uploader is not advertised under `endpoints.uploadMedia`, or
        when a media uploader is registered without an `authorize()` hook (so
        the endpoint would accept uploads from anyone).

 -  Added a custom background task API that generalizes Fedify's
    enqueue-and-process-later pattern to arbitrary application-defined jobs:

     -  `Federation` and `FederationBuilder` gained a `defineTask()` method
        through the new `TaskRegistry` interface, which `Federatable` now
        extends.
     -  `Context` gained `enqueueTask()` and `enqueueTaskMany()` methods,
        with `delay` and `orderingKey` options
        (new `TaskEnqueueOptions` interface).
     -  Every task requires a [Standard Schema]
        (`schema` option) from which the payload type is inferred; payloads
        are validated at enqueue time (fail fast) and again at dequeue time
        (protection against schema drift across deployments).
     -  Payloads are serialized by Fedify with devalue, so `Date`, `Map`,
        `Set`, `URL`, `bigint`, circular references, and Activity Vocabulary
        objects round-trip faithfully across every message queue backend.
     -  Failed handlers are retried with exponential backoff by default;
        tasks support per-task `retryPolicy` and `onError` options, the new
        `FederationOptions.taskRetryPolicy` sets the federation-wide default,
        and queues with `nativeRetrial` delegate retries to the backend.
     -  Tasks can be isolated from activity delivery through the new
        `FederationQueueOptions.task` slot or a per-task `queue` option;
        without them, tasks fall back to the outbox queue unless the new
        `FederationOptions.taskQueueResolution` option is set to `"strict"`.
        `Federation.startQueue()` now accepts `queue: "task"` to run
        a task-only worker.
     -  Tasks can request at-most-once enqueue with a `deduplicationKey`
        (new `TaskEnqueueOptions.deduplicationKey`).  A queue declaring the new
        `MessageQueue.nativeDeduplication` capability owns the check and
        receives the key through the new
        `MessageQueueEnqueueOptions.deduplicationKey`; otherwise Fedify
        performs a best-effort key–value guard through the optional
        `KvStore.cas` primitive, under a new `taskDeduplication` key prefix.
        The marker TTL and the no-`cas` fallback are tunable with the new
        `FederationOptions.taskDeduplicationTtl` and
        `FederationOptions.taskDeduplicationFallback` options.
        [[#206], [#797], [#798], [#799], [#803], [#806], [#812], [#923] by ChanHaeng Lee\]

 -  Added `MessageQueue.atomicEnqueueMany` for queues that implement
    `enqueueMany()` with separate sends.  Fedify still uses their batch path
    normally, but rejects a multi-message batch governed by one
    `deduplicationKey` before a partial send can undermine deduplication.
    [[#930], [#934]]

 -  Fixed CommonJS distribution files that use Temporal so they no longer
    require `@js-temporal/polyfill` at runtime.  The CommonJS build now
    bundles `temporal-polyfill`, while type declarations rely on the standard
    `esnext.temporal` lib reference.
    [[#823], [#925]]

[ActivityPub Media Upload extension]: https://www.w3.org/wiki/SocialCG/ActivityPub/MediaUpload
[Standard Schema]: https://standardschema.dev/
