Fedify monitoring example
=========================

This example starts a local monitoring stack for Fedify OpenTelemetry metrics:

 -  OpenTelemetry Collector receives OTLP metrics on ports 4317 and 4318.
 -  Prometheus scrapes the Collector on port 9464 and loads example alert
    rules.
 -  Grafana starts on port 3000 with a provisioned Prometheus data source and
    the *Fedify overview* dashboard.
 -  A small Deno process emits synthetic Fedify-shaped metrics so the dashboard
    is populated immediately.

The sample process is not a Fedify application.  It exists only to make the
stack observable before you connect your own app.


Prerequisites
-------------

Install Docker Compose or a compatible implementation such as Podman Compose.
From the repository root, run:

~~~~ sh
docker compose -f examples/monitoring/compose.yaml up
~~~~

Then open:

 -  [Grafana]
 -  [Prometheus]
 -  [Collector Prometheus endpoint]

Grafana anonymous admin access is enabled for this local example only.  Do not
copy that authentication setting into production.

Stop the stack with:

~~~~ sh
docker compose -f examples/monitoring/compose.yaml down
~~~~

[Grafana]: http://localhost:3000/d/fedify-overview/fedify-overview
[Prometheus]: http://localhost:9090/
[Collector Prometheus endpoint]: http://localhost:9464/metrics


Validate the example
--------------------

The repository includes a validation script for the monitoring files:

~~~~ sh
mise run test:monitoring
~~~~

That command checks the Deno scripts, Docker Compose file, Prometheus config,
Prometheus alert rules and rule tests, and OpenTelemetry Collector config.

To also start the stack and verify that Prometheus, Grafana, the Collector
target, the provisioned dashboard, and the sample Fedify metrics are reachable:

~~~~ sh
deno run -A examples/monitoring/validate.ts --smoke
~~~~

The smoke test uses a separate Compose project name and tears the stack down
afterward.


Connect a Fedify app
--------------------

Leave the monitoring stack running and point your application at the Collector.
For a Deno 2.4 or later application, the built-in OpenTelemetry exporter is the
shortest path:

~~~~ sh
OTEL_DENO=1 \
OTEL_SERVICE_NAME=my-fedify-app \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
deno run --unstable-otel -A your_fedify_app.ts
~~~~

If your app runs in another Compose service on the same network, use the
service name instead of `localhost`:

~~~~ sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
~~~~

For Node.js, Bun, or a custom SDK setup, configure an OpenTelemetry
`MeterProvider` and an OTLP metrics exporter before starting the Fedify server.
Fedify uses the global meter provider by default for most metrics, or the
explicit `meterProvider` option passed to `createFederation()`.  Document
loader metrics (`activitypub.document.fetch`, `activitypub.document.cache`)
require an explicit `meterProvider`; see the [OpenTelemetry manual] for that
detail.

Once your app is exporting, you can stop the synthetic sample service:

~~~~ sh
docker compose -f examples/monitoring/compose.yaml stop sample-metrics
~~~~

[OpenTelemetry manual]: ../../docs/manual/opentelemetry.md


Metric compatibility
--------------------

This example is the runnable companion to the [production monitoring guide].
That guide explains why the dashboard groups by bounded labels such as
`fedify.endpoint`, `fedify.queue.role`, `activitypub.processing.result`,
`activitypub.lookup.result`, and `activitypub.remote.host`, while avoiding raw
actor IDs, object IDs, inbox URLs, and full route parameter values.

The dashboard and alert rules use the metric names documented in the
[OpenTelemetry manual].  They cover the Fedify metrics introduced and expanded
through the OpenTelemetry work tracked by issues such as [#316], [#619],
[#735], [#736], [#737], [#738], [#739], [#740], [#741], and [#742].

If you change the OpenTelemetry Collector Prometheus translation settings, or
if you export these metrics to a backend that keeps dots in metric and label
names, update the PromQL expressions accordingly.

[production monitoring guide]: ../../docs/manual/monitoring.md
[#316]: https://github.com/fedify-dev/fedify/issues/316
[#619]: https://github.com/fedify-dev/fedify/issues/619
[#735]: https://github.com/fedify-dev/fedify/issues/735
[#736]: https://github.com/fedify-dev/fedify/issues/736
[#737]: https://github.com/fedify-dev/fedify/issues/737
[#738]: https://github.com/fedify-dev/fedify/issues/738
[#739]: https://github.com/fedify-dev/fedify/issues/739
[#740]: https://github.com/fedify-dev/fedify/issues/740
[#741]: https://github.com/fedify-dev/fedify/issues/741
[#742]: https://github.com/fedify-dev/fedify/issues/742


What the dashboard shows
------------------------

The dashboard focuses on bounded, aggregate labels:

HTTP request performance
:   Request rate and p95 latency by `fedify.endpoint`.

Queue health
:   Queue depth, in-flight tasks, enqueue rate, completion rate, and task
    latency by `fedify.queue.role`.

Inbox processing
:   p95 listener processing latency and inbound activity outcomes.  With a
    queued inbox this measures worker side effects, not the remote server's
    HTTP wait time.

Outbound delivery
:   Outbox activity outcomes, delivery attempts split by success, failure
    ratio, and permanent failures by HTTP status.

Signature and lookup health
:   Signature verification latency, key-fetch latency, document and key lookup
    latency, lookup outcomes, verification failures, and public key lookup
    failures.

Peer discovery
:   WebFinger and actor discovery outcomes and p95 latency.

Resource context
:   Process memory and CPU metrics emitted by the sample process.  In a real
    deployment, replace or extend these panels with runtime, database, cache,
    queue backend, host, or platform metrics from your own instrumentation.

The dashboard deliberately avoids raw actor IDs, object IDs, inbox URLs, full
remote URLs, and route parameter values as labels.  Keep that property when
you adapt the JSON for your own deployment.


Alert rules
-----------

*prometheus-rules.yaml* contains starter rules for common Fedify production
symptoms:

 -  Collector target down.
 -  Missing Fedify metrics from an expected target.
 -  Queue falling behind.
 -  Queue depth above an example threshold.
 -  Outbound delivery failure ratio above 20%.
 -  Permanent delivery failures.
 -  Remote `404`/`410` spikes.
 -  Sustained inbox processing latency.
 -  Signature verification failures.
 -  Discovery and public key lookup failures.

The thresholds are examples, not Fedify defaults.  Watch normal traffic before
you page on these values in production.  Alerts that describe remote churn,
such as `404` and `410` spikes, are marked as investigation alerts rather than
paging alerts.


Troubleshooting
---------------

The dashboard is empty
:   Check [Prometheus targets].  The `otel-collector` target should be up.
    Then check whether `fedify_http_server_request_count_total` exists in
    Prometheus.  If it does not, confirm the app has OpenTelemetry enabled and
    is exporting to the [Collector OTLP endpoint].

`fedify.queue.depth` is missing
:   Queue depth is emitted only when the configured message queue backend
    implements `MessageQueue.getDepth()`.  Use the enqueue-versus-completion
    panels when depth is unavailable.

Ports are already in use
:   Edit *compose.yaml* and change the host-side ports.  The container
    ports should stay the same unless you also update the related config files.

Prometheus metric names look different
:   This example uses the Collector's default Prometheus translation, where
    dots become underscores, counters gain `_total`, and millisecond
    histograms gain `_milliseconds_bucket`, `_milliseconds_sum`, and
    `_milliseconds_count` series.  If you change Collector translation options,
    update dashboard and alert PromQL to match.

[Prometheus targets]: http://localhost:9090/targets
[Collector OTLP endpoint]: http://localhost:4318
