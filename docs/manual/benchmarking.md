---
description: >-
  Fedify can run as a cooperative benchmark target, and the fedify bench command
  drives ActivityPub-specific load against it to measure federation workloads
  without requiring an external metrics backend.
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

Enable `benchmarkMode` when creating the `Federation` object.  If you use the
benchmark trigger endpoint, configure the sink inboxes on the server:

~~~~ typescript twoslash
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation } from "@fedify/fedify";

const federation = createFederation<void>({
// ---cut-start---
  kv: null as unknown as KvStore,
// ---cut-end---
  benchmarkMode: {
    triggerSinks: ["https://sink.example/inbox"],
  },
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

If the same application code sometimes runs with benchmark mode and sometimes
runs with your normal OpenTelemetry pipeline, pass your application
`meterProvider` only when benchmark mode is off:

~~~~ typescript twoslash
import type { KvStore } from "@fedify/fedify";
import type { MeterProvider } from "@opentelemetry/api";
// ---cut-start---
declare const process: { env: Record<string, string | undefined> };
const kv = null as unknown as KvStore;
const meterProvider = null as unknown as MeterProvider;
// ---cut-end---
import { createFederation } from "@fedify/fedify";

const benchmarkEnabled = process.env.FEDIFY_BENCHMARK === "1";

const federation = createFederation<void>({
  kv,
  benchmarkMode: benchmarkEnabled
    ? { triggerSinks: ["https://sink.example/inbox"] }
    : false,
  meterProvider: benchmarkEnabled ? undefined : meterProvider,
});
~~~~


The `fedify bench` command
--------------------------

*This command is available since Fedify 2.3.0.*

Once a target runs in benchmark mode, the `fedify bench` command drives
ActivityPub-specific load against it and reports latency, throughput, success
rate, and errors.  It acts as a synthetic remote actor: it generates keys,
serves its own actor and key documents over loopback, and signs every inbox
delivery with the same `@fedify/fedify` signer a real peer uses, so the measured
crypto cost is real.

> [!NOTE]
> This version runs the `inbox` and `webfinger` scenario types.  The scenario
> format can express the others (`actor`, `object`, `fanout`, `collection`,
> `failure`, and `mixed`), but they are not executed yet.  Within the runnable
> types, a few options the format accepts are also not implemented yet and are
> rejected up front with a clear message:
>
>  -  `runs` greater than `1` (repeated runs).
>  -  An `inbox` `activity` that is not a `Create` carrying an embedded `Note`;
>     that is, a non-`Create` `type`, a non-`Note` `object.type`, or
>     `embedObject: false`.
>  -  A `warmup` that is not shorter than the `duration` (which would leave no
>     measured window).

### A scenario suite

A benchmark is described by a *suite* file in YAML (JSON works too, since YAML
is a superset).  The suite declares the `target`, shared `defaults`, the
`actors` to sign as, and a list of `scenarios`, each with an optional `expect`
block of pass/fail thresholds:

~~~~ yaml
# yaml-language-server: $schema=https://json-schema.fedify.dev/bench/scenario-v1.json
version: 1
target: http://localhost:3000
defaults:
  duration: 30s
  warmup: 5s            # excluded from results; also warms the key cache
  load:
    rate: 200/s         # open-loop; or closed-loop with `concurrency: 50`
actors:
- count: 3
  signatureStandards: [draft-cavage-http-signatures-12, ld-signatures]
scenarios:
- name: inbox-shared
  type: inbox
  recipient: "http://${{ target.host }}/users/alice"
  inbox: shared
  activity:
    type: Create
    object:
      type: Note
      content: { generate: lorem, size: 2KB }
  expect:
    successRate: ">= 99%"
    latency.p95: "< 100ms"
~~~~

Run it against the target and read the terminal report:

~~~~ sh
fedify bench scenario.yaml
~~~~

The `# yaml-language-server:` line gives editors autocomplete and validation
against the [published schema].
Override the file's target with `--target`, choose the output with
`--format`/`--output`, and inspect a run without sending anything with
`--dry-run`.

An `inbox` scenario's `recipient` may be a single value or a list.  With a
list, deliveries are rotated across the recipients (and across the synthetic
`actors` signing them), modeling a server that receives from many peers into
many local inboxes.

[published schema]: https://json-schema.fedify.dev/bench/scenario-v1.json

### Actors

You pick signature *standards*, not key algorithms; the key set is derived,
because a Fedify actor is inherently multi-key.  An actor uses exactly one HTTP
request signature scheme, plus any document signature schemes:

| Standard                          | Layer        | Algorithm                  |
| --------------------------------- | ------------ | -------------------------- |
| `draft-cavage-http-signatures-12` | HTTP request | RSA                        |
| `rfc9421`                         | HTTP request | RSA                        |
| `ld-signatures`                   | document     | RSA (`RsaSignature2017`)   |
| `fep8b32`                         | document     | Ed25519 (`eddsa-jcs-2022`) |

`draft-cavage-http-signatures-12` and `rfc9421` are mutually exclusive (one HTTP
scheme per actor).  Several actor groups with different standard sets model a
heterogeneous fleet, which is what a server actually receives.

### Templating

Values support GitHub-Actions-style templating, written with double-brace
delimiters and kept logic-less: references and whitelisted helper calls only, no
arbitrary code.  The `recipient` line in the example suite above uses one to
build the actor URI from the target's host.  Generated payloads use typed
directives such as `content: { generate: lorem, size: 2KB }` rather than string
templates.  The tool owns actor URLs and activity ids, so each request gets a
unique activity id automatically (which Fedify's always-on inbox idempotency
requires).

### Load generation and signing

Open-loop (`rate`) is the default and the realistic model for incoming
federation traffic: requests are launched on schedule regardless of when earlier
responses return, and each request's latency is measured from its scheduled
time (the coordinated-omission correction), so a stalled target shows up as
latency instead of being hidden.  Closed-loop (`concurrency`) runs a fixed
number of virtual users.  Arrival is `constant` (default) or `poisson`, and
`maxInFlight` caps concurrent in-flight requests.

Signing is kept off the send critical path, set per scenario with `signing`:

 -  `pipeline` (default): background signers keep a bounded buffer filled, and
    buffer starvation surfaces the client as the bottleneck.
 -  `jit`: sign in the send path, for a strict signature-time-window target.
 -  `presign`: pre-sign an estimated open-loop run before the timed window
    (open-loop only; Poisson arrivals may still sign a few extra during the
    run).

### Output

Choose the format with `--format text` (default), `json`, or `markdown`;
`--output` only chooses the destination (a file instead of standard output) and
does not infer the format, so pass both (for example
`--format json --output report.json`).  JSON is the canonical machine form: it
validates against the [report schema] and carries
its own `$schema`; the text and Markdown renderers derive from the same model,
keeping client-measured and server-reported numbers distinct.  Both sides are
scoped to a measured window: client latency excludes warm-up samples, and the
server-reported numbers are the difference between a `stats` snapshot taken when
the measured window opens and one taken when it closes, so they exclude every
earlier scenario in the suite and the scenario's own warm-up traffic (apart from
warm-up requests still in flight at the boundary, a residue no larger than the
number of requests in flight at that moment).  In GitHub Actions, append the
Markdown report to the job summary:

~~~~ sh
fedify bench scenario.yaml --format markdown >> "$GITHUB_STEP_SUMMARY"
~~~~

An `expect` gate that fails exits the command non-zero, so a suite doubles as a
CI check.  Keep CI gates on robust signals such as success rate, error counts,
and gross throughput or latency floors; precise latency-percentile regression
belongs in a controlled environment, not a shared CI runner.

[report schema]: https://json-schema.fedify.dev/bench/report-v1.json

### Safety

`fedify bench` runs without friction against a loopback or private target, or
any target that advertises benchmark mode.  A public target that does not
advertise benchmark mode is refused unless you pass `--allow-unsafe-target`,
which is mandatory (never prompted) in CI and any non-interactive context.  Use
`--dry-run` to print the plan without sending anything.

### Local targets over HTTP

An `inbox` recipient given as an `acct:` handle is resolved through WebFinger,
which goes over HTTPS, so against a plain-HTTP loopback target give the
`recipient` as the actor's URI (for example
`http://localhost:3000/users/alice`) instead.  The `webfinger` scenario is
unaffected: it requests `/.well-known/webfinger` on the target directly, so it
can benchmark `acct:` lookups over plain HTTP.

Signed scenarios such as `inbox` make the target dereference the benchmark's
synthetic actor server while verifying signatures, so that server must be
reachable from the target.  A loopback target reaches it automatically (both
run on the same machine).  For a non-loopback target, pass `--advertise-host`
with an address the target can reach (for example the client's LAN IP); the
synthetic server then binds every interface and advertises that host in the
actor and key URLs.  Without it, a non-loopback signed scenario is refused
(use a read scenario such as `webfinger`, which needs no synthetic server).


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

By default, every recipient inbox must appear in the server-configured
`~FederationBenchmarkOptions.triggerSinks` list.  This keeps benchmark traffic
pointed at benchmark sink inboxes and prevents callers from choosing their own
allowlist.  To bypass this guard for a controlled run, set
`~FederationBenchmarkOptions.allowUnsafeTriggerRecipients` to `true` in the
application configuration.

A successful trigger returns `202 Accepted`:

~~~~ json
{
  "version": 1,
  "activityId": "https://example.com/activities/bench-1",
  "queueCorrelationId": "https://example.com/activities/bench-1",
  "recipientCount": 1,
  "inboxCount": 1
}
~~~~

The `queueCorrelationId` is the activity ID preserved on the queued fanout or
outbox work.


Metrics
-------

Benchmark mode uses the same Fedify metrics documented in
[*OpenTelemetry*](./opentelemetry.md), including queue task metrics, queue
depth, HTTP server metrics, and signature verification histograms.  The
benchmark endpoints themselves are classified as `fedify.endpoint=benchmark`
in `fedify.http.server.request.*` metrics.
