---
description: >-
  OpenTelemetry is a set of APIs, libraries, agents, and instrumentation to
  provide observability to your applications.  Fedify supports OpenTelemetry
  for tracing.  This document explains how to use OpenTelemetry with Fedify.
---

OpenTelemetry
=============

*This API is available since Fedify 1.3.0.*

[OpenTelemetry] is a standardized set of APIs, libraries, agents, and
instrumentation to provide observability to your applications.  Fedify supports
OpenTelemetry for tracing.  This document explains how to use OpenTelemetry with
Fedify.

[OpenTelemetry]: https://opentelemetry.io/


Setting up OpenTelemetry
------------------------

> [!TIP]
> If you are using Deno 2.2 or later, you can use Deno's built-in OpenTelemetry
> support.  See the [*Using Deno's built-in OpenTelemetry support*
> section](#using-deno-s-built-in-opentelemetry-support) for more details.

To trace your Fedify application with OpenTelemetry, you need to set up the
OpenTelemetry SDK.  First of all, you need to install the OpenTelemetry SDK and
the tracer exporter you want to use.  For example, if you want to use the trace
exporter for OTLP (http/protobuf), you should install the following packages:

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

1. Run your Deno script with the `--unstable-otel` flag
2. Set the environment variable `OTEL_DENO=true`

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


Instrumented spans
------------------

Fedify automatically instruments the following operations with OpenTelemetry
spans:

| Span name                                           | [Span kind] | Description                                   |
|-----------------------------------------------------|-------------|-----------------------------------------------|
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

| Event name                         | Recorded on span             | Description                                                                      |
|------------------------------------|------------------------------|----------------------------------------------------------------------------------|
| `activitypub.activity.received`    | `activitypub.inbox`          | Records full activity JSON and verification status when an activity is received. |
| `activitypub.activity.sent`        | `activitypub.send_activity`  | Records full activity JSON and delivery details when an activity is sent.        |
| `activitypub.object.fetched`       | `activitypub.lookup_object`  | Records full object JSON when successfully fetched.                              |

### Event attributes

Each span event includes attributes with detailed information:

**`activitypub.activity.received` event attributes:**

 -  `activitypub.activity.json`: The complete activity JSON
 -  `activitypub.activity.verified`: Whether the activity was verified (`true`/`false`)
 -  `ld_signatures.verified`: Whether Linked Data Signatures were verified (`true`/`false`)
 -  `http_signatures.verified`: Whether HTTP Signatures were verified (`true`/`false`)
 -  `http_signatures.key_id`: The key ID used for HTTP signature verification

**`activitypub.activity.sent` event attributes:**

 -  `activitypub.activity.json`: The complete activity JSON being sent
 -  `activitypub.inbox.url`: The inbox URL where the activity was delivered
 -  `activitypub.activity.id`: The activity ID

**`activitypub.object.fetched` event attributes:**

 -  `activitypub.object.type`: The type URI of the fetched object
 -  `activitypub.object.json`: The complete object JSON

[span events]: https://opentelemetry.io/docs/concepts/signals/traces/#span-events


Semantic [attributes] for ActivityPub
-------------------------------------

The [OpenTelemetry Semantic Conventions] currently do not have a specification
for ActivityPub as of November 2024.  However, Fedify provides a set of semantic
[attributes] for ActivityPub.  The following table shows the semantic attributes
for ActivityPub:

| Attribute                             | Type     | Description                                                                              | Example                                                              |
|---------------------------------------|----------|------------------------------------------------------------------------------------------|----------------------------------------------------------------------|
| `activitypub.activity.id`             | string   | The URI of the activity object.                                                          | `"https://example.com/activity/1"`                                   |
| `activitypub.activity.type`           | string[] | The qualified URI(s) of the activity type(s).                                            | `["https://www.w3.org/ns/activitystreams#Create"]`                   |
| `activitypub.activity.to`             | string[] | The URI(s) of the recipient collections/actors of the activity.                          | `["https://example.com/1/followers/2"]`                              |
| `activitypub.activity.cc`             | string[] | The URI(s) of the carbon-copied recipient collections/actors of the activity.            | `["https://www.w3.org/ns/activitystreams#Public"]`                   |
| `activitypub.activity.bto`            | string[] | The URI(s) of the blind recipient collections/actors of the activity.                    | `["https://example.com/1/followers/2"]`                              |
| `activitypub.activity.bcc`            | string[] | The URI(s) of the blind carbon-copied recipient collections/actors of the activity.      | `["https://www.w3.org/ns/activitystreams#Public"]`                   |
| `activitypub.activity.retries`        | int      | The ordinal number of activity resending attempt (if and only if it's retried).          | `3`                                                                  |
| `activitypub.actor.id`                | string   | The URI of the actor object.                                                             | `"https://example.com/actor/1"`                                      |
| `activitypub.actor.key.cached`        | boolean  | Whether the actor's public keys are cached.                                              | `true`                                                               |
| `activitypub.actor.type`              | string[] | The qualified URI(s) of the actor type(s).                                               | `["https://www.w3.org/ns/activitystreams#Person"]`                   |
| `activitypub.key.id`                  | string   | The URI of the cryptographic key being verified.                                         | `"https://example.com/actor/1#main-key"`                             |
| `activitypub.key_ownership.method`    | string   | The method used to verify key ownership (`owner_id` or `actor_fetch`).                   | `"actor_fetch"`                                                      |
| `activitypub.key_ownership.verified`  | boolean  | Whether the key ownership was successfully verified.                                     | `true`                                                               |
| `activitypub.collection.id`           | string   | The URI of the collection object.                                                        | `"https://example.com/collection/1"`                                 |
| `activitypub.collection.type`         | string[] | The qualified URI(s) of the collection type(s).                                          | `["https://www.w3.org/ns/activitystreams#OrderedCollection"]`        |
| `activitypub.collection.total_items`  | int      | The total number of items in the collection.                                             | `42`                                                                 |
| `activitypub.object.id`               | string   | The URI of the object or the object enclosed by the activity.                            | `"https://example.com/object/1"`                                     |
| `activitypub.object.type`             | string[] | The qualified URI(s) of the object type(s).                                              | `["https://www.w3.org/ns/activitystreams#Note"]`                     |
| `activitypub.object.in_reply_to`      | string[] | The URI(s) of the original object to which the object reply.                             | `["https://example.com/object/1"]`                                   |
| `activitypub.inboxes`                 | int      | The number of inboxes the activity is sent to.                                           | `12`                                                                 |
| `activitypub.shared_inbox`            | boolean  | Whether the activity is sent to the shared inbox.                                        | `true`                                                               |
| `docloader.context_url`               | string   | The URL of the JSON-LD context document (if provided via Link header).                   | `"https://www.w3.org/ns/activitystreams"`                            |
| `docloader.document_url`              | string   | The final URL of the fetched document (after following redirects).                       | `"https://example.com/object/1"`                                     |
| `fedify.actor.identifier`             | string   | The identifier of the actor.                                                             | `"1"`                                                                |
| `fedify.inbox.recipient`              | string   | The identifier of the inbox recipient.                                                   | `"1"`                                                                |
| `fedify.object.type`                  | string   | The URI of the object type.                                                              | `"https://www.w3.org/ns/activitystreams#Note"`                       |
| `fedify.object.values.{parameter}`    | string[] | The argument values of the object dispatcher.                                            | `["1", "2"]`                                                         |
| `fedify.collection.cursor`            | string   | The cursor of the collection.                                                            | `"eyJpZCI6IjEiLCJ0eXBlIjoiT3JkZXJlZENvbGxlY3Rpb24ifQ=="`             |
| `fedify.collection.items`             | number   | The number of items in the collection page.  It can be less than the total items.        | `10`                                                                 |
| `http.redirect.url`                   | string   | The redirect URL when a document fetch results in a redirect.                            | `"https://example.com/new-location"`                                 |
| `http.response.status_code`           | int      | The HTTP response status code.                                                           | `200`                                                                |
| `http_signatures.signature`           | string   | The signature of the HTTP request in hexadecimal.                                        | `"73a74c990beabe6e59cc68f9c6db7811b59cbb22fd12dcffb3565b651540efe9"` |
| `http_signatures.algorithm`           | string   | The algorithm of the HTTP request signature.                                             | `"rsa-sha256"`                                                       |
| `http_signatures.key_id`              | string   | The public key ID of the HTTP request signature.                                         | `"https://example.com/actor/1#main-key"`                             |
| `http_signatures.digest.{algorithm}`  | string   | The digest of the HTTP request body in hexadecimal.  The `{algorithm}` is the digest algorithm (e.g., `sha`, `sha-256`). | `"d41d8cd98f00b204e9800998ecf8427e"` |
| `ld_signatures.key_id`                | string   | The public key ID of the Linked Data signature.                                          | `"https://example.com/actor/1#main-key"`                             |
| `ld_signatures.signature`             | string   | The signature of the Linked Data in hexadecimal.                                         | `"73a74c990beabe6e59cc68f9c6db7811b59cbb22fd12dcffb3565b651540efe9"` |
| `ld_signatures.type`                  | string   | The algorithm of the Linked Data signature.                                              | `"RsaSignature2017"`                                                 |
| `object_integrity_proofs.cryptosuite` | string   | The cryptographic suite of the object integrity proof.                                   | `"eddsa-jcs-2022"`                                                   |
| `object_integrity_proofs.key_id`      | string   | The public key ID of the object integrity proof.                                         | `"https://example.com/actor/1#main-key"`                             |
| `object_integrity_proofs.signature`   | string   | The integrity proof of the object in hexadecimal.                                        | `"73a74c990beabe6e59cc68f9c6db7811b59cbb22fd12dcffb3565b651540efe9"` |
| `url.full`                            | string   | The full URL being fetched by the document loader.                                       | `"https://example.com/actor/1"`                                      |
| `webfinger.resource`                  | string   | The queried resource URI.                                                                | `"acct:fedify@hollo.social"`                                         |
| `webfinger.resource.scheme`           | string   | The scheme of the queried resource URI.                                                  | `"acct"`                                                             |

[attributes]: https://opentelemetry.io/docs/specs/otel/common/#attribute
[OpenTelemetry Semantic Conventions]: https://opentelemetry.io/docs/specs/semconv/


Building observability tools with OpenTelemetry
------------------------------------------------

The OpenTelemetry instrumentation in Fedify provides a powerful foundation for
building custom observability tools.  By implementing a custom [SpanExporter],
you can capture and process all the telemetry data generated by Fedify to build
tools like debug dashboards, activity monitors, or analytics systems.

### Example: ActivityPub debug dashboard

Here's an example of how you might implement a custom `SpanExporter` to capture
ActivityPub activities for a debug dashboard:

~~~~ typescript
import type { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { ExportResultCode } from "@opentelemetry/core";

interface ActivityRecord {
  direction: "inbound" | "outbound";
  activity: unknown;
  timestamp: Date;
  verified?: boolean;
}

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
          this.activities.push({
            direction: "outbound",
            activity: JSON.parse(
              event.attributes["activitypub.activity.json"] as string
            ),
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

[SpanExporter]: https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_sdk_trace_base.SpanExporter.html


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

[`FedifySpanExporter`]: https://jsr.io/@fedify/fedify/doc/otel/~/FedifySpanExporter
