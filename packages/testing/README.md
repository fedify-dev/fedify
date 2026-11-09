<!-- deno-fmt-ignore-file -->

@fedify/testing
===============

Testing utilities for Fedify applications.

This package provides mock implementations of the `Federation` and `Context`
interfaces to facilitate unit testing of federated applications built with
Fedify.


Installation
------------

~~~~ bash
npm install @fedify/testing
~~~~

~~~~ bash
pnpm add @fedify/testing
~~~~

~~~~ bash
yarn add @fedify/testing
~~~~

~~~~ bash
deno add @fedify/testing
~~~~


Usage
-----

### `MockFederation`

The `MockFederation` class provides a mock implementation of the `Federation`
interface for unit testing:

~~~~ typescript
import { MockFederation } from "@fedify/testing";
import { Create } from "@fedify/vocab";

// Create a mock federation
const federation = new MockFederation<{ userId: string }>();

// Set up inbox listeners
federation
  .setInboxListeners("/users/{identifier}/inbox")
  .on(Create, async (ctx, activity) => {
    console.log("Received:", activity);
  });

// Simulate receiving an activity
await federation.receiveActivity(createActivity);

// Check sent activities
const sent = federation.sentActivities;
console.log(sent[0].activity);
~~~~

### `MockContext`

The `MockContext` class provides a mock implementation of the `Context`
interface:

~~~~ typescript
import { MockContext } from "@fedify/testing";

// Create a mock context
const context = new MockContext({
  url: new URL("https://example.com"),
  data: { userId: "test-user" },
  federation: mockFederation
});

// Send an activity
await context.sendActivity(
  { identifier: "alice" },
  recipient,
  activity
);

// Check sent activities
const sent = context.getSentActivities();
console.log(sent[0].activity);
~~~~

Both `context.getSentActivities()` and `federation.sentActivities` retain the
optional `dispatchId` supplied to `sendActivity()`. Reusing a dispatch ID
records another send, so tests can check correlation across application-managed
retries. Mock federations also accept `setOutboundObservers()` registration,
but mock sends do not invoke those callbacks.

### Helper functions

The package also exports helper functions for creating various context types:

 -  `createContext()`: Creates a basic context
 -  `createRequestContext()`: Creates a request context
 -  `createInboxContext()`: Creates an inbox context

### Store conformance tests

The package provides reusable conformance suites for Fedify storage adapters.
Use `testKvStore()` to check a `KvStore` implementation and
`testMessageQueue()` to check a `MessageQueue` implementation:

~~~~ typescript
import { test } from "@fedify/fixture";
import { testKvStore, testMessageQueue } from "@fedify/testing";

test("MyKvStore", () =>
  testKvStore(
    () => new MyKvStore(),
    async ({ store }) => await store.close(),
  ));

test("MyMessageQueue", () =>
  testMessageQueue(
    () => new MyMessageQueue(),
    async ({ mq1, mq2, controller }) => {
      controller.abort();
      await mq1.close();
      await mq2.close();
    },
  ));
~~~~


Features
--------

 -  Track sent activities with metadata
 -  Simulate activity reception
 -  Configure custom URI templates
 -  Test queue-based activity processing
 -  Mock document loaders and context loaders


Atomic key–value store conformance
----------------------------------

*This API is available since Fedify 2.5.0.*

Use `testAtomicKvStore()` to check an `AtomicKvStore` implementation.  It
covers ordered snapshot reads, all-or-nothing batches, conditional updates and
deletions, competing clients, logical expiry, and validation.  Run
`testKvStore()` separately for ordinary key–value behavior and prefix listing.

Each case calls the factory for a fresh pair of clients sharing isolated
backing state.  Persistent adapters need independent handles connected to the
same backend.  `MemoryKvStore` may return the same instance for both clients:

~~~~ typescript
import { MemoryKvStore } from "@fedify/fedify";
import { testAtomicKvStore } from "@fedify/testing";
import { test } from "node:test";

test("Memory atomic contract", () => testAtomicKvStore(() => {
  const store = new MemoryKvStore();
  return {
    first: store,
    second: store,
    dispose() {},
  };
}, { objectKeyOrder: "ignored" }));
~~~~

For persistent adapters, `dispose()` must close both clients and remove the
isolated backing state.  If factory construction fails before returning a
pair, the factory must clean up any resources it already acquired.  The helper
waits for all started concurrent operations before disposal.  If an assertion
and disposal both fail, it retains both errors in an `AggregateError`.

The checks that are expected to succeed use batches of up to three keys or
entries. Configure a supported atomic scope large enough for those calls.  The
`key` option can place generated keys in that scope, for example a common Redis
Cluster hash tag.  The mapping must preserve distinct keys and structural key
equality; it need not preserve prefixes.  Keys receive a fresh random prefix
before mapping.

`objectKeyOrder: "ignored"` checks that reordered object members compare equal
in single-key and batch compare-and-swap (CAS) operations.  Use `"significant"`
for a codec that compares encoded JSON bytes.  Omit the option when the adapter
makes neither promise; nested JSON round trips and type/array distinctions are
still checked.

TTL defaults are 500 ms for the short lifetime and 1 s for the expiry wait.
Override both (`ttl.short` and `ttl.wait`) with positive durations when a
backend rounds expiry or needs more time for network operations.  The wait must
exceed the TTL after the backend's rounding, plus the expected latency.  Zero
and negative TTL policies are adapter-specific and need separate adapter tests.

### Limit and scope rejection probes

Provide `rejections()` to test documented backend limits or unsupported atomic
key scopes.  The `rejections()` callback receives a key factory that already
applies the configured mapper.  Returned keys are used verbatim.  Every key
must be valid for individual store calls. The helper seeds each mutation key,
then verifies that rejection leaves it unchanged through individual reads.  It
seeds CAS keys with the supplied expectations, including absence for expected
`undefined`.  Supply distinct mutation keys, supported values and TTLs, and
changes that would be observable if incorrectly committed.  Do not supply no-op
deletion probes on absent keys or CAS entries whose new value equals their
expectation.

For example, build probes from the adapter's documented maximum batch count,
rather than assuming a universal limit.  This configuration example imports
`Temporal` from `temporal-polyfill`; install that package as a direct
development dependency when using the example in a runtime without native
Temporal:

~~~~ typescript
import type { TestAtomicKvStoreOptions } from "@fedify/testing";
import { Temporal } from "temporal-polyfill";

function optionsForBatchLimit(maxEntries: number): TestAtomicKvStoreOptions {
  return {
    ttl: {
      short: Temporal.Duration.from({ seconds: 1 }),
      wait: Temporal.Duration.from({ seconds: 2 }),
    },
    key: (key) => ["{fedify-atomic-test}", ...key],
    rejections: (makeKey) => {
      const keys = Array.from(
        { length: maxEntries + 1 },
        (_, index) => makeKey("over-limit", String(index)),
      );
      return {
        getMany: keys,
        setMany: keys.map((key, index) => ({ key, value: index })),
        deleteMany: keys,
        casMany: keys.map((key, index) => ({
          key,
          expectedValue: index,
          newValue: index + 1,
        })),
      };
    },
  };
}
~~~~

This example assumes the documented count applies to all four operations.
When the limits differ, provide only the relevant operation probes or build
each from its own limit.  For a scope probe, the callback can deliberately
return individually valid keys outside the shared atomic scope.

The concurrency checks repeat several races in both snapshot invocation
orders; they are not an exhaustive proof of linearizability.  Add
backend-specific tests for competing handles, absent and expired entries,
rollback when a later write in the same batch fails, injected failures,
supported isolation levels, and reopen persistence.  Method presence and
passing these shared checks do not establish crash durability.
