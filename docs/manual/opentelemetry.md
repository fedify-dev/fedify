---
description: >-
  OpenTelemetry is a set of APIs, libraries, agents, and instrumentation to
  provide observability to your applications.  Fedify supports OpenTelemetry
  for tracing and metrics.  This document explains how to use OpenTelemetry
  with Fedify.
---

OpenTelemetry
=============

*This API is available since Fedify 1.3.0.*

[OpenTelemetry] is a standardized set of APIs, libraries, agents, and
instrumentation to provide observability to your applications.  Fedify supports
OpenTelemetry for tracing and metrics.  This document explains how to use
OpenTelemetry with Fedify.

[OpenTelemetry]: https://opentelemetry.io/


Setting up OpenTelemetry
------------------------

> [!TIP]
> If you are using Deno 2.2 or later, you can use Deno's built-in OpenTelemetry
> support.  See the [*Using Deno's built-in OpenTelemetry support*
> section](#using-deno-s-built-in-opentelemetry-support) for more details.

To trace your Fedify application and collect metrics with OpenTelemetry, you
need to set up the OpenTelemetry SDK.  First of all, you need to install the
OpenTelemetry SDK and the exporter you want to use.  For example, if you want
to use the trace exporter for OTLP (http/protobuf), you should install the
following packages:

::: code-group

~~~~ sh [Deno]
deno add npm:@opentelemetry/sdk-node npm:@opentelemetry/exporter-trace-otlp-proto
~~~~

~~~~ sh [Node.js]
npm add @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-proto
~~~~

~~~~ sh [Bun]
bun add @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-proto
~~~~

:::

Then you can set up the OpenTelemetry SDK in your Fedify application.  Here is
an example code snippet to set up the OpenTelemetry SDK with the OTLP trace
exporter:

~~~~ typescript twoslash
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";

const sdk = new NodeSDK({
  serviceName: "my-fedify-app",
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4317",
    headers: { "x-some-header": "some-value" }
  }),
});

sdk.start();
~~~~

> [!CAUTION]
> The above code which sets up the OpenTelemetry SDK needs to be executed before
> the Fedify server starts.  Otherwise, the tracing may not work as expected.


Using Deno's built-in OpenTelemetry support
-------------------------------------------

Since Deno 2.2, Deno has [built-in support for OpenTelemetry][deno-otel].
This means you can use OpenTelemetry with your Fedify application on Deno
without manually setting up the OpenTelemetry SDK.

To enable the OpenTelemetry integration in Deno, you need to:

1.  Run your Deno script with the `--unstable-otel` flag
2.  Set the environment variable `OTEL_DENO=true`

For example:

~~~~ sh
OTEL_DENO=true deno run --unstable-otel your_fedify_app.ts
~~~~

This will automatically collect and export runtime observability data to
an OpenTelemetry endpoint at `localhost:4318` using Protobuf over HTTP
(http/protobuf).

You can customize the endpoint and protocol using environment variables like
`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_PROTOCOL`.
For authentication, you can use the `OTEL_EXPORTER_OTLP_HEADERS` environment
variable.

[deno-otel]: https://docs.deno.com/runtime/fundamentals/open_telemetry/


Explicit [`TracerProvider`] configuration
-----------------------------------------

The `createFederation()` function accepts the
[`tracerProvider`](./federation.md#tracerprovider) option to explicitly
configure the [`TracerProvider`] for the OpenTelemetry SDK.  Note that if it's
omitted, Fedify will use the global default [`TracerProvider`] provided by
the OpenTelemetry SDK.

For example, if you want to use [Sentry] as the trace exporter, you can set up
the Sentry SDK and pass the [`TracerProvider`] provided by the Sentry SDK to the
`createFederation()` function:

~~~~ typescript twoslash
// @noErrors: 2339
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation } from "@fedify/fedify";
import { getClient } from "@sentry/node";

const federation = createFederation<void>({
// ---cut-start---
  kv: null as unknown as KvStore,
// ---cut-end---
  // Omitted for brevity; see the related section for details.
  tracerProvider: getClient()?.traceProvider,
});
~~~~

> [!CAUTION]
> The Sentry SDK's OpenTelemetry integration is available since [@sentry/node]
> 8.0.0, and it's not available yet in [@sentry/deno] or [@sentry/bun] as of
> November 2024.
>
> For more information about the Sentry SDK's OpenTelemetry integration, please
> refer to the [*OpenTelemetry Support* section] in the Sentry SDK docs.

[`TracerProvider`]: https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_api._opentelemetry_api.TracerProvider.html
[Sentry]: https://sentry.io/
[@sentry/node]: https://npmjs.com/package/@sentry/node
[@sentry/deno]: https://npmjs.com/package/@sentry/deno
[@sentry/bun]: https://npmjs.com/package/@sentry/bun
[*OpenTelemetry Support* section]: https://docs.sentry.io/platforms/javascript/guides/node/opentelemetry/


Explicit [`MeterProvider`] configuration
----------------------------------------

*This API is available since Fedify 2.3.0.*

The `createFederation()` function also accepts the
[`meterProvider`](./federation.md#meterprovider) option to explicitly configure
the [`MeterProvider`] for OpenTelemetry metrics.  If it is omitted, Fedify uses
the global default [`MeterProvider`] provided by the OpenTelemetry SDK.

~~~~ typescript twoslash
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation } from "@fedify/fedify";
import { metrics } from "@opentelemetry/api";

const federation = createFederation<void>({
// ---cut-start---
  kv: null as unknown as KvStore,
// ---cut-end---
  // Omitted for brevity; see the related section for details.
  meterProvider: metrics.getMeterProvider(),
});
~~~~

> [!NOTE]
> The document and context loader metrics
> (`activitypub.document.fetch[.duration]` and
> `activitypub.document.cache`) are opt-in inside Fedify: they are
> emitted only when `meterProvider` is explicitly configured on
> `createFederation()`.  Omitting it preserves strict reference identity
> for `Context.documentLoader`, `Context.contextLoader`, and the
> authenticated document loader (`ctx.documentLoader === userLoader`),
> so existing test code that asserts identity on a user-supplied
> factory's output continues to work.  The other metrics (delivery,
> inbox, outbox, fanout, queue, HTTP server, signature verification,
> signature key fetch, public key lookup, collection request, and
> `lookupObject` actor classification) follow the standard “fall back to the
> global [`MeterProvider`]” behavior described above.  Calling `lookupObject()`
> directly from `@fedify/vocab` (without going through a `Context`) still
> requires an explicit `LookupObjectOptions.meterProvider` to emit
> `activitypub.object.lookup`; `Context.lookupObject()` threads the
> Federation's meter provider through automatically.

[`MeterProvider`]: https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_api._opentelemetry_api.MeterProvider.html


Instrumented spans
------------------

Fedify automatically instruments the following operations with OpenTelemetry
spans:

| Span name                                           | [Span kind] | Description                                   |
| --------------------------------------------------- | ----------- | --------------------------------------------- |
| `{method} {template}`                               | Server      | Serves the incoming HTTP request.             |
| `activitypub.dispatch_actor`                        | Server      | Dispatches the ActivityPub actor.             |
| `activitypub.dispatch_actor_key_pairs`              | Server      | Dispatches the ActivityPub actor key pairs.   |
| `activitypub.dispatch_collection {collection}`      | Server      | Dispatches the ActivityPub collection.        |
| `activitypub.dispatch_collection_page {collection}` | Server      | Dispatches the ActivityPub collection page.   |
| `activitypub.dispatch_inbox_listener {type}`        | Internal    | Dispatches the ActivityPub inbox listener.    |
| `activitypub.dispatch_object`                       | Server      | Dispatches the Activity Streams object.       |
| `activitypub.fanout`                                | Consumer    | Dequeues the ActivityPub activity to fan out. |
| `activitypub.fanout`                                | Producer    | Enqueues the ActivityPub activity to fan out. |
| `activitypub.fetch_key`                             | Client      | Fetches the public keys for the actor.        |
| `activitypub.get_actor_handle`                      | Client      | Resolves the actor handle.                    |
| `activitypub.inbox`                                 | Consumer    | Dequeues the ActivityPub activity to receive. |
| `activitypub.inbox`                                 | Internal    | Manually routes the ActivityPub activity.     |
| `activitypub.inbox`                                 | Producer    | Enqueues the ActivityPub activity to receive. |
| `activitypub.inbox`                                 | Server      | Receives the ActivityPub activity.            |
| `activitypub.lookup_object`                         | Client      | Looks up the Activity Streams object.         |
| `activitypub.outbox`                                | Client      | Sends the ActivityPub activity.               |
| `activitypub.outbox`                                | Consumer    | Dequeues the ActivityPub activity to send.    |
| `activitypub.outbox`                                | Producer    | Enqueues the ActivityPub activity to send.    |
| `activitypub.parse_object`                          | Internal    | Parses the Activity Streams object.           |
| `activitypub.fetch_document`                        | Client      | Fetches a remote JSON-LD document.            |
| `activitypub.send_activity`                         | Client      | Sends the ActivityPub activity.               |
| `activitypub.verify_key_ownership`                  | Internal    | Verifies actor ownership of a key.            |
| `http_signatures.sign`                              | Internal    | Signs the HTTP request.                       |
| `http_signatures.verify`                            | Internal    | Verifies the HTTP request signature.          |
| `ld_signatures.sign`                                | Internal    | Makes the Linked Data signature.              |
| `ld_signatures.verify`                              | Internal    | Verifies the Linked Data signature.           |
| `object_integrity_proofs.sign`                      | Internal    | Makes the object integrity proof.             |
| `object_integrity_proofs.verify`                    | Internal    | Verifies the object integrity proof.          |
| `webfinger.handle`                                  | Server      | Handles the WebFinger request.                |
| `webfinger.lookup`                                  | Client      | Looks up the WebFinger resource.              |

More operations will be instrumented in the future releases.

[Span kind]: https://opentelemetry.io/docs/specs/otel/trace/api/#spankind


Span events
-----------

In addition to spans, Fedify also records [span events] to capture rich,
structured data about key operations.  Span events allow recording complex data
that wouldn't fit in span attributes (which are limited to primitive values).

The following span events are recorded:

| Event name                                 | Recorded on span            | Description                                                                      |
| ------------------------------------------ | --------------------------- | -------------------------------------------------------------------------------- |
| `activitypub.activity.received`            | `activitypub.inbox`         | Records full activity JSON and verification status when an activity is received. |
| `activitypub.activity.sent`                | `activitypub.send_activity` | Records delivery details when an activity is sent.                               |
| `activitypub.circuit_breaker.held`         | `activitypub.outbox`        | Records queued outbox deliveries held by an open circuit.                        |
| `activitypub.circuit_breaker.state_change` | `activitypub.outbox`        | Records queued outbox circuit breaker state changes.                             |
| `activitypub.delivery.failed`              | `activitypub.outbox`        | Records queued outbox delivery failure details before retry or abandonment.      |
| `activitypub.object.fetched`               | `activitypub.lookup_object` | Records full object JSON when successfully fetched.                              |

[span events]: https://opentelemetry.io/docs/concepts/signals/traces/#span-events

### Event attributes

Each span event includes attributes with detailed information:

**`activitypub.activity.received` event attributes:**

 -  `activitypub.activity.json`: The complete activity JSON
 -  `activitypub.activity.verified`: Whether the activity was verified
    (`true`/`false`)
 -  `ld_signatures.verified`: Whether Linked Data Signatures were verified
    (`true`/`false`)
 -  `http_signatures.verified`: Whether HTTP Signatures were verified
    (`true`/`false`)
 -  `http_signatures.key_id`: The key ID used for HTTP signature verification
 -  `http_signatures.failure_reason` (optional): Why HTTP signature
    verification failed (`noSignature`, `invalidSignature`, or
    `keyFetchError`)
 -  `http_signatures.key_fetch_status` (optional): The HTTP status code when
    fetching the signing key failed with an HTTP response
 -  `http_signatures.key_fetch_error` (optional): The error type when fetching
    the signing key failed without an HTTP response

**`activitypub.activity.sent` event attributes:**

 -  `activitypub.inbox.url`: The inbox URL where the activity was delivered
 -  `activitypub.activity.id`: The activity ID
 -  `activitypub.activity.type` (optional): The qualified activity type URI
 -  `activitypub.actor.id` (optional): The sender actor ID

The `activitypub.activity.sent` event records delivery metadata and lightweight
activity identifiers only.  It does not include the full
`activitypub.activity.json` payload; if you need the full outbound activity for
auditing, store it in your application before delivery and correlate it with
`activitypub.activity.id`.

**`activitypub.delivery.failed` event attributes:**

 -  `activitypub.remote.host`: The remote inbox host, including any
    non-default port
 -  `activitypub.delivery.attempt`: The zero-based queue delivery attempt
 -  `activitypub.delivery.permanent_failure`: Whether Fedify will abandon the
    delivery instead of retrying
 -  `http.response.status_code` (optional): The HTTP response status code
    returned by the remote inbox

**`activitypub.circuit_breaker.state_change` event attributes:**

 -  `activitypub.remote.host`: The remote inbox host, including any
    non-default port
 -  `activitypub.circuit_breaker.previous_state`: The previous circuit state
    (`closed`, `open`, or `half_open`)
 -  `activitypub.circuit_breaker.state`: The new circuit state (`closed`,
    `open`, or `half_open`)

**`activitypub.circuit_breaker.held` event attributes:**

 -  `activitypub.remote.host`: The remote inbox host, including any
    non-default port
 -  `activitypub.circuit_breaker.state`: The circuit state (`open`)

**`activitypub.object.fetched` event attributes:**

 -  `activitypub.object.type`: The type URI of the fetched object
 -  `activitypub.object.json`: The complete object JSON


Instrumented metrics
--------------------

*This API is available since Fedify 2.3.0.*

Fedify records the following OpenTelemetry metrics:

| Metric name                                   | Instrument    | Unit          | Description                                                                                     |
| --------------------------------------------- | ------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| `activitypub.delivery.sent`                   | Counter       | `{attempt}`   | Counts outgoing ActivityPub delivery attempts.                                                  |
| `activitypub.delivery.permanent_failure`      | Counter       | `{failure}`   | Counts outgoing deliveries abandoned as permanent failures.                                     |
| `activitypub.delivery.duration`               | Histogram     | `ms`          | Measures outgoing ActivityPub delivery attempt duration.                                        |
| `activitypub.circuit_breaker.state_change`    | Counter       | `{change}`    | Counts queued outbox circuit breaker state changes per remote host.                             |
| `activitypub.inbox.activity`                  | Counter       | `{activity}`  | Classifies inbound activities by lifecycle outcome.                                             |
| `activitypub.inbox.processing_duration`       | Histogram     | `ms`          | Measures inbox listener processing duration.                                                    |
| `activitypub.outbox.activity`                 | Counter       | `{activity}`  | Classifies outbound activities by lifecycle outcome.                                            |
| `activitypub.fanout.recipients`               | Histogram     | `{recipient}` | Records the recipient inbox count produced by a single fanout enqueue.                          |
| `activitypub.collection.request`              | Counter       | `{request}`   | Counts ActivityPub collection and collection-page requests.                                     |
| `activitypub.collection.dispatch.duration`    | Histogram     | `ms`          | Measures collection dispatcher callback duration.                                               |
| `activitypub.collection.page.items`           | Histogram     | `{item}`      | Records item counts materialized for collection and collection-page responses.                  |
| `activitypub.collection.total_items`          | Histogram     | `{item}`      | Records total item counts reported by collection counters.                                      |
| `activitypub.signature.verification_failure`  | Counter       | `{failure}`   | Counts failed signature verification for inbox requests.                                        |
| `activitypub.signature.verification.duration` | Histogram     | `ms`          | Measures signature verification duration across HTTP, Linked Data, and Object Integrity Proofs. |
| `activitypub.signature.key_fetch.duration`    | Histogram     | `ms`          | Measures public key lookup duration during signature verification.                              |
| `activitypub.key.lookup`                      | Counter       | `{lookup}`    | Counts public key lookups performed by `fetchKey()` / `fetchKeyDetailed()`.                     |
| `activitypub.key.lookup.duration`             | Histogram     | `ms`          | Measures public key lookup duration, including cache hits and remote fetches.                   |
| `activitypub.document.fetch`                  | Counter       | `{fetch}`     | Counts remote JSON-LD document loader invocations made by Fedify-wrapped loaders.               |
| `activitypub.document.fetch.duration`         | Histogram     | `ms`          | Measures remote JSON-LD document loader invocation duration.                                    |
| `activitypub.document.cache`                  | Counter       | `{lookup}`    | Counts KV-backed document loader cache lookups, classified as `hit` or `miss`.                  |
| `activitypub.object.lookup`                   | Counter       | `{lookup}`    | Counts `lookupObject()` calls, classified by whether the resolved value is an Actor.            |
| `activitypub.actor.discovery`                 | Counter       | `{discovery}` | Counts `getActorHandle()` actor handle discovery attempts.                                      |
| `activitypub.actor.discovery.duration`        | Histogram     | `ms`          | Measures `getActorHandle()` discovery duration.                                                 |
| `webfinger.lookup`                            | Counter       | `{lookup}`    | Counts outgoing WebFinger lookups performed by `lookupWebFinger()`.                             |
| `webfinger.lookup.duration`                   | Histogram     | `ms`          | Measures outgoing WebFinger lookup duration.                                                    |
| `webfinger.handle`                            | Counter       | `{request}`   | Counts inbound WebFinger requests handled by `Federation.fetch()`.                              |
| `webfinger.handle.duration`                   | Histogram     | `ms`          | Measures inbound WebFinger request handling duration.                                           |
| `fedify.http.server.request.count`            | Counter       | `{request}`   | Counts inbound HTTP requests handled by `Federation.fetch()`.                                   |
| `fedify.http.server.request.duration`         | Histogram     | `ms`          | Measures inbound HTTP request duration in `Federation.fetch()`.                                 |
| `fedify.queue.task.enqueued`                  | Counter       | `{task}`      | Counts inbox, outbox, and fanout tasks Fedify enqueued.                                         |
| `fedify.queue.task.started`                   | Counter       | `{task}`      | Counts queue tasks Fedify began processing as a worker.                                         |
| `fedify.queue.task.completed`                 | Counter       | `{task}`      | Counts queue tasks Fedify finished processing without throwing.                                 |
| `fedify.queue.task.failed`                    | Counter       | `{task}`      | Counts queue tasks Fedify abandoned because processing threw.                                   |
| `fedify.queue.task.duration`                  | Histogram     | `ms`          | Measures queue task processing duration in Fedify workers.                                      |
| `fedify.queue.task.in_flight`                 | UpDownCounter | `{task}`      | Tracks queue tasks currently in flight in this Fedify process.                                  |
| `fedify.queue.depth`                          | Gauge         | `{message}`   | Reports queued, ready, and delayed queue depth when the queue backend supports it.              |

### Metric attributes

`activitypub.delivery.sent`
:   `activitypub.remote.host`, `activitypub.delivery.success`, and
    `activitypub.activity.type` when Fedify knows the activity type.

`activitypub.delivery.permanent_failure`
:   `activitypub.remote.host` and `http.response.status_code`.

`activitypub.delivery.duration`
:   `activitypub.remote.host`, `activitypub.delivery.success`, and
    `activitypub.activity.type` when Fedify knows the activity type.

`activitypub.circuit_breaker.state_change`
:   `activitypub.remote.host` and `activitypub.circuit_breaker.state`.
    The state value is one of `closed`, `open`, or `half_open`.

`activitypub.inbox.activity`
:   `activitypub.processing.result` is always present, and is one of:

     -  `queued`: the activity was accepted at the inbox endpoint and
        enqueued for background processing.
     -  `processed`: the registered listener returned without throwing.
        Recorded once per successful dispatch, immediately after the
        listener completes and before the idempotency cache write so
        a `kv.set()` failure does not lose the event.
     -  `retried`: Fedify enqueued a retry message after the listener
        threw and the configured `inboxRetryPolicy` returned a delay.
     -  `rejected`: Fedify refused the activity at the routing layer
        (idempotency cache hit, missing actor) or at processing time
        (no listener for the activity type, no-queue listener error).
     -  `abandoned`: the inbox retry policy returned `null` and Fedify
        gave up on the activity.

    `activitypub.activity.type` is recorded whenever Fedify knows the
    activity type, which is at every site listed above.  Queue backends
    that declare `nativeRetrial` are not represented in `retried` or
    `abandoned` because Fedify defers retry handling to the backend
    instead of re-enqueuing itself.

`activitypub.outbox.activity`
:   `activitypub.processing.result` is always present, and is one of:

     -  `queued`: an outbox task was enqueued for an initial delivery
        attempt (`attempt = 0`).  Each recipient inbox enqueues its own
        task, so fanned-out activities increment this counter once per
        recipient.  Retry re-enqueues are reported as `retried`, not
        `queued`.
     -  `retried`: Fedify enqueued a retry message after a delivery
        failed and the configured `outboxRetryPolicy` returned a delay.
     -  `abandoned`: Fedify gave up on the recipient.  Recorded both
        when the outbox retry policy returned `null` after exhausted
        attempts and when the remote responded with a permanent-failure
        status code listed in `permanentFailureStatusCodes` (`404` and
        `410` by default).  The per-recipient permanent-failure detail
        (remote host, status code) stays on
        [`activitypub.delivery.permanent_failure`](#instrumented-metrics).

    `activitypub.activity.type` is always present.  Per-recipient
    `sent`/`failed` views live on
    [`activitypub.delivery.sent`](#instrumented-metrics) (with the
    `activitypub.delivery.success` attribute) and
    [`activitypub.delivery.permanent_failure`](#instrumented-metrics);
    they are not duplicated on this counter.  Native-retrial backends
    do not record `retried` or `abandoned`.

`activitypub.fanout.recipients`
:   `activitypub.activity.type` is recorded whenever known.  The
    histogram value is the number of recipient inboxes the fanout task
    expanded into (after shared-inbox grouping); one measurement per
    fanout enqueue.  Recipient URLs, actor IDs, and shared-inbox flags
    are deliberately omitted to keep cardinality bounded.  With the
    default `fanout: "auto"` strategy, activities below the fanout
    threshold (`< 5` recipients) are delivered directly without a
    fanout task and do not appear in this histogram; passing
    `fanout: "force"` always enqueues a fanout task, and
    `fanout: "skip"` bypasses fanout regardless of recipient count.

`activitypub.collection.request`,
`activitypub.collection.dispatch.duration`,
`activitypub.collection.page.items`, and
`activitypub.collection.total_items`
:   `activitypub.collection.kind`, `activitypub.collection.page`,
    `activitypub.collection.result`, and `fedify.collection.dispatcher`
    are always present.  `http.response.status_code` is recorded when
    Fedify produced a `Response`.

    `activitypub.collection.kind` is one of `inbox`, `outbox`,
    `following`, `followers`, `liked`, `featured`, `featured_tags`, or
    `custom`.  Application-defined collection routes are deliberately
    collapsed into `custom`; custom route names, URI parameters, actor
    identifiers, collection IDs, cursors, and full URLs are excluded
    from these metrics to keep cardinality bounded.

    `activitypub.collection.page` is `true` when the request targets a
    cursor page and `false` for the collection object itself.
    `fedify.collection.dispatcher` is `built_in` for Fedify's built-in
    ActivityPub collection routes and `custom` for application-defined
    custom collection routes.  `activitypub.collection.result` is one
    of:

     -  `served`: Fedify returned a collection response.
     -  `not_found`: the dispatcher was missing or reported no items for
        the requested collection or page.
     -  `not_acceptable`: the request matched a collection route but did
        not accept JSON-LD.
     -  `unauthorized`: the collection authorization predicate rejected
        the request.
     -  `error`: the handler threw before producing one of the terminal
        responses above.

    The request counter is emitted once per handled collection request.
    The dispatch-duration histogram is emitted once per collection
    dispatcher callback invocation and measures only the callback's
    execution time, not JSON-LD serialization or error-response
    construction.  The page-items histogram is emitted when Fedify has
    materialized an in-memory `items` array for a collection or page;
    collection objects that only point to first/last page cursors do not
    emit it.  The total-items histogram is emitted when a collection
    counter callback reported a value that Fedify already needed while
    handling the request.

`activitypub.inbox.processing_duration`
:   `activitypub.activity.type`.

`activitypub.signature.verification_failure`
:   `activitypub.verification.failure_reason`, plus
    `activitypub.remote.host` when the failed signature includes a key ID.

`activitypub.signature.verification.duration`
:   `activitypub.signature.kind` is always present and is one of `http`,
    `linked_data`, or `object_integrity`.  `activitypub.signature.result` is
    always present and is one of:

     -  `verified`: the signature was checked and accepted.
     -  `rejected`: the signature was checked and refused (bad signature,
        key fetch failure, owner mismatch, etc.).
     -  `missing`: no signature was present.  Only `http` and `linked_data`
        produce this value; `object_integrity` does not, because the caller
        decides whether to invoke proof verification at all.
     -  `error`: verification threw an unexpected error.

    The duration covers the full verification path Fedify performs,
    *including* local key lookup and remote key fetches; the separate
    `activitypub.signature.key_fetch.duration` histogram lets operators
    subtract key lookup latency from the total to isolate the rest of the
    verification work (canonicalization, hashing, attribution and owner
    checks, cryptographic verification, etc.).  Direct calls to
    `verifyRequest()` / `verifyRequestDetailed()`, `verifyJsonLd()`, and
    `verifyProof()` each emit exactly one measurement, even when the
    implementation retries internally after a cache mismatch.  Wrappers
    such as `verifyObject()` emit one measurement per inner `verifyProof()`
    call (and none when the object has no proofs); higher-level inbox
    handling can perform several verification attempts in series.

    Kind-specific optional attributes are recorded only when the value
    matches a small, spec-bounded set, to keep cardinality safe even when
    attacker-supplied JSON-LD or signature headers reach the verifier:

     -  `http_signatures.algorithm` (HTTP only) is recorded only when the
        parsed algorithm value is one of `rsa-sha1`, `rsa-sha256`,
        `rsa-sha512`, `ecdsa-sha256`, `ecdsa-sha384`, `ecdsa-sha512`,
        `ed25519`, or `hs2019` (draft-cavage) or one of the keys of the
        RFC 9421 algorithm map (`rsa-v1_5-sha256`, `rsa-v1_5-sha512`,
        `rsa-pss-sha512`, `ecdsa-p256-sha256`, `ecdsa-p384-sha384`,
        `ed25519`).
     -  `http_signatures.failure_reason` (HTTP only, on `rejected` rows)
        is one of `invalidSignature` or `keyFetchError`.  HTTP requests
        with no signature header are reported as
        `activitypub.signature.result=missing` and do not carry a
        `http_signatures.failure_reason`.
     -  `ld_signatures.type` (Linked Data only) is recorded only for the
        spec-supported `RsaSignature2017` type.
     -  `object_integrity_proofs.cryptosuite` (Object Integrity Proofs
        only) is recorded only for the spec-supported `eddsa-jcs-2022`
        cryptosuite.

    Key IDs, actor IDs, request URLs, and object IDs are deliberately
    excluded from this histogram.  They remain on the corresponding spans
    (`http_signatures.verify`, `ld_signatures.verify`,
    `object_integrity_proofs.verify`) for trace-level investigation.

`activitypub.signature.key_fetch.duration`
:   `activitypub.signature.kind` is always present (same values as above).
    `activitypub.signature.key_fetch.result` is always present and is one
    of:

     -  `hit`: the public key was served by the configured `KeyCache`
        (which may itself be backed by a remote store such as Redis or a
        database; the measurement reflects whatever round trip that
        backend incurs).
     -  `fetched`: the key was not in the cache and was loaded through
        the document loader, returning a usable key.  This typically
        corresponds to a network fetch, but a custom document loader
        that serves from a local store will also fall in this bucket.
     -  `error`: no usable key came back (HTTP failure, invalid response
        body, cached negative entry, thrown exception, etc.).

    Unlike `activitypub.signature.verification.duration`, this histogram
    is recorded *per fetch attempt*: a verification that retries after a
    cache mismatch emits two key fetch measurements (typically one `hit`
    for the stale attempt and one `fetched` for the freshly fetched retry)
    alongside the single verification measurement that covers both.

`activitypub.key.lookup` and `activitypub.key.lookup.duration`
:   `activitypub.lookup.kind` is always `public_key` on these metrics; the
    enumeration also covers `actor`, `object`, `context`, and `other` for
    the document-fetch and lookup-object families described below.
    `activitypub.lookup.result` is always present and is one of:

     -  `hit`: the key was served from the configured `KeyCache`, either
        a valid cached key or a cached negative entry recording a prior
        failed fetch.
     -  `fetched`: the key was not in the cache and was loaded through
        the document loader, returning a usable key.
     -  `not_found`: the remote responded with `404 Not Found` or
        `410 Gone`.  Recorded together with `http.response.status_code`.
     -  `invalid`: the remote responded with a payload Fedify could not
        parse into a `CryptographicKey` or `Multikey`.
     -  `network_error`: no HTTP response was received.  DNS, connect,
        TLS, redirect-loop, or aborted-fetch failures all fall into this
        bucket via the shared error classifier.
     -  `error`: any other unexpected failure (non-2xx HTTP response that
        is neither `404` nor `410`, thrown exceptions that are not
        recognised as transport failures, etc.).

    `activitypub.cache.enabled` is always present and is `true` when the
    caller passed a `KeyCache`, `false` otherwise.  `activitypub.remote.host`
    is the URL host of the key URL, including any non-default port.
    `http.response.status_code` is present only when an HTTP response was
    observed.  Key IDs, full key URLs, and actor IDs are deliberately
    excluded from these metrics;
    they remain on the `activitypub.fetch_key` span for trace-level
    investigation.

    These metrics complement
    [`activitypub.signature.key_fetch.duration`](#instrumented-metrics).
    The signature-scoped histogram keeps an `activitypub.signature.kind`
    dimension and is the right metric to slice signature verification
    latency by `http` / `linked_data` / `object_integrity`; the new
    `activitypub.key.lookup*` metrics cover *every* key lookup performed
    by Fedify (including non-signature uses such as direct `fetchKey()`
    calls) and add a bounded HTTP `status_code` and richer
    `lookup.result` taxonomy.

`activitypub.document.fetch` and `activitypub.document.fetch.duration`
:   `activitypub.lookup.kind` is always present and is one of `object`
    (Fedify's generic document loader), `context` (the JSON-LD context
    loader), or `other` (callers that supply a custom kind hint).
    Actor documents fetched through the generic loader are still
    classified as `object` at this layer because the kind is decided at
    the loader boundary, *before* the response is parsed; the
    [`activitypub.object.lookup`](#instrumented-metrics) counter
    provides the parsed-result actor / object split.

    `activitypub.lookup.result` is always present and is one of
    `fetched`, `not_found` (with `http.response.status_code`),
    `network_error`, or `error`.  The shared error classifier only
    surfaces these four values at the loader boundary; `invalid` is
    reserved for the key lookup metrics, where the parser can decide
    that a successful HTTP response still does not contain a usable
    key.  `activitypub.remote.host` records the URL host of the
    fetched URL, including any non-default port, when the URL parses;
    otherwise it is omitted.
    `activitypub.cache.enabled` is `true` for Fedify's built-in
    `kvCache()`-backed document and context loaders and `false` for the
    authenticated document loader; for user-supplied factories Fedify
    cannot introspect caching behavior, so the attribute is omitted
    rather than recorded as a confident `true` or `false`.

    Counter and histogram are always emitted together for one wrapped
    loader call, so dashboards can compute average duration as
    `duration_sum / counter`.  Document IDs, JSON-LD context URLs, and
    full request URLs are deliberately excluded; the
    `activitypub.fetch_document` span keeps the full URL for sampled
    traces.

`activitypub.document.cache`
:   `activitypub.lookup.kind` is always present (same values as
    `activitypub.document.fetch`).  `activitypub.lookup.result` is
    `hit` when the KV cache returned a `RemoteDocument` and `miss`
    when it did not.  Cache lookups that bypass the KV cache entirely
    (preloaded JSON-LD contexts and call sites without a matching cache
    rule) emit no measurement.  `activitypub.remote.host` records the
    URL host of the looked-up URL, including any non-default port, when
    it parses.

`activitypub.object.lookup`
:   `activitypub.lookup.kind` is always present and is one of:

     -  `actor`: `lookupObject()` resolved to an `Actor` subtype
        (`Application`, `Group`, `Organization`, `Person`, `Service`).
     -  `object`: `lookupObject()` resolved to a non-actor
        `Object` subtype.
     -  `other`: `lookupObject()` returned `null` (the document could
        not be fetched, the response could not be parsed, or the
        cross-origin check rejected the resolved object) **or** the
        call threw before resolving an object.  The metric is emitted
        in a `finally` block, so a thrown error is still counted with
        `kind=other`.

    `activitypub.remote.host` is the host extracted from the
    identifier: a parsed `URL`, an `acct:user@host` URI, or a bare
    `@user@host` / `user@host` handle.  For URL identifiers and
    handle authorities, non-default ports are included.  Inputs that
    do not reduce cleanly to an authority (paths, query strings,
    fragments, or whitespace mixed in with the handle suffix) result
    in the attribute being omitted, rather than recording a
    high-cardinality value.  This counter has no companion histogram:
    `lookupObject()`
    drives `activitypub.document.fetch.duration` through the document
    loader, and emitting another duration here would double-count
    latency.  Use `activitypub.object.lookup` for the parsed-result
    classification and `activitypub.document.fetch[.duration]` for
    the loader-level rate and latency.

`activitypub.actor.discovery` and `activitypub.actor.discovery.duration`
:   `activitypub.actor.discovery.result` is always present and is one of:

     -  `resolved`: `getActorHandle()` returned a handle.
     -  `not_found`: WebFinger did not yield a usable `acct:` alias and
        the `preferredUsername` fallback could not run (the call threw
        the `Actor does not have enough information…` `TypeError`).
     -  `error`: any other thrown exception bubbled up from the
        discovery (including `TypeError`s from a malformed alias URL or
        an invalid `preferredUsername`).

    `activitypub.remote.host` records `actor.id.host`, including any
    non-default port, when known and is omitted otherwise.  Actor IDs
    and handle strings are
    deliberately excluded so attacker-controlled actor data cannot
    inflate metric cardinality.  Per-WebFinger-call failure detail
    (HTTP status, parse failure, network failure, etc.) lives on
    [`webfinger.lookup`](#instrumented-metrics) and is not duplicated
    here; the meter provider passed to `getActorHandle()` is also
    forwarded to the nested WebFinger lookups, so one discovery emits
    both an `activitypub.actor.discovery` measurement and one or two
    `webfinger.lookup` measurements.  When cross-origin actor handle
    verification runs, the second lookup goes to a different host
    than the first, so the two `webfinger.lookup` measurements may
    record different `activitypub.remote.host` values.

`webfinger.lookup` and `webfinger.lookup.duration`
:   `webfinger.lookup.result` is always present and is one of:

     -  `found`: a `ResourceDescriptor` was returned to the caller.
     -  `not_found`: the remote responded with HTTP `404 Not Found` or
        `410 Gone`; recorded together with `http.response.status_code`.
     -  `invalid`: the remote responded with content Fedify could not
        parse (JSON parse failure), the redirect chain exceeded
        `maxRedirection`, the remote redirected to a different
        protocol, the `Location` header itself was unparseable, or the
        queried `acct:` resource was malformed.
     -  `network_error`: no HTTP response was observed.  `fetch()`
        threw, `validatePublicUrl()` rejected the URL (including
        redirects to private addresses), or an `AbortError` cancelled
        the request.
     -  `error`: the remote returned a non-2xx HTTP response that is
        neither `404` nor `410`, or any other unexpected failure
        bubbled up from the lookup.

    `webfinger.resource.scheme` is always present and bucketed to a
    small allow-list (`acct`, `http`, `https`, `mailto`); resources
    that carry any other scheme are recorded as `other` so that an
    attacker-controlled remote cannot inflate cardinality by
    redirecting to an unusual scheme.  The corresponding span
    attribute (`webfinger.resource.scheme` on the `webfinger.lookup`
    span) still records the raw scheme for trace-level investigation.
    `activitypub.remote.host` records the URL host of the latest URL
    Fedify attempted, including any non-default port, so an operator
    can see who actually returned a failure even after one or more
    redirects; it is omitted only when the resource itself was
    malformed before any URL could be built.
    `http.response.status_code` is recorded only when an HTTP response
    was observed (including non-2xx errors and redirects that exceeded
    `maxRedirection`).  Full resource URIs, lookup URLs, and remote
    paths are deliberately excluded; they remain on the
    `webfinger.lookup` span for trace-level investigation.

`webfinger.handle` and `webfinger.handle.duration`
:   `webfinger.handle.result` is always present and is one of:

     -  `resolved`: Fedify returned a `200 OK` response with a JRD.
     -  `invalid`: Fedify returned `400 Bad Request` because the queried
        `resource` parameter was missing or unparseable.
     -  `not_found`: Fedify returned `404 Not Found` because no actor
        dispatcher matched the queried resource, the actor identifier
        was not recognised, or the queried `acct:` host did not match
        the server.
     -  `tombstoned`: Fedify returned `410 Gone` because the actor
        dispatcher resolved to a `Tombstone`.
     -  `error`: the handler threw before producing a response, or a
        custom `onNotFound` callback returned a status code outside
        the `{200, 400, 404, 410}` set.

    `webfinger.resource.scheme` is bucketed to the same allow-list as
    on `webfinger.lookup` (`acct`, `http`, `https`, `mailto`, or
    `other`) and is omitted when the request had no `resource`
    parameter.  `http.response.status_code` is always recorded except
    when the handler threw before constructing a response.  The
    queried resource string itself is deliberately not a metric
    attribute (it is attacker-controlled); the full resource remains
    on the `webfinger.handle` span for trace-level investigation.
    These metrics complement
    [`fedify.http.server.request.count`](#instrumented-metrics) and
    [`fedify.http.server.request.duration`](#instrumented-metrics):
    the HTTP metrics carry the bounded `fedify.endpoint=webfinger`
    bucket, while these WebFinger-specific metrics expose
    discovery-oriented outcome buckets (`tombstoned`, `not_found`,
    etc.) and the queried scheme.

`fedify.http.server.request.count` and `fedify.http.server.request.duration`
:   `http.request.method` and `fedify.endpoint` are always present.
    `http.request.method` is normalized to one of the standard HTTP methods
    (`CONNECT`, `DELETE`, `GET`, `HEAD`, `OPTIONS`, `PATCH`, `POST`, `PUT`,
    `QUERY`, `TRACE`) or `_OTHER` for any other value, so that an arbitrary
    client cannot inflate metric cardinality by sending custom methods.
    `http.response.status_code` is recorded when a `Response` is produced
    (success and non-2xx alike) and omitted when the request threw an
    exception before a response could be returned.  `fedify.route.template`
    is recorded when a route matched, and contains the [URI Template]
    parameter names (for example `/users/{identifier}`) rather than the
    matched parameter values.

`fedify.queue.task.enqueued`, `fedify.queue.task.started`,
`fedify.queue.task.completed`, `fedify.queue.task.failed`, and
`fedify.queue.task.duration`
:   `fedify.queue.role` (`inbox`, `outbox`, or `fanout`) is always present.
    `fedify.queue.backend` is the queue implementation's constructor name
    (for example `RedisMessageQueue`) when available; it is omitted for
    queues whose constructor is the plain `Object` (for example,
    `MessageQueue` instances built from an object literal).
    `fedify.queue.native_retrial` reflects the queue backend's `nativeRetrial`
    flag when set on the queue. `activitypub.activity.type` is recorded
    whenever Fedify knows the activity type for the queued message; for inbox
    tasks the type only becomes available after the activity is parsed, so the
    *started* counter for inbox tasks may be recorded without it.
    `fedify.queue.task.enqueued` additionally carries a zero-based
    `fedify.queue.task.attempt` so that retry re-enqueues are distinguishable
    from initial enqueues. `fedify.queue.task.completed`,
    `fedify.queue.task.failed`, and `fedify.queue.task.duration` carry
    `fedify.queue.task.result`, which is `completed` when processing returned
    without throwing, `failed` when the worker re-threw a non-abort error, and
    `aborted` when the worker re-threw an `AbortError` (for example, because a
    graceful-shutdown `AbortSignal` interrupted processing).  When the queue
    backend does not declare `nativeRetrial`, Fedify catches inbox listener and
    outbox delivery errors itself; if its retry policy still allows another
    attempt, it schedules a retry by re-enqueuing the message and returns from
    the worker without re-throwing, so the worker boundary records
    `result=completed`.  When the retry policy gives up, the worker also
    returns normally (`result=completed`) without scheduling a retry.
    Outbox-side activity failures remain observable through the
    `activitypub.delivery.*` metrics and the `activitypub.delivery.failed`
    span event, and any retry attempt (inbox or outbox) appears as a
    `fedify.queue.task.enqueued` measurement with a non-zero
    `fedify.queue.task.attempt`.  Inbox listener errors that the retry policy
    abandons are visible through error logs and the inbox span's error status,
    but not through a dedicated metric.

`fedify.queue.task.in_flight`
:   `fedify.queue.role` and `fedify.queue.backend` (when available), plus
    `fedify.queue.native_retrial` when set on the queue.  Per-message
    attributes such as `activitypub.activity.type`,
    `fedify.queue.task.attempt`, and `fedify.queue.task.result` are
    deliberately omitted so that increment and decrement operations always
    pair up cleanly per attribute series.  This UpDownCounter is
    process-local: it tracks tasks currently being processed *in this
    Fedify process*, not cross-process totals.  Aggregate it across
    replicas in your metrics backend.

`fedify.queue.depth`
:   `fedify.queue.depth.state` is always present and is one of `queued`,
    `ready`, or `delayed`.  `fedify.queue.role` is `inbox`, `outbox`,
    `fanout`, or `shared`; `shared` means the same queue instance backs more
    than one Fedify queue role, and `fedify.queue.roles` lists those roles as a
    comma-separated string.  `fedify.queue.backend` and
    `fedify.queue.native_retrial` follow the same rules as the queue task
    metrics.  `fedify.federation.instance_id` is an opaque per-Federation
    instance identifier that keeps queue depth series distinct when multiple
    Federation instances share one [`MeterProvider`].

The `fedify.queue.task.*` metrics describe what Fedify's workers do with
queued messages.  They complement the backend-side
[`MessageQueue.getDepth()` API](./mq.md#queue-depth-reporting), which
reports how many messages are currently waiting in the queue backend.
Reading both signals together (task throughput plus backlog depth)
makes it possible to distinguish a small, slow queue from a large, fast
one and to set alerting thresholds for delivery latency under load.

When [`benchmarkMode`](./benchmarking.md) is enabled, Fedify serves a
versioned snapshot of these in-process metrics from
`/.well-known/fedify/bench/stats`.

The `activitypub.inbox.activity`, `activitypub.outbox.activity`, and
`activitypub.fanout.recipients` metrics describe what is happening at
the *activity* level, complementing the per-recipient
`activitypub.delivery.*` counters and the per-task `fedify.queue.task.*`
metrics.  Use them when you need to understand whether the pressure on
a slow queue comes from fanout size, retry volume, or activity-type
mix.  Concrete per-task counts (initial enqueue vs. retry re-enqueue,
or processed-task throughput) remain available on `fedify.queue.task.enqueued`
(via the `fedify.queue.task.attempt` attribute) and
`fedify.queue.task.completed`; the activity-level counters are
intentionally not a queue-mechanism replacement.

Fedify records `activitypub.remote.host` as the URL host: the hostname plus
any non-default port.  Paths and query strings are deliberately excluded to
keep metric cardinality bounded, but ports are preserved so distinct services
on the same hostname do not collapse into one metric series or circuit
breaker key.
Activity types use the same qualified URI form as Fedify's trace attributes,
for example `https://www.w3.org/ns/activitystreams#Create`.

The key lookup, document fetch, document cache, and object lookup metrics
share an `activitypub.lookup.kind` and (where applicable)
`activitypub.lookup.result` attribute taxonomy.  Both are drawn from small
fixed enumerations (`kind` ∈ `{public_key, actor, object, context, other}`
and `result` ∈
`{hit, miss, fetched, not_found, invalid, network_error, error}`), so an
attacker-controlled remote cannot inflate cardinality by returning arbitrary
status codes, content types, or thrown exceptions. Full URLs, key IDs, actor
IDs, object IDs, JSON-LD context URLs, and fediverse handles are deliberately
excluded; they remain on the corresponding spans (`activitypub.fetch_key`,
`activitypub.fetch_document`, `activitypub.lookup_object`) for trace-level
investigation.

The HTTP server request metrics deliberately exclude high-cardinality fields
such as the full URL, raw path, query string, actor identifier, and inbox
URL.  Use the request span's `url.full` attribute when you need the exact URL
for a sampled trace; the metrics expose the stable endpoint category and route
template so that aggregate request rate, latency, and status-code error rate
remain meaningful even when traces are sampled.

The collection metrics similarly expose only bounded collection dimensions:
collection kind, whether the request is for a cursor page, dispatcher family,
terminal result, and optional status code.  Use the collection dispatch spans
when you need trace-level collection IDs, cursor values, or custom route names.

The `fedify.endpoint` attribute is drawn from a fixed enumeration:
`webfinger`, `nodeinfo`, `actor`, `inbox`, `shared_inbox`, `outbox`,
`object`, `following`, `followers`, `liked`, `featured`, `featured_tags`,
`collection`, `not_found`, `not_acceptable`, and `error`.  When a request
throws an exception after Fedify has already classified its endpoint, the
metric retains the matched endpoint (for example `actor`) so that
fault-attribution stays per endpoint; `error` is only used when classification
itself failed.

For turning these metrics into a production dashboard and alert rules, see the
[*Production monitoring* guide](./monitoring.md).  It maps the metrics above to
the federation-health questions operators ask, with PromQL examples, the
OpenTelemetry-to-Prometheus naming translation, and cardinality guidance for
dashboard and alert authors.

[URI Template]: https://datatracker.ietf.org/doc/html/rfc6570


Semantic [attributes] for ActivityPub
-------------------------------------

The [OpenTelemetry Semantic Conventions] currently do not have a specification
for ActivityPub as of November 2024.  However, Fedify provides a set of semantic
[attributes] for ActivityPub.  The following table shows the semantic attributes
for ActivityPub:

| Attribute                                    | Type     | Description                                                                                                                  | Example                                                              |
| -------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `activitypub.activity.id`                    | string   | The URI of the activity object.                                                                                              | `"https://example.com/activity/1"`                                   |
| `activitypub.activity.type`                  | string[] | The qualified URI(s) of the activity type(s).                                                                                | `["https://www.w3.org/ns/activitystreams#Create"]`                   |
| `activitypub.activity.to`                    | string[] | The URI(s) of the recipient collections/actors of the activity.                                                              | `["https://example.com/1/followers/2"]`                              |
| `activitypub.activity.cc`                    | string[] | The URI(s) of the carbon-copied recipient collections/actors of the activity.                                                | `["https://www.w3.org/ns/activitystreams#Public"]`                   |
| `activitypub.activity.bto`                   | string[] | The URI(s) of the blind recipient collections/actors of the activity.                                                        | `["https://example.com/1/followers/2"]`                              |
| `activitypub.activity.bcc`                   | string[] | The URI(s) of the blind carbon-copied recipient collections/actors of the activity.                                          | `["https://www.w3.org/ns/activitystreams#Public"]`                   |
| `activitypub.activity.retries`               | int      | The ordinal number of activity resending attempt (if and only if it's retried).                                              | `3`                                                                  |
| `activitypub.delivery.attempt`               | int      | The zero-based delivery attempt number for a queued outgoing activity.                                                       | `0`                                                                  |
| `activitypub.delivery.permanent_failure`     | boolean  | Whether an outgoing delivery failure will be abandoned instead of retried.                                                   | `true`                                                               |
| `activitypub.circuit_breaker.previous_state` | string   | Previous queued outbox circuit breaker state: `closed`, `open`, or `half_open`.                                              | `"closed"`                                                           |
| `activitypub.circuit_breaker.state`          | string   | Current queued outbox circuit breaker state: `closed`, `open`, or `half_open`.                                               | `"open"`                                                             |
| `activitypub.processing.result`              | string   | Lifecycle outcome of an inbox or outbox activity: `queued`, `processed`, `retried`, `rejected`, or `abandoned`.              | `"retried"`                                                          |
| `activitypub.actor.discovery.result`         | string   | Terminal outcome of `getActorHandle()`: `resolved`, `not_found`, or `error`.                                                 | `"resolved"`                                                         |
| `activitypub.actor.id`                       | string   | The URI of the actor object.                                                                                                 | `"https://example.com/actor/1"`                                      |
| `activitypub.actor.key.cached`               | boolean  | Whether the actor's public keys are cached.                                                                                  | `true`                                                               |
| `activitypub.actor.type`                     | string[] | The qualified URI(s) of the actor type(s).                                                                                   | `["https://www.w3.org/ns/activitystreams#Person"]`                   |
| `activitypub.key.id`                         | string   | The URI of the cryptographic key being verified.                                                                             | `"https://example.com/actor/1#main-key"`                             |
| `activitypub.key_ownership.method`           | string   | The method used to verify key ownership (`owner_id` or `actor_fetch`).                                                       | `"actor_fetch"`                                                      |
| `activitypub.key_ownership.verified`         | boolean  | Whether the key ownership was successfully verified.                                                                         | `true`                                                               |
| `activitypub.collection.id`                  | string   | The URI of the collection object.                                                                                            | `"https://example.com/collection/1"`                                 |
| `activitypub.collection.kind`                | string   | The bounded collection kind: `inbox`, `outbox`, `following`, `followers`, `liked`, `featured`, `featured_tags`, or `custom`. | `"followers"`                                                        |
| `activitypub.collection.page`                | boolean  | Whether the collection request targets a cursor page rather than the collection object.                                      | `false`                                                              |
| `activitypub.collection.result`              | string   | Terminal collection request outcome: `served`, `not_found`, `not_acceptable`, `unauthorized`, or `error`.                    | `"served"`                                                           |
| `activitypub.collection.type`                | string[] | The qualified URI(s) of the collection type(s).                                                                              | `["https://www.w3.org/ns/activitystreams#OrderedCollection"]`        |
| `activitypub.collection.total_items`         | int      | The total number of items in the collection.                                                                                 | `42`                                                                 |
| `activitypub.object.id`                      | string   | The URI of the object or the object enclosed by the activity.                                                                | `"https://example.com/object/1"`                                     |
| `activitypub.object.type`                    | string[] | The qualified URI(s) of the object type(s).                                                                                  | `["https://www.w3.org/ns/activitystreams#Note"]`                     |
| `activitypub.object.in_reply_to`             | string[] | The URI(s) of the original object to which the object reply.                                                                 | `["https://example.com/object/1"]`                                   |
| `activitypub.inboxes`                        | int      | The number of inboxes the activity is sent to.                                                                               | `12`                                                                 |
| `activitypub.remote.host`                    | string   | The host of the remote ActivityPub server, including any non-default port.                                                   | `"example.com:8443"`                                                 |
| `activitypub.shared_inbox`                   | boolean  | Whether the activity is sent to the shared inbox.                                                                            | `true`                                                               |
| `docloader.context_url`                      | string   | The URL of the JSON-LD context document (if provided via Link header).                                                       | `"https://www.w3.org/ns/activitystreams"`                            |
| `docloader.document_url`                     | string   | The final URL of the fetched document (after following redirects).                                                           | `"https://example.com/object/1"`                                     |
| `fedify.actor.identifier`                    | string   | The identifier of the actor.                                                                                                 | `"1"`                                                                |
| `fedify.endpoint`                            | string   | The bounded endpoint category that classified an inbound HTTP request handled by `Federation.fetch()`.                       | `"actor"`                                                            |
| `fedify.federation.instance_id`              | string   | Opaque per-Federation instance identifier used to distinguish queue depth series on a shared `MeterProvider`.                | `"fedify-1"`                                                         |
| `fedify.route.template`                      | string   | The matched URI Template, with parameter names (not values).                                                                 | `"/users/{identifier}"`                                              |
| `fedify.inbox.recipient`                     | string   | The identifier of the inbox recipient.                                                                                       | `"1"`                                                                |
| `fedify.object.type`                         | string   | The URI of the object type.                                                                                                  | `"https://www.w3.org/ns/activitystreams#Note"`                       |
| `fedify.object.values.{parameter}`           | string[] | The argument values of the object dispatcher.                                                                                | `["1", "2"]`                                                         |
| `fedify.collection.dispatcher`               | string   | The collection dispatcher family: `built_in` or `custom`.                                                                    | `"built_in"`                                                         |
| `fedify.collection.cursor`                   | string   | The cursor of the collection.                                                                                                | `"eyJpZCI6IjEiLCJ0eXBlIjoiT3JkZXJlZENvbGxlY3Rpb24ifQ=="`             |
| `fedify.collection.items`                    | number   | The number of materialized items in the collection response or page.  It can be less than the total items.                   | `10`                                                                 |
| `fedify.queue.role`                          | string   | The Fedify queue role: `inbox`, `outbox`, `fanout`, or `shared` for queue depth rows where one queue backs multiple roles.   | `"outbox"`                                                           |
| `fedify.queue.backend`                       | string   | The queue implementation's constructor name (best-effort backend identifier).                                                | `"RedisMessageQueue"`                                                |
| `fedify.queue.native_retrial`                | boolean  | Whether the queue backend declares `nativeRetrial`, meaning Fedify defers retry handling to the backend.                     | `true`                                                               |
| `fedify.queue.depth.state`                   | string   | Queue depth count kind: `queued`, `ready`, or `delayed`.                                                                     | `"queued"`                                                           |
| `fedify.queue.roles`                         | string   | Comma-separated queue roles when one queue instance backs multiple roles.                                                    | `"fanout,inbox,outbox"`                                              |
| `fedify.queue.task.attempt`                  | int      | The zero-based attempt number recorded on `fedify.queue.task.enqueued`; non-zero for retry re-enqueues.                      | `1`                                                                  |
| `fedify.queue.task.result`                   | string   | The terminal outcome of queue task processing: `completed`, `failed`, or `aborted`.                                          | `"failed"`                                                           |
| `http.redirect.url`                          | string   | The redirect URL when a document fetch results in a redirect.                                                                | `"https://example.com/new-location"`                                 |
| `http.response.status_code`                  | int      | The HTTP response status code.                                                                                               | `200`                                                                |
| `http_signatures.signature`                  | string   | The signature of the HTTP request in hexadecimal.                                                                            | `"73a74c990beabe6e59cc68f9c6db7811b59cbb22fd12dcffb3565b651540efe9"` |
| `http_signatures.algorithm`                  | string   | The algorithm of the HTTP request signature.                                                                                 | `"rsa-sha256"`                                                       |
| `http_signatures.key_id`                     | string   | The public key ID of the HTTP request signature.                                                                             | `"https://example.com/actor/1#main-key"`                             |
| `http_signatures.verified`                   | boolean  | Whether the HTTP request signature was verified successfully.                                                                | `false`                                                              |
| `http_signatures.failure_reason`             | string   | Why HTTP signature verification failed (`noSignature`, `invalidSignature`, or `keyFetchError`).                              | `"keyFetchError"`                                                    |
| `http_signatures.key_fetch_status`           | int      | The HTTP status code from a failed signing-key fetch, when available.                                                        | `410`                                                                |
| `http_signatures.key_fetch_error`            | string   | The error type from a non-HTTP signing-key fetch failure, when available.                                                    | `"TypeError"`                                                        |
| `http_signatures.digest.{algorithm}`         | string   | The digest of the HTTP request body in hexadecimal.  The `{algorithm}` is the digest algorithm (e.g., `sha`, `sha-256`).     | `"d41d8cd98f00b204e9800998ecf8427e"`                                 |
| `ld_signatures.key_id`                       | string   | The public key ID of the Linked Data signature.                                                                              | `"https://example.com/actor/1#main-key"`                             |
| `ld_signatures.signature`                    | string   | The signature of the Linked Data in hexadecimal.                                                                             | `"73a74c990beabe6e59cc68f9c6db7811b59cbb22fd12dcffb3565b651540efe9"` |
| `ld_signatures.type`                         | string   | The algorithm of the Linked Data signature.                                                                                  | `"RsaSignature2017"`                                                 |
| `object_integrity_proofs.cryptosuite`        | string   | The cryptographic suite of the object integrity proof.                                                                       | `"eddsa-jcs-2022"`                                                   |
| `object_integrity_proofs.key_id`             | string   | The public key ID of the object integrity proof.                                                                             | `"https://example.com/actor/1#main-key"`                             |
| `object_integrity_proofs.signature`          | string   | The integrity proof of the object in hexadecimal.                                                                            | `"73a74c990beabe6e59cc68f9c6db7811b59cbb22fd12dcffb3565b651540efe9"` |
| `url.full`                                   | string   | The full URL being fetched by the document loader.                                                                           | `"https://example.com/actor/1"`                                      |
| `webfinger.handle.result`                    | string   | Terminal outcome of an incoming WebFinger request: `resolved`, `invalid`, `not_found`, `tombstoned`, or `error`.             | `"resolved"`                                                         |
| `webfinger.lookup.result`                    | string   | Terminal outcome of an outgoing WebFinger lookup: `found`, `not_found`, `invalid`, `network_error`, or `error`.              | `"found"`                                                            |
| `webfinger.resource`                         | string   | The queried resource URI.                                                                                                    | `"acct:fedify@hollo.social"`                                         |
| `webfinger.resource.scheme`                  | string   | The scheme of the queried resource URI.  Metric attribute is bucketed to `acct`, `http`, `https`, `mailto`, or `other`.      | `"acct"`                                                             |

[attributes]: https://opentelemetry.io/docs/specs/otel/common/#attribute
[OpenTelemetry Semantic Conventions]: https://opentelemetry.io/docs/specs/semconv/


Building observability tools with OpenTelemetry
-----------------------------------------------

The OpenTelemetry instrumentation in Fedify provides a powerful foundation for
building custom observability tools.  By implementing a custom [SpanExporter],
you can capture and process all the telemetry data generated by Fedify to build
tools like debug dashboards, activity monitors, or analytics systems.

[SpanExporter]: https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_sdk_trace_base.SpanExporter.html

### Example: ActivityPub debug dashboard

Here's an example of how you might implement a custom `SpanExporter` to capture
ActivityPub activities for a debug dashboard:

~~~~ typescript
import type { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { ExportResultCode } from "@opentelemetry/core";

interface InboundActivityRecord {
  direction: "inbound";
  activity: unknown;
  timestamp: Date;
  verified?: boolean;
}

interface OutboundActivityRecord {
  direction: "outbound";
  activityId?: string;
  inboxUrl?: string;
  timestamp: Date;
}

type ActivityRecord = InboundActivityRecord | OutboundActivityRecord;

export class FedifyDebugExporter implements SpanExporter {
  private activities: ActivityRecord[] = [];

  export(spans: ReadableSpan[], resultCallback: (result: { code: ExportResultCode }) => void): void {
    for (const span of spans) {
      // Capture inbound activities
      if (span.name === "activitypub.inbox") {
        const event = span.events.find(
          (e) => e.name === "activitypub.activity.received"
        );
        if (event && event.attributes) {
          this.activities.push({
            direction: "inbound",
            activity: JSON.parse(
              event.attributes["activitypub.activity.json"] as string
            ),
            timestamp: new Date(span.startTime[0] * 1000),
            verified: event.attributes["activitypub.activity.verified"] as boolean,
          });
        }
      }

      // Capture outbound activities
      if (span.name === "activitypub.send_activity") {
        const event = span.events.find(
          (e) => e.name === "activitypub.activity.sent"
        );
        if (event && event.attributes) {
          const activityId = event.attributes[
            "activitypub.activity.id"
          ] as string | undefined;
          const inboxUrl = event.attributes[
            "activitypub.inbox.url"
          ] as string | undefined;
          const activityType = event.attributes[
            "activitypub.activity.type"
          ] as string | undefined;
          const actorId = event.attributes[
            "activitypub.actor.id"
          ] as string | undefined;
          this.activities.push({
            direction: "outbound",
            activityId,
            activityType,
            actorId,
            inboxUrl,
            timestamp: new Date(span.startTime[0] * 1000),
          });
        }
      }
    }
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  async forceFlush(): Promise<void> {
    // Flush any pending data
  }

  async shutdown(): Promise<void> {
    // Clean up resources
  }

  getActivities(): ActivityRecord[] {
    return this.activities;
  }
}
~~~~

### Integrating the custom exporter

To use the custom exporter, add it to your OpenTelemetry SDK configuration:

~~~~ typescript
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { createFederation } from "@fedify/fedify";

const debugExporter = new FedifyDebugExporter();
const tracerProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(debugExporter)],
});

const federation = createFederation({
  kv: /* your KV store */,
  tracerProvider,
});
~~~~

Now the `debugExporter` will receive all telemetry data from Fedify, and you
can use `debugExporter.getActivities()` to access the captured activities for
your debug dashboard or other observability tools.


Distributed trace storage with `FedifySpanExporter`
---------------------------------------------------

*This API is available since Fedify 1.10.0.*

The example `FedifyDebugExporter` shown above stores activities in memory,
which works well for single-process applications.  However, Fedify applications
often run in distributed environments where:

 -  The web server handling HTTP requests runs on different nodes than
    the background workers processing the message queue.
 -  Multiple worker nodes may process queued messages in parallel.
 -  The debug dashboard itself may run on yet another node.

In such environments, an in-memory exporter cannot aggregate traces across
nodes.  Each node would only see its own spans, making it impossible to view
the complete picture of a distributed trace.

Fedify provides [`FedifySpanExporter`] which persists trace data to a
[`KvStore`](./kv.md), enabling distributed tracing across multiple nodes.
All nodes can write to the same storage, and your debug dashboard can query
this shared storage to display complete traces.

[`FedifySpanExporter`]: https://jsr.io/@fedify/fedify/doc/otel/~/FedifySpanExporter

### Setting up `FedifySpanExporter`

To use `FedifySpanExporter`, import it from the `@fedify/fedify/otel` module
and configure it with a [`KvStore`](./kv.md):

::: code-group

~~~~ typescript twoslash [Deno]
import type { KvStore, MessageQueue } from "@fedify/fedify";
// ---cut-before---
import { createFederation } from "@fedify/fedify";
import { RedisKvStore } from "@fedify/redis";
import { FedifySpanExporter } from "@fedify/fedify/otel";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import Redis from "ioredis";

const redis = new Redis();
const kv = new RedisKvStore(redis);

// Create the exporter that writes to KvStore
const fedifyExporter = new FedifySpanExporter(kv, {
  ttl: Temporal.Duration.from({ hours: 1 }),
});

const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(fedifyExporter)],
});

const federation = createFederation<void>({
  kv,
  tracerProvider,
// ---cut-start---
  queue: null as unknown as MessageQueue,
// ---cut-end---
  // Omitted for brevity; see the related section for details.
});
~~~~

~~~~ typescript [Node.js]
import { createFederation } from "@fedify/fedify";
import { RedisKvStore } from "@fedify/redis";
import { FedifySpanExporter } from "@fedify/fedify/otel";
import { NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import Redis from "ioredis";

const redis = new Redis();
const kv = new RedisKvStore(redis);

// Create the exporter that writes to KvStore
const fedifyExporter = new FedifySpanExporter(kv, {
  ttl: Temporal.Duration.from({ hours: 1 }),
});

const tracerProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(fedifyExporter)],
});

const federation = createFederation({
  kv,
  tracerProvider,
  // Omitted for brevity; see the related section for details.
});
~~~~

:::

### Querying stored traces

The `FedifySpanExporter` provides methods to query stored trace data:

~~~~ typescript twoslash
import { MemoryKvStore } from "@fedify/fedify";
import { FedifySpanExporter } from "@fedify/fedify/otel";
const kv = new MemoryKvStore();
const fedifyExporter = new FedifySpanExporter(kv);
const traceId = "";
// ---cut-before---
// Get all activities for a specific trace
const activities = await fedifyExporter.getActivitiesByTraceId(traceId);

// Get recent traces (with optional limit)
const recentTraces = await fedifyExporter.getRecentTraces({ limit: 100 });
~~~~

> [!NOTE]
> The `~FedifySpanExporter.getRecentTraces()` method requires a `KvStore`
> implementation that supports the `list()` method.  When using a store
> that only provides `cas()` without `list()` support, this method will
> return an empty array.

Each `TraceActivityRecord` contains:

 -  `traceId`: The OpenTelemetry trace ID
 -  `spanId`: The OpenTelemetry span ID
 -  `parentSpanId`: The parent span ID (if any)
 -  `direction`: `"inbound"` or `"outbound"`
 -  `activityType`: The ActivityPub activity type (e.g., `"Create"`, `"Follow"`)
 -  `activityId`: The activity's ID URL
 -  `actorId`: The actor ID URL (sender of the activity)
 -  `activityJson`: The complete activity JSON
 -  `verified`: Whether the activity was verified (for inbound activities)
 -  `signatureDetails`: Detailed signature verification information
    (for inbound activities), containing:
     -  `httpSignaturesVerified`: Whether HTTP Signatures were verified
     -  `httpSignaturesKeyId` (optional): The key ID used for HTTP signature
        verification, if available
     -  `httpSignaturesFailureReason` (optional): Why HTTP signature
        verification failed, if available
     -  `httpSignaturesKeyFetchStatus` (optional): The HTTP status code from a
        failed key fetch, if available
     -  `httpSignaturesKeyFetchError` (optional): The error type from a
        non-HTTP key fetch failure, if available
     -  `ldSignaturesVerified`: Whether Linked Data Signatures were verified
 -  `timestamp`: ISO 8601 timestamp
 -  `inboxUrl`: The target inbox URL (for outbound activities)

### Configuration options

The `FedifySpanExporter` constructor accepts the following options:

`ttl`
:   The time-to-live for stored trace data.  If not specified, data will be
    stored indefinitely (or until manually deleted).  This is useful for
    automatically cleaning up old trace data:

    ~~~~ typescript twoslash
    import { MemoryKvStore } from "@fedify/fedify";
    import { FedifySpanExporter } from "@fedify/fedify/otel";
    const kv = new MemoryKvStore();
    // ---cut-before---
    const exporter = new FedifySpanExporter(kv, {
      ttl: Temporal.Duration.from({ hours: 24 }),
    });
    ~~~~

`keyPrefix`
:   The key prefix for storing trace data in the `KvStore`.  Defaults to
    `["fedify", "traces"]`.  You can customize this to avoid conflicts with
    other data in the same `KvStore`:

    ~~~~ typescript twoslash
    import { MemoryKvStore } from "@fedify/fedify";
    import { FedifySpanExporter } from "@fedify/fedify/otel";
    const kv = new MemoryKvStore();
    // ---cut-before---
    const exporter = new FedifySpanExporter(kv, {
      keyPrefix: ["myapp", "otel", "traces"],
    });
    ~~~~

### `KvStore` requirements

The `FedifySpanExporter` requires a [`KvStore`](./kv.md) that supports either
the `list()` method (preferred) or the `cas()` method:

 -  When `list()` is available, the exporter stores each activity record under
    its own unique key, enabling efficient prefix scans without concurrency
    issues.
 -  When only `cas()` is available, the exporter uses compare-and-swap
    operations to append records to a list, which works but may experience
    contention under high load.
 -  If neither method is available, the constructor throws an error.

The following `KvStore` implementations support the required operations:

 -  `MemoryKvStore` (supports both `list()` and `cas()`)
 -  `RedisKvStore` from *@fedify/redis* (supports both `list()` and `cas()`)
 -  `PostgresKvStore` from *@fedify/postgres* (supports `list()`)
 -  `SqliteKvStore` from *@fedify/sqlite* (supports `list()`)
 -  `DenoKvStore` from *@fedify/denokv* (supports both `list()` and `cas()`)
 -  `WorkersKvStore` from *@fedify/cfworkers* (supports `list()`)
