<!-- deno-fmt-ignore-file -->

@fedify/fixture: Cross-runtime test helpers and ActivityPub fixtures
====================================================================

This package provides the shared test infrastructure used by every package in
the [Fedify] monorepo.  It bundles three things that are needed by virtually
every test file:

1.  A `test()` function that runs the same test code on Deno, Node.js, and
    Bun (and forwards the registrations to a Cloudflare Workers harness).
2.  A `mockDocumentLoader()` that resolves ActivityPub/JSON-LD documents from
    on-disk JSON fixtures instead of making real HTTP requests.
3.  A `TestSpanExporter` for asserting on OpenTelemetry spans recorded by the
    code under test.

This package is private to the monorepo (`"private": true` in *package.json*,
`"publish": false` in *deno.json*).  It is not published to npm or JSR and is
intended only as a `workspace:` dependency of other packages in this
repository.

[Fedify]: https://fedify.dev/


Installation
------------

You do not install `@fedify/fixture` from a registry.  Add it as a workspace
dependency to the package that needs it:

~~~~ jsonc
// packages/<your-package>/package.json
{
  "devDependencies": {
    "@fedify/fixture": "workspace:^"
  }
}
~~~~

~~~~ jsonc
// packages/<your-package>/deno.json
{
  "imports": {
    "@fedify/fixture": "jsr:@fedify/fixture@^2.0.0"
  }
}
~~~~

For Deno, the `imports` entry resolves to the in-tree source through the
workspace at the repository root.  For Node.js and Bun, pnpm links the local
package by virtue of the `workspace:` specifier; remember to run
`mise run install` (or `pnpm install`) at the repository root after the edit.


Usage
-----

### `test()` — cross-runtime test registration

`test()` accepts the same call signatures as [`Deno.test()`] and dispatches to
the appropriate runtime test API:

 -  On Deno, it forwards to `Deno.test()` directly.
 -  On Bun, it forwards to `Bun.jest(...).test` and translates
    `Deno.TestContext` so that nested `t.step()` calls keep working.
 -  On Node.js (and on `node --test` in `dist-tests/`), it forwards to
    [`node:test`] and adapts the context the same way.
 -  In any environment the test definition is also pushed to the exported
    `testDefinitions` array so that the Cloudflare Workers test harness in
    *packages/fedify/src/cfworkers/* can iterate over them.

Pick whichever signature matches the test you are writing:

~~~~ typescript
import { test } from "@fedify/fixture";
import { equal } from "node:assert/strict";

// (1) Object form
test({
  name: "addition is commutative",
  fn() {
    equal(1 + 2, 2 + 1);
  },
});

// (2) Name + function
test("subtraction works", () => {
  equal(5 - 3, 2);
});

// (3) Name + options + function
test("ignored on this runtime", { ignore: true }, () => {
  // never runs
});

// Nested steps via t.step() work on every runtime
test("nested steps", async (t) => {
  await t.step("step 1", () => {
    equal(1, 1);
  });
  await t.step("step 2", () => {
    equal(2, 2);
  });
});
~~~~

#### Logging behavior

`test()` configures [LogTape] before every test and resets it afterwards.
By default log records are captured in memory and only flushed to the console
if the test throws — this keeps successful runs quiet.  Set the environment
variable `LOG=always` to stream every log record to stdout regardless of test
outcome, which is useful when you are debugging a flaky test:

~~~~ bash
LOG=always deno task test
LOG=always pnpm test
~~~~

[`Deno.test()`]: https://docs.deno.com/api/deno/~/Deno.test
[`node:test`]: https://nodejs.org/api/test.html
[LogTape]: https://logtape.org/

### `testDefinitions` — registered test list

Every call to `test()` appends to this array.  The Cloudflare Workers test
harness (and any custom runner you build) can read it to enumerate tests
without depending on a specific runtime test API:

~~~~ typescript
import { testDefinitions } from "@fedify/fixture";

for (const def of testDefinitions) {
  console.log(def.name);
}
~~~~

The array contains plain `Deno.TestDefinition` objects.  In the Fedify package
it is re-exported from *src/testing/mod.ts* so that the Workers entry point in
*src/cfworkers/server.ts* can drive the suite.

### `mockDocumentLoader()` — fixture-backed JSON-LD loader

`mockDocumentLoader()` is a drop-in replacement for the document loader
parameter accepted by Fedify's signature, vocabulary, and lookup APIs.  It
never opens a socket; instead it imports a JSON file from the
`src/fixtures/<host>/<pathname>.json` tree shipped with this package.

For example, `mockDocumentLoader("https://example.com/object")` resolves
[`src/fixtures/example.com/object.json`](src/fixtures/example.com/object.json),
returning it as a `RemoteDocument` with `documentUrl` set to the original URL
and `contextUrl` set to `null`.

~~~~ typescript
import { mockDocumentLoader, test } from "@fedify/fixture";
import { lookupObject } from "@fedify/vocab";
import { ok } from "node:assert/strict";

test("lookupObject() resolves a fixture", async () => {
  const object = await lookupObject("https://example.com/object", {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  ok(object != null);
});
~~~~

#### Adding a new fixture

1.  Create the JSON file under
    [`src/fixtures/<host>/<path>.json`](src/fixtures/).  The path must mirror
    the URL exactly: e.g. `https://w3id.org/security/v1` becomes
    *src/fixtures/w3id.org/security/v1.json*.
2.  Run `pnpm --filter @fedify/fixture build` once so that the fixture is
    copied into *dist/fixtures/* — Node.js and Bun consumers import the file
    through the `./fixtures/*` subpath export, which points at the *dist/*
    copy.  (The `pretest` and `prepack` scripts do this automatically.)
3.  Reference the URL from your test through `mockDocumentLoader`.

The `./fixtures/*` subpath export is also useful when a test needs to read
the raw JSON without going through the loader:

~~~~ typescript
import object from "@fedify/fixture/fixtures/example.com/object.json"
  with { type: "json" };
~~~~

#### Cloudflare Workers

Workers cannot import JSON from the filesystem at runtime.  When
`mockDocumentLoader()` detects `navigator.userAgent === "Cloudflare-Workers"`
it instead `fetch()`es the URL with `.test` appended to the hostname (e.g.
`https://example.com.test/object`); the Workers test harness in
*packages/fedify/src/cfworkers/* serves the fixture tree from that
pseudo-domain.  No changes are needed in test code.

### `TestSpanExporter` & `createTestTracerProvider()` — OpenTelemetry assertions

Use these when you want to assert that the code under test recorded specific
OpenTelemetry spans or events.  `createTestTracerProvider()` returns a
`[BasicTracerProvider, TestSpanExporter]` tuple wired up with a
`SimpleSpanProcessor`; pass the provider to whatever API accepts a
`tracerProvider` and read assertions off the exporter:

~~~~ typescript
import {
  createTestTracerProvider,
  mockDocumentLoader,
  test
} from "@fedify/fixture";
import { lookupObject } from "@fedify/vocab";
import { deepStrictEqual } from "node:assert/strict";

test("lookupObject() records a span", async () => {
  const [tracerProvider, exporter] = createTestTracerProvider();

  await lookupObject("https://example.com/object", {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    tracerProvider,
  });

  const spans = exporter.getSpans("activitypub.lookup_object");
  deepStrictEqual(spans.length, 1);
  deepStrictEqual(
    spans[0].attributes["activitypub.object.id"],
    "https://example.com/object",
  );

  const events = exporter.getEvents(
    "activitypub.lookup_object",
    "activitypub.object.fetched",
  );
  deepStrictEqual(events.length, 1);
});
~~~~

`TestSpanExporter` exposes:

 -  `spans`: the raw `ReadableSpan[]` accumulated so far.
 -  `getSpans(name)`: every span whose `name` matches.
 -  `getSpan(name)`: the first such span, or `undefined`.
 -  `getEvents(spanName, eventName?)`: events from spans named `spanName`,
    optionally filtered by `eventName`.
 -  `clear()`: empty the buffer (useful between sub-cases inside one test).
 -  `forceFlush()` / `shutdown()`: implement the `SpanExporter` contract;
    `shutdown()` also clears the buffer.


How a test file fits together
-----------------------------

A typical test file in this monorepo combines all three utilities:

~~~~ typescript
import {
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import { deepStrictEqual, ok } from "node:assert/strict";
import { someApiUnderTest } from "./mod.ts";

test("someApiUnderTest() does the thing", async () => {
  const [tracerProvider, exporter] = createTestTracerProvider();

  const result = await someApiUnderTest("https://example.com/object", {
    documentLoader: mockDocumentLoader,
    tracerProvider,
  });

  ok(result != null);
  deepStrictEqual(exporter.getSpans("the.expected.span").length, 1);
});
~~~~

Run it with the runtime of your choice:

~~~~ bash
mise run test                 # Test all packages
mise run test-each <PACKAGES> # Test specific packages
~~~~


Caution: Don't import `@fedify/fixture` from non-test files
-----------------------------------------------------------

**Never import `@fedify/fixture` from any file that ships to end users.**
Because the package is private it is absent from the published artifacts;
any non-test file that imports it will fail to resolve once the consumer
package is installed from [npm] or [JSR].

Restrict every import of `@fedify/fixture` to files matching
`**/*.test.ts`.  Keeping the boundary at the filename level makes it
trivial to audit. You can check this with this command:

~~~~ bash
mise run check:fixture-usage
~~~~

It scans `packages/<pkg>/src/` for any non-`*.test.ts` file that contains an
`import`/`export ... from "@fedify/fixture"` statement and fails if it finds
one.  The check is also part of `mise run check`.

Genuinely justified exceptions can be added to the `ALLOWLIST` constant in
*[scripts/check\_fixture\_usage.ts](../../scripts/check_fixture_usage.ts)*
together with an inline comment explaining why.

[npm]: https://www.npmjs.com/
[JSR]: https://jsr.dev/


Repository layout
-----------------

 -  *src/test.ts*: `test()` and `testDefinitions`.
 -  *src/docloader.ts*: `mockDocumentLoader()`.
 -  *src/otel.ts*: `TestSpanExporter`, `createTestTracerProvider()`.
 -  *src/fixtures/*: JSON fixtures, organized by host and pathname.
 -  *tsdown.config.ts*: builds *dist/* (ESM + CJS + types) and copies
    fixtures into *dist/fixtures/* so the `./fixtures/*` export resolves on
    Node.js and Bun.
