---
description: >-
  Fedify can expose cooperative benchmark endpoints for measuring federation
  workloads without requiring an external metrics backend.
---

Benchmarking
============

*This API is available since Fedify 2.3.0.*

Fedify can run as a cooperative benchmark target by enabling
`~FederationOptions.benchmarkMode`.  This mode exposes local benchmark
endpoints under `/.well-known/fedify/bench/` and configures an in-process
OpenTelemetry metrics reader so benchmark clients can collect server-side
measurements without a separate metrics backend.

> [!WARNING]
> Do not enable `benchmarkMode` in production.  It is intended for benchmark
> targets that you control.


Enabling benchmark mode
-----------------------

Set `benchmarkMode: true` when creating the `Federation` object:

~~~~ typescript twoslash
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation } from "@fedify/fedify";

const federation = createFederation<void>({
// ---cut-start---
  kv: null as unknown as KvStore,
// ---cut-end---
  benchmarkMode: true,
});
~~~~

When enabled, Fedify changes only benchmark-target defaults:

 -  `~FederationOptions.allowPrivateAddress` defaults to `true`, unless a
    custom document loader factory is configured.
 -  `~FederationOptions.signatureTimeWindow` defaults to `false`.
 -  Explicit `allowPrivateAddress` and `signatureTimeWindow` values still win.
 -  Inbox idempotency is unchanged.  Benchmark clients that need repeated
    deliveries should mint unique activity IDs.

If you provide `meterProvider` together with `benchmarkMode`, Fedify throws a
`TypeError`.  OpenTelemetry metric readers have to be attached when a
`MeterProvider` is constructed, so benchmark mode owns its in-process provider.


Benchmark stats endpoint
------------------------

`GET /.well-known/fedify/bench/stats` returns a versioned JSON snapshot of the
server-side metrics collected by the benchmark mode reader:

~~~~ json
{
  "version": 1,
  "source": "server",
  "generatedAt": "2026-06-02T00:00:00.000Z",
  "scopeMetrics": [],
  "errors": []
}
~~~~

The `scopeMetrics` field contains serialized OpenTelemetry scope metrics.
Observable queue depth is included when configured queues implement
`MessageQueue.getDepth()`.


Benchmark trigger endpoint
--------------------------

`POST /.well-known/fedify/bench/trigger` asks the target application to call
`Context.sendActivity()` with an explicit sender, recipients, and activity.
This exercises the target's normal outbox and queue path.

The request body has this shape:

~~~~ json
{
  "sender": { "identifier": "alice" },
  "sinks": ["https://sink.example/inbox"],
  "recipients": [
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Service",
      "id": "https://sink.example/actors/bob",
      "inbox": "https://sink.example/inbox"
    }
  ],
  "activity": {
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Create",
    "id": "https://example.com/activities/bench-1",
    "actor": "https://example.com/users/alice",
    "object": {
      "type": "Note",
      "id": "https://example.com/notes/bench-1",
      "content": "benchmark"
    }
  }
}
~~~~

The `sender` must be either `{ "identifier": string }` or
`{ "username": string }`.  Recipients are parsed as ActivityPub actors and must
have `id` and `inbox` properties.  The activity is parsed as an ActivityPub
`Activity`.

By default, every recipient inbox must appear in the `sinks` list.  This keeps
benchmark traffic pointed at benchmark sink inboxes.  To bypass this guard for
a controlled run, set `"allowUnsafeRecipients": true`.

A successful trigger returns `202 Accepted`:

~~~~ json
{
  "version": 1,
  "triggerId": "018f52d9-8cc2-7b9d-9f9a-f0d777dfc14b",
  "activityId": "https://example.com/activities/bench-1",
  "recipientCount": 1,
  "inboxCount": 1
}
~~~~


Metrics
-------

Benchmark mode uses the same Fedify metrics documented in
[*OpenTelemetry*](./opentelemetry.md), including queue task metrics, queue
depth, HTTP server metrics, and signature verification histograms.  The
benchmark endpoints themselves are classified as `fedify.endpoint=benchmark`
in `fedify.http.server.request.*` metrics.
