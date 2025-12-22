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
| `activitypub.send_activity`                         | Client      | Sends the ActivityPub activity.               |
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
| `activitypub.collection.id`           | string   | The URI of the collection object.                                                        | `"https://example.com/collection/1"`                                 |
| `activitypub.collection.type`         | string[] | The qualified URI(s) of the collection type(s).                                          | `["https://www.w3.org/ns/activitystreams#OrderedCollection"]`        |
| `activitypub.collection.total_items`  | int      | The total number of items in the collection.                                             | `42`                                                                 |
| `activitypub.object.id`               | string   | The URI of the object or the object enclosed by the activity.                            | `"https://example.com/object/1"`                                     |
| `activitypub.object.type`             | string[] | The qualified URI(s) of the object type(s).                                              | `["https://www.w3.org/ns/activitystreams#Note"]`                     |
| `activitypub.object.in_reply_to`      | string[] | The URI(s) of the original object to which the object reply.                             | `["https://example.com/object/1"]`                                   |
| `activitypub.inboxes`                 | int      | The number of inboxes the activity is sent to.                                           | `12`                                                                 |
| `activitypub.shared_inbox`            | boolean  | Whether the activity is sent to the shared inbox.                                        | `true`                                                               |
| `fedify.actor.identifier`             | string   | The identifier of the actor.                                                             | `"1"`                                                                |
| `fedify.inbox.recipient`              | string   | The identifier of the inbox recipient.                                                   | `"1"`                                                                |
| `fedify.object.type`                  | string   | The URI of the object type.                                                              | `"https://www.w3.org/ns/activitystreams#Note"`                       |
| `fedify.object.values.{parameter}`    | string[] | The argument values of the object dispatcher.                                            | `["1", "2"]`                                                         |
| `fedify.collection.cursor`            | string   | The cursor of the collection.                                                            | `"eyJpZCI6IjEiLCJ0eXBlIjoiT3JkZXJlZENvbGxlY3Rpb24ifQ=="`             |
| `fedify.collection.items`             | number   | The number of items in the collection page.  It can be less than the total items.        | `10`                                                                 |
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
| `webfinger.resource`                  | string   | The queried resource URI.                                                                | `"acct:fedify@hollo.social"`                                         |
| `webfinger.resource.scheme`           | string   | The scheme of the queried resource URI.                                                  | `"acct"`                                                             |

[attributes]: https://opentelemetry.io/docs/specs/otel/common/#attribute
[OpenTelemetry Semantic Conventions]: https://opentelemetry.io/docs/specs/semconv/
