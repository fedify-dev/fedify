---
description: >-
  A production monitoring guide for Fedify applications.  Turns Fedify's
  OpenTelemetry metrics into a first federation-health dashboard and a set of
  alert rules, with guidance on metric cardinality and on where Fedify's
  metrics end and the runtime, database, queue backend, and host platform
  begin.
---

Production monitoring
=====================

*The metrics this guide relies on are available since Fedify 2.3.0.*

Federation failures are quiet.  An outbox that falls behind, a remote server
that starts rejecting your signatures, a worker that stops draining the queue:
none of these necessarily trip a plain HTTP health check, and the trust-cache
divergence they cause between your server and its peers is hard to untangle
after the fact.  The
[*Observability in production*](./deploy.md#observability-in-production)
section of the *Deployment* guide names the signals that matter.  This guide
connects Fedify's
[OpenTelemetry metrics](./opentelemetry.md#instrumented-metrics) to the
questions an operator actually asks during an incident, and shows how to put
them on a dashboard and behind an alert.

The examples use [Prometheus] and the [OpenTelemetry Collector] because they
are the integration points most backends share, not because Fedify prefers
them.  Everything here applies to any backend that ingests OTLP or scrapes
Prometheus; where a vendor's setup begins, this guide stops and points you at
their documentation.
The [runnable monitoring example] packages the Collector, Prometheus, Grafana,
alert rules, dashboard provisioning, and a small synthetic metric source into a
Docker Compose stack you can start locally.

[Prometheus]: https://prometheus.io/
[OpenTelemetry Collector]: https://opentelemetry.io/docs/collector/
[runnable monitoring example]: https://github.com/fedify-dev/fedify/tree/main/examples/monitoring


Before you begin
----------------

This guide assumes metrics are already flowing out of your application.  If
they are not, set up the OpenTelemetry SDK first; the [*OpenTelemetry*
chapter](./opentelemetry.md) covers the [`MeterProvider`
configuration](./opentelemetry.md#explicit-meterprovider-configuration) and the
[full list of instrumented metrics](./opentelemetry.md#instrumented-metrics),
their attributes, and their cardinality guarantees.  On Deno 2.4 and later,
`OTEL_DENO=1` exports metrics without any manual SDK wiring.

Two metrics are conditional, and a first dashboard should account for both:

`fedify.queue.depth`
:   Reported only when the queue backend implements
    [`MessageQueue.getDepth()`](./mq.md#queue-depth-reporting).  The Redis,
    PostgreSQL, MySQL, SQLite, AMQP, and in-process backends report it; the
    Deno KV and Cloudflare Workers backends return no reliable platform count,
    so the gauge will be absent there.  Where depth is unavailable, the
    enqueue-versus-completion throughput comparison shown
    [below](#queue-backlog) gives you the same falling-behind signal.

`activitypub.document.fetch` and `activitypub.document.cache`
:   Emitted only when you pass a `meterProvider` explicitly to
    `createFederation()`, for the reason explained in the [*OpenTelemetry*
    chapter](./opentelemetry.md#explicit-meterprovider-configuration).  They do
    not appear on the dashboard below, but they are useful when remote document
    fetches dominate your inbox latency.


Getting metrics into Prometheus
-------------------------------

### An OpenTelemetry Collector pipeline

The Collector sits between your application and your metrics backend.  Fedify
records the metrics; your application's OpenTelemetry SDK pushes them to the
Collector over OTLP, and the Collector either exposes a Prometheus scrape
endpoint or forwards the data onward over OTLP.  A single pipeline can do both.

~~~~ yaml [otel-collector-config.yaml]
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch: {}

exporters:
  # Expose a /metrics endpoint for Prometheus to scrape.
  prometheus:
    endpoint: 0.0.0.0:9464
    # add_metric_suffixes defaults to true; see the naming note below.

  # Or forward to any OTLP-speaking backend instead of (or as well as) scraping.
  otlphttp:
    endpoint: https://otlp.your-backend.example

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]        # add otlphttp here to do both
~~~~

Point the application at the Collector with the standard environment
variable, and the SDK does the rest:

~~~~ sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
~~~~

Prometheus then scrapes the Collector at `otel-collector:9464`.  A managed
backend (Grafana Cloud, Honeycomb, Datadog, and others) usually accepts OTLP
directly, in which case you swap the `prometheus` exporter for `otlphttp` and
skip the scrape entirely.  Either way, the rest of this guide is the same; only
the names you type into the query bar differ, which is the subject of the next
section.

### How the metric names appear once scraped

OpenTelemetry metric names and Prometheus metric names are not spelled the
same way.  When the Collector's `prometheus` exporter (or Prometheus's own OTLP
ingestion) translates them, three things happen with the default settings:

 -  Dots become underscores, in both metric names and attribute (label) names.
    `activitypub.remote.host` becomes the label `activitypub_remote_host`.
 -  The unit is appended to the name.  The `ms` unit becomes a `_milliseconds`
    suffix; annotation units written in curly braces (`{request}`, `{task}`,
    `{message}`) are dropped, not appended.
 -  Counters gain a `_total` suffix, and each histogram expands into
    `_bucket`, `_sum`, and `_count` series.

So the metrics you query look like this:

| OpenTelemetry metric                          | Instrument      | Prometheus time series                                                        |
| --------------------------------------------- | --------------- | ----------------------------------------------------------------------------- |
| `activitypub.delivery.sent`                   | counter         | `activitypub_delivery_sent_total`                                             |
| `activitypub.delivery.permanent_failure`      | counter         | `activitypub_delivery_permanent_failure_total`                                |
| `activitypub.delivery.duration`               | histogram       | `activitypub_delivery_duration_milliseconds_{bucket,sum,count}`               |
| `activitypub.inbox.processing_duration`       | histogram       | `activitypub_inbox_processing_duration_milliseconds_{bucket,sum,count}`       |
| `activitypub.signature.verification_failure`  | counter         | `activitypub_signature_verification_failure_total`                            |
| `activitypub.signature.verification.duration` | histogram       | `activitypub_signature_verification_duration_milliseconds_{bucket,sum,count}` |
| `activitypub.signature.key_fetch.duration`    | histogram       | `activitypub_signature_key_fetch_duration_milliseconds_{bucket,sum,count}`    |
| `fedify.queue.task.enqueued`                  | counter         | `fedify_queue_task_enqueued_total`                                            |
| `fedify.queue.task.completed`                 | counter         | `fedify_queue_task_completed_total`                                           |
| `fedify.queue.task.in_flight`                 | up down counter | `fedify_queue_task_in_flight`                                                 |
| `fedify.queue.depth`                          | gauge           | `fedify_queue_depth`                                                          |

> [!NOTE]
> The exact names depend on how your pipeline is configured.  Disabling unit
> and type suffixes on the Collector's `prometheus` exporter drops the `_total`
> and `_milliseconds` segments, and a non-default name-translation strategy
> (the ones that preserve UTF-8 names) can keep the dots instead of converting
> them to underscores.  When a query returns nothing, check the actual series
> names against the Collector's `/metrics` output or your backend's metric
> explorer before assuming the metric is missing.  The examples below assume
> the default translation.


A first federation dashboard
----------------------------

Six panels are enough for a first pass at federation health.  Each one answers
a question you would otherwise have to reconstruct from traces or logs after
something has already gone wrong.

### Queue backlog

*Are outgoing and incoming activities draining as fast as they arrive?*

Where the backend reports depth, plot `fedify_queue_depth` for the `queued`
state, broken out by role.  The `queued` state is the total of waiting
messages, so query it alone rather than summing `queued`, `ready`, and
`delayed`, which would count the same backlog more than once:

~~~~ promql
max by (fedify_queue_role) (fedify_queue_depth{fedify_queue_depth_state="queued"})
~~~~

Use `max` here, not `sum`.  When several observers report the same queue,
whether that is multiple replicas behind a shared Redis or PostgreSQL backend
or several `Federation` instances sharing one `MeterProvider`, each one reads
the backend's full depth rather than a private shard.  Summing multiplies the
backlog by the number of observers and makes every depth alert page early;
`max` reads the true depth.  Sum only when each instance owns a separate queue
backend.

Pair it with how many tasks each process is actively working, which is a
gauge-like UpDownCounter and is reported per process, so sum it across replicas:

~~~~ promql
sum by (fedify_queue_role) (fedify_queue_task_in_flight)
~~~~

When the backend reports no depth (Deno KV, Cloudflare Workers), or as a
second opinion when it does, watch the throughput balance instead.  Enqueue
rate running consistently above completion rate is the definition of falling
behind:

~~~~ promql
sum by (fedify_queue_role) (rate(fedify_queue_task_enqueued_total[5m]))
  - sum by (fedify_queue_role) (rate(fedify_queue_task_completed_total[5m]))
~~~~

A backlog that empties during quiet periods is healthy.  One that never
returns to zero overnight means you are permanently behind and need more
worker capacity or a faster backend, not a higher alert threshold.

### Inbox processing latency

*How long does it take to finish the side effects of an incoming activity?*

`activitypub.inbox.processing_duration` measures the listener's own work.  Read
it as a high percentile rather than an average.  When an inbox `queue` is
configured, that work runs in the queue worker after Fedify has already
answered the remote with `202 Accepted`, so a slow tail here means slow side
effects, not remote servers waiting on you.  The latency a remote actually
experiences lives on `fedify.http.server.request.duration` for the inbox
endpoints; only with inline (no-queue) listeners do the two coincide.

~~~~ promql
histogram_quantile(
  0.95,
  sum by (le) (rate(activitypub_inbox_processing_duration_milliseconds_bucket[5m]))
)
~~~~

Spikes here usually trace back to one of two causes: a queue backlog upstream,
or a slow dependency inside the listener (a database write, a remote key fetch
during signature verification).  The signature-latency panel below helps
separate the second case from the first.

### Outbound delivery attempts

*How much delivery work is happening, and how much of it succeeds?*

`activitypub.delivery.sent` counts every per-recipient attempt and carries an
`activitypub_delivery_success` label, so one expression gives you both volume
and the success split:

~~~~ promql
sum by (activitypub_delivery_success) (rate(activitypub_delivery_sent_total[5m]))
~~~~

### Outbound delivery failure rate

*What fraction of delivery attempts are failing right now?*

The failed-attempt fraction is the per-attempt complement of the success rate
that the *Deployment* guide calls out as a core federation signal:

~~~~ promql
sum(rate(activitypub_delivery_sent_total{activitypub_delivery_success="false"}[5m]))
  / sum(rate(activitypub_delivery_sent_total[5m]))
~~~~

Keep this distinct from permanent failures.  A failed attempt is usually
transient and will be retried; the next panel counts only the deliveries a
remote rejected with a permanent-failure status.  A failure fraction that
climbs from a few percent toward a fifth or more, across many remote hosts at
once, points at your own outbound path (DNS, egress, a misconfigured proxy)
rather than at any single peer.

### Permanent delivery failures

*Which deliveries did a remote reject with a permanent-failure status?*

`activitypub.delivery.permanent_failure` increments once per recipient that a
remote rejected with a permanent-failure status, with that status code
attached:

~~~~ promql
sum by (http_response_status_code) (
  rate(activitypub_delivery_permanent_failure_total[5m])
)
~~~~

The `404` and `410` rows are the fediverse's normal background churn (see the
[alerting section](#spikes-in-remote-404-and-410-responses) for why they rarely
deserve a page).  Other codes are worth a closer look: a sustained band of
permanent failures on an unusual status often means one large instance has
changed how it rejects you.

This counter only sees deliveries a remote rejected with a permanent-failure
status code (`404` and `410` by default, plus anything you add to
`~FederationOptions.permanentFailureStatusCodes`).  Deliveries Fedify abandons
after its outbox retry policy exhausts on transport errors or transient `5xx`
responses land on `activitypub.outbox.activity` with
`activitypub.processing.result="abandoned"` instead.  Add that series to see
every dropped delivery, not just the status-coded ones:

~~~~ promql
sum(rate(activitypub_outbox_activity_total{activitypub_processing_result="abandoned"}[5m]))
~~~~

### Signature verification latency

*How long does verifying an inbound signature take, and where does the time
go?*

`activitypub.signature.verification.duration` covers the whole verification
path, including any remote key fetch, and splits cleanly by signature kind:

~~~~ promql
histogram_quantile(
  0.95,
  sum by (le, activitypub_signature_kind)
    (rate(activitypub_signature_verification_duration_milliseconds_bucket[5m]))
)
~~~~

If the total looks slow, compare it against
`activitypub_signature_key_fetch_duration_milliseconds_bucket`, which isolates
the key-lookup portion.  When key fetches dominate, the problem is a slow or
flaky remote key host or a cold key cache, not your verification code.


Alerting
--------

The thresholds below are starting points, not defaults.  The right number for
a queue backlog or a latency percentile depends on your traffic shape, your
worker count, and how much delay your users tolerate, and the only way to find
it is to watch the dashboard for a week or two first.  Treat every figure here
as a placeholder to replace once you know what normal looks like on your
server.

Examples are written as Prometheus alerting rules.  The expressions translate
directly to any backend with a comparable rule language.

### Growing queue backlog

A queue that is falling behind is the earliest warning that worker capacity
cannot keep up.  Alert on the throughput deficit rather than an absolute depth,
because the deficit works on every backend and does not need retuning when
traffic grows:

~~~~ yaml
- alert: FedifyQueueFallingBehind
  expr: |
    sum by (fedify_queue_role) (rate(fedify_queue_task_enqueued_total[10m]))
      - (
          sum by (fedify_queue_role) (rate(fedify_queue_task_completed_total[10m]))
            or sum by (fedify_queue_role) (rate(fedify_queue_task_enqueued_total[10m])) * 0
        )
      > 0
  for: 30m
  annotations:
    summary: "Fedify {{ $labels.fedify_queue_role }} queue is not draining"
~~~~

The `or … * 0` term is not decoration.  When a role's workers stall outright,
its `fedify_queue_task_completed_total` series can stop existing, and a plain
`enqueued > completed` comparison would then match nothing and stay silent in
exactly the case you most want to catch.  Substituting a zero-valued series
keeps the role in the result so the deficit still fires.  The `for: 30m` clause
does the rest of the work: short bursts where enqueues briefly outpace
completions are normal under load, and you only want to hear about a deficit
that persists long enough to mean the queue will not recover on its own.  Where
the backend reports depth, an absolute
`fedify_queue_depth{fedify_queue_depth_state="queued"}` ceiling makes a useful
second alert once you know your steady-state depth.

### Outbound delivery failure spike

A failure fraction that stays high across many peers indicates a problem on
your side of the network:

~~~~ yaml
- alert: FedifyOutboundDeliveryFailing
  expr: |
    sum(rate(activitypub_delivery_sent_total{activitypub_delivery_success="false"}[5m]))
      / sum(rate(activitypub_delivery_sent_total[5m]))
      > 0.2
  for: 10m
  annotations:
    summary: "Over 20% of outbound delivery attempts are failing"
~~~~

### Sustained inbox latency

A single slow request is noise; a high percentile that stays elevated means
side-effect processing is backing up, usually behind a slow database write or
a remote key fetch during verification.  Behind an inbox queue this latency is
decoupled from what remote servers wait on, so pair it with a
`fedify.http.server.request.duration` alert on the inbox endpoints to catch
remote-facing slowness too:

~~~~ yaml
- alert: FedifyInboxLatencyHigh
  expr: |
    histogram_quantile(0.95,
      sum by (le) (rate(activitypub_inbox_processing_duration_milliseconds_bucket[5m]))
    ) > 2000
  for: 15m
  annotations:
    summary: "Inbox processing p95 above 2s for 15 minutes"
~~~~

### Spikes in remote 404 and 410 responses

`404 Not Found` and `410 Gone` from remote inboxes are ordinary fediverse
behavior: accounts get deleted, instances shut down, paths change.  Fedify's
default `~FederationOptions.permanentFailureStatusCodes` already stops retrying
them, so a steady trickle needs no human at all.  A *spike* is worth knowing
about, because it usually means a large instance you federate with has gone
away or restructured its URLs, and you may want to prune orphaned follower
records.  Route this to a ticket or a chat channel, not to a pager:

~~~~ yaml
- alert: FedifyRemoteGoneSpike
  expr: |
    sum(increase(activitypub_delivery_permanent_failure_total{
      http_response_status_code=~"404|410"
    }[1h])) > 50
  labels:
    severity: ticket
  annotations:
    summary: "Elevated 404/410 from remote inboxes; check for a departed instance"
~~~~

The one-hour lookback is deliberate.  When a large instance disappears, Fedify
records a short burst of `404`/`410` permanent failures and then stops retrying
them, so a narrow window paired with a long `for` clause would let the burst
age out before the alert ever became eligible to fire.  Counting over a full
hour with no `for` catches the burst, then clears itself once it ages out.  The
`severity: ticket` label keeps it off the pager: nothing here is broken on your
server, and this is an invitation to investigate, not an incident.

### Signature verification failures

A failed signature verification means Fedify rejected an inbound activity.  A
handful from one misbehaving remote is expected.  A broad, sudden rise across
many peers usually has a cause on your end: clock drift pushing signatures
outside `~FederationOptions.signatureTimeWindow` (see [*Handling inbound
failures*](./deploy.md#handling-inbound-failures) in the *Deployment* guide), or
an actor key that was rotated without keeping the old key served during the
transition.  Break the alert down by reason so the two cases stay separable:

~~~~ yaml
- alert: FedifySignatureVerificationFailures
  expr: |
    sum by (activitypub_verification_failure_reason) (
      increase(activitypub_signature_verification_failure_total[5m])
    ) > 10
  for: 15m
  annotations:
    summary: "Sustained signature verification failures ({{ $labels.activitypub_verification_failure_reason }})"
~~~~

A `keyFetchError` reason points outward, at a remote key host you could not
reach.  A signature mismatch that suddenly affects everyone points inward, at
your clock or your keys, and is the one to escalate.


Keeping metric cardinality bounded
----------------------------------

High metric cardinality is a real hazard in federation code, because the raw
material (actor IDs, object IDs, inbox URLs, remote URLs) is unbounded and
attacker-influenced.  Fedify's metrics are designed to stay bounded: they never
attach a raw URL, actor ID, object ID, or inbox URL as a label, and the
attributes they do attach come from small fixed enumerations.  The relevant
work for a dashboard or alert author is mostly to not undo that.

`activitypub_remote_host` is the one label whose *set of values* grows with the
fediverse.  Fedify normalizes each value to a hostname plus any non-default
port, with no path or query string, so a single remote cannot create more than
one series.  The number of remote hosts you talk to, though, is as large as
your federation graph.  Aggregate this label away by default, and break it out
only when you are investigating a specific problem:

~~~~ promql
# For a dashboard: total, host-independent.
sum(rate(activitypub_delivery_permanent_failure_total[5m]))

# For an investigation: the ten worst hosts, bounded by topk.
topk(10, sum by (activitypub_remote_host) (
  rate(activitypub_delivery_permanent_failure_total{http_response_status_code=~"404|410"}[1h])
))
~~~~

`activitypub_activity_type` is bounded in practice to the ActivityStreams
vocabulary, but the value originates in remote-supplied documents.  If you ever
see its series count climb (an instance probing you with unusual or extension
types, for example), aggregate it away in the affected panels or drop it with a
`metric_relabel_config` at scrape time.

The same discipline applies to anything you build on top of these metrics.
Recording rules, relabeling, and derived metrics should never reintroduce an
identifier or URL that Fedify deliberately kept out.  When you need the full
URL, actor ID, or key ID to debug a specific event, it is on the corresponding
[span](./opentelemetry.md#instrumented-spans), where sampling keeps the
cardinality cost contained, not on the metric.


Where Fedify's metrics stop
---------------------------

Fedify instruments federation: delivery, inbox and outbox processing,
signatures, key and document lookups, collections, WebFinger, and its own queue
workers.  It does not, and should not, measure the layers beneath it.  A
complete production view needs those layers too, from sources Fedify has no part
in:

Process and runtime
:   CPU, resident memory, heap usage, event-loop lag, and garbage-collection
    pauses.  These come from runtime instrumentation:
    `@opentelemetry/instrumentation-runtime-node` on Node.js, the built-in
    exporter on Deno (`OTEL_DENO=1`), and the equivalent for Bun.

Database and cache backend
:   Connection-pool saturation, PostgreSQL query latency, Redis command
    latency.  A pool exhausted behind your KV store or message queue looks,
    from Fedify's side, exactly like a slow queue; you need the backend's own
    metrics (from `postgres_exporter`, `redis_exporter`, or the driver's
    instrumentation) to tell the two apart.

Queue backend internals
:   `fedify.queue.depth` reports what the backend tells Fedify through
    `getDepth()`.  The broker's own view (RabbitMQ's management metrics,
    Redis keyspace stats, a cloud queue's console) is separate, often richer,
    and the place to look when depth alone does not explain a stall.

Host and platform
:   Disk, network, container CPU and memory limits.  These come from a host
    metrics agent (`node_exporter`, the Collector's `hostmetrics` receiver,
    cAdvisor) or from your platform's built-in monitoring.

The Collector is a convenient place to gather several of these at once.  Adding
a `hostmetrics` receiver to the pipeline above, alongside `otlp`, pulls host
signals through the same export path as Fedify's application metrics, so they
land in one backend and one dashboard.

Get them in place before you serve real traffic.  The [*Deployment*
guide](./deploy.md#observability-in-production) folds them into the same
pre-launch checklist as the federation signals on this page.
