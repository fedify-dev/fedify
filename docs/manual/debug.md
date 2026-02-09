---
description: >-
  The @fedify/debugger package provides an embedded real-time debug dashboard
  for inspecting ActivityPub traces and activities in your federated server app.
---

Debugging
=========

*This API is available since Fedify 2.0.0.*

When developing a federated server app, it can be difficult to understand what
activities are being sent and received, and whether signatures are being
verified correctly.  The `@fedify/debugger` package provides an embedded
real-time debug dashboard that you can add to your app to inspect ActivityPub
traces and activities without leaving your browser.


Installation
------------

You need to install both `@fedify/debugger` and `@fedify/fedify` (which
includes the [OpenTelemetry] integration used for trace data):

::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/debugger npm:@opentelemetry/sdk-trace-base
~~~~

~~~~ bash [npm]
npm install @fedify/debugger @opentelemetry/sdk-trace-base
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/debugger @opentelemetry/sdk-trace-base
~~~~

~~~~ bash [Yarn]
yarn add @fedify/debugger @opentelemetry/sdk-trace-base
~~~~

~~~~ bash [Bun]
bun add @fedify/debugger @opentelemetry/sdk-trace-base
~~~~

:::

[OpenTelemetry]: ./opentelemetry.md


Setup
-----

The debugger works as a proxy that wraps your existing `Federation` object.
It intercepts HTTP requests matching a configurable path prefix and serves
the debug dashboard, while delegating everything else to the inner federation.

To set it up, you need to:

1.  Create a `FedifySpanExporter` (from `@fedify/fedify/otel`) that captures
    trace data
2.  Create a `BasicTracerProvider` (from `@opentelemetry/sdk-trace-base`)
    that uses the exporter
3.  Pass it to `createFederationDebugger()` along with your federation object

Here is a basic example:

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { FedifySpanExporter } from "@fedify/fedify/otel";
import { createFederationDebugger } from "@fedify/debugger";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

// Create a KV store and a span exporter that captures trace data:
const kv = new MemoryKvStore();
const exporter = new FedifySpanExporter(kv);
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

const innerFederation = createFederation({
  kv,
  tracerProvider,
  // ... other federation options
});

// Wrap the federation with the debugger:
const federation = createFederationDebugger(innerFederation, {
  exporter,
});
~~~~

The `federation` object returned by `createFederationDebugger()` is a drop-in
replacement for the original.  You can use it everywhere you would normally use
the inner federation object (e.g., passing it to framework integrations).

> [!WARNING]
> The debug dashboard is intended for development use only.  Do not enable it
> in production, as it exposes internal trace data without authentication.


Configuration
-------------

The `createFederationDebugger()` function accepts the following options:

### `path`

The path prefix for the debug dashboard.  Defaults to `"/__debug__"`.
All dashboard routes are served under this prefix.

For example, if you set `path` to `"/_debug"`, the dashboard will be available
at `/_debug/` and traces at `/_debug/traces/:traceId`.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { FedifySpanExporter } from "@fedify/fedify/otel";
import { createFederationDebugger } from "@fedify/debugger";

const kv = new MemoryKvStore();
const exporter = new FedifySpanExporter(kv);
const innerFederation = createFederation({ kv });
// ---cut-before---
const federation = createFederationDebugger(innerFederation, {
  exporter,
  path: "/_debug",
});
~~~~

### `exporter`

*Required.*  A `FedifySpanExporter` instance that the dashboard queries for
trace data.  You should use the same exporter instance that your OpenTelemetry
setup is configured with, so the dashboard reflects the same data.


Dashboard pages
---------------

Once set up, the debug dashboard is accessible at the configured path prefix
(default: `/__debug__/`).

### Traces list

The root page (`/__debug__/`) shows a list of all captured traces.  For each
trace, it displays:

 -  **Trace ID** (first 8 characters, linked to the detail page)
 -  **Activity types** present in the trace (e.g., Create, Follow, Like)
 -  **Activity count**
 -  **Timestamp**

The page automatically polls the JSON API every 3 seconds and refreshes when
new traces are detected.

### Trace detail

The trace detail page (`/__debug__/traces/:traceId`) shows all activities
belonging to a specific trace.  For each activity, it displays:

 -  **Direction** (inbound or outbound)
 -  **Activity type** (e.g., Create, Accept, Follow)
 -  **Span ID** and optional parent span ID
 -  **Activity ID** (if present)
 -  **Actor ID**
 -  **Timestamp**
 -  **Inbox URL** (for outbound activities)
 -  **Signature verification** details (for inbound activities):
     -  Whether HTTP Signatures were verified
     -  The key ID used for verification
     -  Whether Linked Data Signatures were verified
 -  **Activity JSON** (expandable, pretty-printed)

### JSON API

A JSON API endpoint is available at `/__debug__/api/traces` which returns
the list of recent traces in JSON format.  This is used by the auto-polling
mechanism on the traces list page, but you can also query it directly for
programmatic access.


Using with framework integrations
---------------------------------

The debugger works with any framework integration that accepts a `Federation`
object.  Simply wrap the federation before passing it to your integration:

### Hono

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { FedifySpanExporter } from "@fedify/fedify/otel";
import { createFederationDebugger } from "@fedify/debugger";
import { federation as honoFederation } from "@fedify/hono";
import { Hono } from "hono";

const kv = new MemoryKvStore();
const exporter = new FedifySpanExporter(kv);
const innerFederation = createFederation({ kv });
const federation = createFederationDebugger(innerFederation, { exporter });

const app = new Hono();
app.use(honoFederation(federation, (_) => undefined));
~~~~

### Express

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { FedifySpanExporter } from "@fedify/fedify/otel";
import { createFederationDebugger } from "@fedify/debugger";
import { integrateFederation } from "@fedify/express";
import express from "express";

const kv = new MemoryKvStore();
const exporter = new FedifySpanExporter(kv);
const innerFederation = createFederation({ kv });
const federation = createFederationDebugger(innerFederation, { exporter });

const app = express();
app.use(integrateFederation(federation, (req) => undefined));
~~~~
