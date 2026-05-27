Circuit breaker
===============

*This API is available since Fedify 2.3.0.*

Fedify's outbound delivery circuit breaker protects queued ActivityPub
delivery from repeatedly hammering a remote server that is down or returning
server errors.  It applies to queued outbox delivery: activities delivered
through a configured `MessageQueue` are tracked per remote inbox host, and an
unhealthy host can temporarily hold further deliveries until a recovery probe
is due.


Enabling and disabling
----------------------

The circuit breaker is enabled by default for queued outbox delivery.  To
disable it, pass `circuitBreaker: false` to `createFederation()`:

~~~~ typescript
import { createFederation } from "@fedify/fedify";

const federation = createFederation<void>({
  kv,
  queue,
  circuitBreaker: false,
});
~~~~

To customize the defaults, pass a `CircuitBreakerOptions` object:

~~~~ typescript
import { createFederation } from "@fedify/fedify";

const federation = createFederation<void>({
  kv,
  queue,
  circuitBreaker: {
    failureThreshold: 5,
    failureWindow: { minutes: 10 },
    recoveryDelay: { minutes: 30 },
    heldActivityTtl: { days: 7 },
    releaseInterval: { seconds: 1 },
  },
});
~~~~

The default policy opens a remote host's circuit after five consecutive
counted failures within ten minutes.  When the circuit is open, Fedify
requeues affected outbox messages instead of sending them.  After the
`recoveryDelay`, one message is allowed through as a half-open probe.  If it
succeeds, the circuit closes; if it fails, the circuit opens again.
While the probe is in flight, other held messages continue to be requeued at
`releaseInterval`.  If the worker running the probe stops before recording a
success or failure, Fedify treats the half-open probe as stale after another
`recoveryDelay` and allows a replacement probe.


What counts as a failure
------------------------

Fedify counts these delivery failures toward the circuit:

 -  network errors, including failed `fetch()` calls
 -  HTTP 5xx responses from the remote inbox

Fedify does not count these responses as circuit failures:

 -  HTTP 429 responses; the `Retry-After` header is respected when present
 -  HTTP 4xx responses that are not configured as permanent delivery failures
 -  configured permanent delivery failures, such as `404` or `410` by default

Any reachable HTTP 4xx response clears the consecutive failure history for
that host because it proves the remote server can be reached.


Custom failure policy
---------------------

You can replace the numeric threshold/window policy with a callback.  The
callback receives the full consecutive failure timestamp list for the remote
host and returns whether the circuit should open:

~~~~ typescript
const federation = createFederation<void>({
  kv,
  queue,
  circuitBreaker: {
    failure(timestamps) {
      return timestamps.length >= 10;
    },
  },
});
~~~~

The callback form is mutually exclusive with `failureThreshold` and
`failureWindow`.


Held activity expiry
--------------------

Activities held by an open circuit are requeued until the remote host recovers
or the held activity exceeds `heldActivityTtl`, which defaults to seven days.
When a held activity expires, Fedify drops it, records it as an abandoned
outbox activity, calls `circuitBreaker.onActivityDrop` when configured, and
calls the outbox permanent failure handler with
`reason: "circuit-breaker-ttl"`.

~~~~ typescript
const federation = createFederation<void>({
  kv,
  queue,
  circuitBreaker: {
    onActivityDrop(remoteHost, details) {
      console.warn("Dropped held activity", {
        remoteHost,
        inbox: details.inbox.href,
        activityId: details.activityId,
        heldSince: details.heldSince.toString(),
      });
    },
  },
});

federation.setOutboxPermanentFailureHandler((_ctx, failure) => {
  if (failure.reason === "circuit-breaker-ttl") {
    // The remote host did not recover before the held activity expired.
    return;
  }

  // Existing HTTP permanent-failure handling, such as 404 or 410 cleanup.
});
~~~~


Storage and concurrency
-----------------------

Circuit state is stored in the configured `KvStore` under the
`["_fedify", "circuit", remoteHost]` key prefix by default.  The stored value
has this shape:

~~~~ typescript
{
  state: "closed" | "open" | "half-open",
  failures: string[],
  opened?: string,
}
~~~~

For multi-worker deployments, use a `KvStore` implementation that supports
`cas()` so competing workers do not overwrite each other's state transitions.
Fedify still works without CAS, but it logs a warning because concurrent
workers can race when opening or closing the same host's circuit.


Observability
-------------

State changes are emitted through the `onStateChange` callback and through
OpenTelemetry:

 -  `activitypub.circuit_breaker.state_change` counter with
    `activitypub.remote.host` and `activitypub.circuit_breaker.state`
 -  `activitypub.circuit_breaker.state_change` span event on the queued
    outbox worker span with the previous and new state
 -  `activitypub.circuit_breaker.held` span event on the queued outbox worker
    span when an open circuit holds a delivery

The circuit breaker deliberately records only the remote host, not full inbox
URLs, actor IDs, or activity IDs, to keep metric cardinality bounded.  For the
full metric and span attribute lists, see the [OpenTelemetry] manual.

[OpenTelemetry]: ./opentelemetry.md
