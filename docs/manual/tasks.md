Background tasks
================

*This API is available since Fedify 2.x.x.*

Fedify already processes outgoing and incoming activities on background
workers through its [message queue](./mq.md).  The custom background task API
generalizes the same pattern—enqueue work, return immediately, process the
payload on a separate worker—to arbitrary application-defined jobs: sending
digest e-mails, rebuilding timelines, fetching link previews, and so on.

A task is *defined* once on the `Federation` (or `FederationBuilder`) object
with `~TaskRegistry.defineTask()`, and *dispatched* from any `Context` with
`~Context.enqueueTask()`.  The payload is validated, serialized by Fedify,
delivered through a message queue, and handed—decoded and re-validated—to the
task's handler on a worker.


Defining a task
---------------

`~TaskRegistry.defineTask()` registers a named task and returns a handle that
`~Context.enqueueTask()` consumes.  Every task requires a `schema`, a
[Standard Schema] (implemented by [Zod], [Valibot], [ArkType], and friends)
that validates the payload; the payload type is inferred from it, so handlers
and call sites are fully typed without manual type annotations:

~~~~ typescript
import { z } from "zod";

const sendDigest = federation.defineTask("sendDigest", {
  schema: z.object({
    userId: z.string(),
    since: z.date(),
  }),
  handler: async (ctx, data) => {
    // data is typed as { userId: string; since: Date }
    const digest = await buildDigest(data.userId, data.since);
    await sendEmail(data.userId, digest);
  },
});
~~~~

Task names must be unique within a federation; defining the same name twice
throws a `TypeError`.

[Standard Schema]: https://standardschema.dev/
[Zod]: https://zod.dev/
[Valibot]: https://valibot.dev/
[ArkType]: https://arktype.io/


Payload handling
----------------

Task payloads cross a message queue, so they are serialized on enqueue and
deserialized on dispatch.  Fedify owns this codec—applications never encode
payloads themselves.  The codec is built on [devalue], which means payloads
are not limited to JSON: `Date`, `Map`, `Set`, `URL`, `RegExp`, `bigint`,
typed arrays, `Temporal` values (e.g., `Temporal.Instant`,
`Temporal.Duration`), circular references, and repeated references all
round-trip faithfully.

Activity Vocabulary objects (`Note`, `Create`, `Person`, `Link`, and so on)
are also supported as payload values.  Each vocabulary object is bridged
through expanded JSON-LD on the wire and comes back as a real instance, so
the handler can call its methods and getters as usual:

~~~~ typescript
import { Note } from "@fedify/vocab";
import { z } from "zod";

const indexNote = federation.defineTask("indexNote", {
  schema: z.object({
    note: z.instanceof(Note),  // an opaque instanceof leaf
    indexedAt: z.date(),
  }),
  handler: async (ctx, data) => {
    await searchIndex.add(data.note.id?.href, data.note.content?.toString());
  },
});
~~~~

The schema validates the *envelope* of the payload; vocabulary objects are
opaque `instanceof` leaves (e.g., `z.instanceof(Note)`), so no enormous
schema is needed.

Validation runs twice: once at enqueue time, so a caller passing a wrong
shape fails fast at the call site, and once at dequeue time, which protects
against *schema drift*—a durable queue can hand a new deployment a payload
that an older deployment enqueued.  A payload that fails dequeue-time
validation (or cannot be decoded at all) is dropped with an error log rather
than retried, because retrying cannot make it valid.

Because the same schema validates on both sides of the queue, its validation
must be *idempotent*: the validated output must itself be a valid input.
Transforming schemas (e.g., Zod's `.transform()`) whose output differs in
shape from their input are not supported—the payload type is inferred as the
schema's *output*, so the call site already fails validation at enqueue time.

[devalue]: https://github.com/sveltejs/devalue


Dispatching tasks
-----------------

`~Context.enqueueTask()` validates the payload, serializes it, and enqueues
it.  It returns as soon as the message is accepted by the queue:

~~~~ typescript
await ctx.enqueueTask(sendDigest, {
  userId: "alice",
  since: new Date("2026-06-01T00:00:00Z"),
});
~~~~

Passing a payload that does not match the task's schema is a compile-time
type error, and—for shapes the type system cannot catch—a runtime
`TypeError` at the call site.

`~Context.enqueueTaskMany()` enqueues multiple payloads at once, using the
queue's bulk `~MessageQueue.enqueueMany()` operation when the backend
supports it and falling back to parallel single enqueues otherwise:

~~~~ typescript
await ctx.enqueueTaskMany(sendDigest, users.map((u) => ({
  userId: u.id,
  since: u.lastDigestAt,
})));
~~~~

Both methods accept options:

`delay`
:   A `Temporal.DurationLike` to postpone processing, e.g.,
    `{ minutes: 30 }`.

`orderingKey`
:   Tasks with the same ordering key are processed sequentially (one at
    a time), like the same option on the message queue layer.

`deduplicationKey`
:   Requests at-most-once enqueue for tasks that share the key; see
    [Deduplication](#deduplication) below.

~~~~ typescript
await ctx.enqueueTask(sendDigest, payload, {
  delay: { minutes: 30 },
  orderingKey: `digest:${payload.userId}`,
});
~~~~


Retry and error handling
------------------------

When a handler throws, Fedify consults the retry policy and re-enqueues the
message with an incremented attempt counter.  The policy is resolved in this
order:

1.  The task's own `retryPolicy` passed to `~TaskRegistry.defineTask()`.
2.  The federation-wide `~FederationOptions.taskRetryPolicy`.
3.  The default: exponential backoff with a maximum of 10 attempts.

When the queue backend reports `~MessageQueue.nativeRetrial`, Fedify rethrows
the error instead and lets the backend drive retries.

A task can also register an `onError` callback, which is invoked with the
error and the decoded payload before a retry is scheduled—useful for
reporting or compensating actions:

~~~~ typescript
const sendDigest = federation.defineTask("sendDigest", {
  schema: digestSchema,
  handler: async (ctx, data) => {
    await sendEmail(data.userId, await buildDigest(data.userId, data.since));
  },
  retryPolicy: createExponentialBackoffPolicy({ maxAttempts: 3 }),
  onError: async (ctx, error, data) => {
    await reportFailure("sendDigest", data.userId, error);
  },
});
~~~~

Two failure cases are *dropped without retry*, because retrying cannot help:
a message whose `taskName` has no registered handler (logged as a warning),
and a payload that cannot be decoded or fails dequeue-time validation
(logged as an error).


Queue routing and isolation
---------------------------

By default tasks share the outbox queue, so no extra configuration is needed
beyond a `queue` on `createFederation()`.  For heavier workloads, tasks can
be isolated at two levels.

A dedicated task queue, separate from activity delivery, is configured with
the `~FederationQueueOptions.task` slot:

~~~~ typescript
const federation = createFederation<void>({
  // ...
  queue: {
    inbox: new PostgresMessageQueue(sql, { channel: "inbox" }),
    outbox: new PostgresMessageQueue(sql, { channel: "outbox" }),
    task: new PostgresMessageQueue(sql, { channel: "task" }),  // [!code highlight]
  },
});
~~~~

A single task can also carry its own queue, which takes precedence over
everything else:

~~~~ typescript
const transcodeVideo = federation.defineTask("transcodeVideo", {
  schema: transcodeSchema,
  handler: transcodeHandler,
  queue: new PostgresMessageQueue(sql, { channel: "transcode" }),
});
~~~~

Workers for dedicated per-task queues are registered when the queue
machinery starts, so define every task before `~Federation.startQueue()`
is called (or, without `~FederationOptions.manuallyStartQueue`, before the
first request is handled); a per-task queue defined later may not get
a worker until the queue machinery is next started.

The queue for a task is resolved in order: the per-task `queue`, then the
federation's `task` queue, then the outbox queue.  Deployments that must
*not* silently share the outbox queue can opt out of the last step with
`~FederationOptions.taskQueueResolution`:

~~~~ typescript
const federation = createFederation<void>({
  // ...
  taskQueueResolution: "strict",  // no outbox fallback  // [!code highlight]
});
~~~~

Under `"strict"` resolution, enqueuing a task that has no queue throws
a `TypeError` instead of falling back.

On the worker side, `~Federation.startQueue()` accepts `"task"` in its
`queue` option, so a dedicated worker process can consume only tasks:

~~~~ typescript
await federation.startQueue(contextData, { queue: "task" });
~~~~

A task that falls back to the outbox queue needs no dedicated worker; the
outbox worker dispatches every message by its type regardless of which queue
delivered it.

> [!CAUTION]
> Task payloads cross durable queue storage, so treat the queue backend and
> its payloads as internal, trusted storage.  Do not place long-lived secrets
> or credentials directly in a task payload; pass an identifier that the
> worker resolves from your application storage instead.  When task workloads
> must stay isolated from ActivityPub delivery, give them a dedicated task
> queue and set `taskQueueResolution: "strict"`.


Deduplication
-------------

A task often needs *at-most-once-per-key* enqueue: a digest mailer must not
send twice when a request is retried, and a cleanup job should coalesce
duplicate triggers.  Passing a `deduplicationKey` requests this—a second
enqueue with the same key is dropped while the first is still within the
deduplication window:

~~~~ typescript
await ctx.enqueueTask(sendDigest, payload, {
  deduplicationKey: `digest:${payload.userId}`,  // [!code highlight]
});
~~~~

How the key is resolved depends on the queue and the key–value store:

1.  **Native backend.**  When the task's queue declares
    `~MessageQueue.nativeDeduplication`, Fedify forwards the key in the
    message queue's `~MessageQueueEnqueueOptions.deduplicationKey` and the
    backend owns the check.  Fedify does not touch the key–value store.

2.  **Key–value fallback.**  Otherwise, if the configured `~KvStore` exposes
    the optional compare-and-swap (`~KvStore.cas`) primitive, Fedify records
    the key under a dedicated `taskDeduplication` prefix with a TTL and skips
    the enqueue while a marker is present.  The TTL defaults to one hour and is
    configurable with `~FederationOptions.taskDeduplicationTtl`:

    ~~~~ typescript
    const federation = createFederation<void>({
      // ...
      taskDeduplicationTtl: { minutes: 10 },  // [!code highlight]
    });
    ~~~~

3.  **No conditional write.**  When neither applies—no native deduplication and
    a key–value store without `~KvStore.cas`—the behavior is governed by
    `~FederationOptions.taskDeduplicationFallback`.  `"open"` (the default)
    lets the enqueue proceed without deduplication after a debug-level log;
    `"closed"` throws a `TypeError` before enqueuing:

    ~~~~ typescript
    const federation = createFederation<void>({
      // ...
      taskDeduplicationFallback: "closed",  // [!code highlight]
    });
    ~~~~

Among the first-party adapters, the in-memory, Deno KV, SQLite, and MySQL
key–value stores implement `~KvStore.cas`; PostgreSQL and Redis do not yet, so
those deployments take the `taskDeduplicationFallback` branch until per-adapter
follow-ups add it.

For `~Context.enqueueTaskMany()`, a single `deduplicationKey` applies to the
whole batch: the batch enqueues as a unit or is skipped as a unit, never
partially.  Per-item deduplication means calling `~Context.enqueueTask()` in
a loop, each with its own key.  A queue that declares
`~MessageQueue.nativeDeduplication` must also implement
`~MessageQueue.enqueueMany()` to carry a multi-item batch's key as one unit;
fanning the key out across separate `~MessageQueue.enqueue()` calls cannot drop
a whole batch, so Fedify rejects that combination instead of silently leaking
duplicates.

> [!WARNING]
> The key–value fallback is **best-effort, not transactional**.  The marker
> write and the enqueue are separate operations, so a crash between them, the
> `"open"` fallback under concurrency, a non-atomic third-party `~KvStore.cas`,
> or reuse of a key within its TTL window can still admit a duplicate or
> suppress a task.  Cleanup is by TTL expiry, not active deletion on handler
> success.  Deployments needing strict guarantees use a queue with
> `nativeDeduplication: true`, where the backend owns an atomic check.


Limitations
-----------

The current API intentionally ships without task-specific OpenTelemetry spans
and metrics, cron-style periodic scheduling, result backends, and per-task
priority.  Some of these are planned as follow-ups; see the [tracking issue].

[tracking issue]: https://github.com/fedify-dev/fedify/issues/206
