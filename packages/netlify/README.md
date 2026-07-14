<!-- deno-fmt-ignore-file -->

@fedify/netlify: Run Fedify queues with Netlify Async Workloads
===============================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![@fedify@hackers.pub][@fedify@hackers.pub badge]][@fedify@hackers.pub]

*This package is available since Fedify 2.4.0.*

This package connects [Fedify]'s [`MessageQueue`] API to
[Netlify Async Workloads].  `NetlifyMessageQueue` publishes durable events,
while `createNetlifyQueueHandler()` turns a Netlify Function into their
consumer.

The initial release targets Netlify Functions, not Netlify Edge Functions.

[JSR badge]: https://jsr.io/badges/@fedify/netlify
[JSR]: https://jsr.io/@fedify/netlify
[npm badge]: https://img.shields.io/npm/v/@fedify/netlify?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/netlify
[@fedify@hackers.pub badge]: https://fedi-badge.minhee.org/@fedify@hackers.pub/followers.svg
[@fedify@hackers.pub]: https://hackers.pub/@fedify
[Fedify]: https://fedify.dev/
[`MessageQueue`]: https://jsr.io/@fedify/fedify/doc/federation/~/MessageQueue
[Netlify Async Workloads]: https://docs.netlify.com/build/async-workloads/get-started/


Installation
------------

~~~~ sh
deno add jsr:@fedify/netlify npm:@netlify/async-workloads  # Deno
npm  add     @fedify/netlify @netlify/async-workloads     # npm
pnpm add     @fedify/netlify @netlify/async-workloads     # pnpm
yarn add     @fedify/netlify @netlify/async-workloads     # Yarn
bun  add     @fedify/netlify @netlify/async-workloads     # Bun
~~~~

The PostgreSQL-backed `orderingKv` example below also needs
`@fedify/postgres`, `@netlify/database`, and `postgres`:

~~~~ sh
deno add jsr:@fedify/postgres npm:@netlify/database npm:postgres  # Deno
npm  add     @fedify/postgres @netlify/database postgres          # npm
pnpm add     @fedify/postgres @netlify/database postgres          # pnpm
yarn add     @fedify/postgres @netlify/database postgres          # Yarn
bun  add     @fedify/postgres @netlify/database postgres          # Bun
~~~~


Usage
-----

Create one queue for both the web application and the workload function.  A
CAS-capable `KvStore`, such as `PostgresKvStore`, is required if Fedify emits
messages with an `orderingKey`:

~~~~ typescript
import { AsyncWorkloadsClient } from "@netlify/async-workloads";
import { getConnectionString } from "@netlify/database";
import { NetlifyMessageQueue } from "@fedify/netlify";
import { PostgresKvStore } from "@fedify/postgres";
import postgres from "postgres";

const sql = postgres(getConnectionString());
export const kv = new PostgresKvStore(sql);
export const queue = new NetlifyMessageQueue({
  client: new AsyncWorkloadsClient(),
  orderingKv: kv,
});
~~~~

Pass the queue to Fedify with `manuallyStartQueue: true`.  Async Workloads
invokes the consumer, so `NetlifyMessageQueue.listen()` is intentionally not
available:

~~~~ typescript
const federation = await builder.build({
  kv,
  queue,
  manuallyStartQueue: true,
});
~~~~

Then export the consumer from a file under *netlify/functions/*:

~~~~ typescript
import type { AsyncWorkloadConfig } from "@netlify/async-workloads";
import { createNetlifyQueueHandler } from "@fedify/netlify";
import { builder, kv, queue } from "../../src/federation.ts";

export default createNetlifyQueueHandler({
  queue,
  maxRetries: 4,
  federation: () => builder.build({
    kv,
    queue,
    manuallyStartQueue: true,
  }),
  contextData: (event) => ({
    deployId: event.request.headers.get("x-nf-deploy-id"),
  }),
});

export const asyncWorkloadConfig: AsyncWorkloadConfig = {
  events: [queue.eventName],
  maxRetries: 4,
};
~~~~

Async Workloads retries exceptions raised by `processQueuedTask()` and moves
exhausted events to its dead-letter store.  Malformed envelopes are marked as
non-retryable.  Configure retry count and backoff in `asyncWorkloadConfig`.

For each `orderingKey`, the producer reserves a monotonic sequence in
`orderingKv`.  A consumer whose predecessor is still running waits with Async
Workloads' durable `step.sleep()` rather than throwing a retryable error.  This
preserves FIFO order without consuming `maxRetries`, and a long-running task
continues to exclude later tasks without relying on an expiring lock.  The
`orderingRetryDelay` option controls the durable sleep interval.

Set the handler's `maxRetries` to the same value as
`asyncWorkloadConfig.maxRetries`.  When `processQueuedTask()` throws on its
last configured attempt, the handler releases the failed sequence before the
event is dead-lettered, allowing later messages to continue.  A Function
timeout or abrupt process termination cannot run this cleanup.  After
confirming that such an event is permanently dead-lettered, advance the queue
explicitly using the ordering metadata stored in the dead-lettered event:

~~~~ typescript
await queue.skipOrderingSequence(
  event.eventData.orderingKey,
  event.eventData.orderingSequence,
);
~~~~

Do not skip an event that may still be delivered or retried.  An unacknowledged
send throws `NetlifyMessageQueueSendError`; its sequence remains reserved
because a lost response does not prove that the router rejected the event.
Use the error's `orderingKey` and `orderingSequence` for manual recovery only
after ruling out delivery.

Ordering state must use crash-safe storage.  `PostgresKvStore` creates a logged
table by default; do not pass `unlogged: true` for `orderingKv`.

Netlify limits an event payload to 500 KB.  Fedify messages, including any
embedded activity, must remain below that limit.

`enqueueMany()` sends one Async Workloads event per message because Netlify's
public client has no batch operation.  The queue therefore declares
`atomicEnqueueMany` as `false`: ordinary batches still send concurrently, but
Fedify rejects a multi-message `enqueueTaskMany()` call with one
`deduplicationKey` before sending anything.  Such a key requires an atomic
batch enqueue so a failed partial send cannot produce duplicates on retry.

See the [deployment manual] and the [Netlify Astro example] for a complete
setup with Netlify Database.

[deployment manual]: https://fedify.dev/manual/deploy#netlify-functions
[Netlify Astro example]: https://github.com/fedify-dev/fedify/tree/main/examples/netlify-astro


Integration testing
-------------------

The repository includes a Netlify Dev integration test that exercises real
Async Workloads delivery, retries, and ordering.  To enable it, create an
otherwise empty Netlify project, install the Async Workloads extension on it,
and put these values in the repository root's untracked *.env* file:

~~~~ dotenv
NETLIFY_AUTH_TOKEN=your-personal-access-token
NETLIFY_SITE_ID=your-project-id
~~~~

Then run:

~~~~ sh
mise run test-each netlify
~~~~

The test generates a temporary `AWL_API_KEY` for Netlify Dev, so it must not be
added to *.env*.  When either required variable is absent, the integration test
is skipped automatically.  Deno and Bun also skip this Node.js-only Netlify Dev
test while continuing to run the package's portable unit tests.
