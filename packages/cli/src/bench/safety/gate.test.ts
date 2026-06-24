import assert from "node:assert/strict";
import test from "node:test";
import {
  assertInboxDestinationAllowed,
  assertTargetAllowed,
  assertUnsafeOverrideAllowed,
  UnsafeTargetError,
} from "./gate.ts";

test("assertTargetAllowed - loopback/private are always allowed", () => {
  assert.doesNotThrow(() =>
    assertTargetAllowed({
      tier: "loopback",
      benchmarkMode: false,
      allowUnsafe: false,
      dryRun: false,
    })
  );
  assert.doesNotThrow(() =>
    assertTargetAllowed({
      tier: "private",
      benchmarkMode: false,
      allowUnsafe: false,
      dryRun: false,
    })
  );
});

test("assertTargetAllowed - public with benchmark mode is allowed", () => {
  assert.doesNotThrow(() =>
    assertTargetAllowed({
      tier: "public",
      benchmarkMode: true,
      allowUnsafe: false,
      dryRun: false,
    })
  );
});

test("assertTargetAllowed - public without benchmark mode is refused", () => {
  assert.throws(
    () =>
      assertTargetAllowed({
        tier: "public",
        benchmarkMode: false,
        allowUnsafe: false,
        dryRun: false,
      }),
    UnsafeTargetError,
  );
});

test("assertTargetAllowed - the unsafe flag overrides the refusal", () => {
  assert.doesNotThrow(() =>
    assertTargetAllowed({
      tier: "public",
      benchmarkMode: false,
      allowUnsafe: true,
      dryRun: false,
    })
  );
});

test("assertUnsafeOverrideAllowed - unsafe flag needs an explicit CLI target", () => {
  assert.throws(
    () =>
      assertUnsafeOverrideAllowed({
        tier: "public",
        benchmarkMode: false,
        allowUnsafe: true,
        explicitCliTarget: false,
        scenarios: [{
          name: "wf",
          explicitDuration: true,
          explicitLoad: true,
          explicitRuns: true,
        }],
      }),
    (error: unknown) =>
      error instanceof UnsafeTargetError && /--target/.test(error.message),
  );
});

test("assertUnsafeOverrideAllowed - unsafe public defaults need explicit load", () => {
  assert.throws(
    () =>
      assertUnsafeOverrideAllowed({
        tier: "public",
        benchmarkMode: false,
        allowUnsafe: true,
        explicitCliTarget: true,
        scenarios: [{
          name: "wf",
          explicitDuration: true,
          explicitLoad: false,
          explicitRuns: true,
        }],
      }),
    (error: unknown) =>
      error instanceof UnsafeTargetError && /load/.test(error.message),
  );
});

test("assertUnsafeOverrideAllowed - unsafe public defaults need explicit duration", () => {
  assert.throws(
    () =>
      assertUnsafeOverrideAllowed({
        tier: "public",
        benchmarkMode: false,
        allowUnsafe: true,
        explicitCliTarget: true,
        scenarios: [{
          name: "wf",
          explicitDuration: false,
          explicitLoad: true,
          explicitRuns: true,
        }],
      }),
    (error: unknown) =>
      error instanceof UnsafeTargetError && /duration/.test(error.message),
  );
});

test("assertUnsafeOverrideAllowed - unsafe public defaults need explicit runs", () => {
  assert.throws(
    () =>
      assertUnsafeOverrideAllowed({
        tier: "public",
        benchmarkMode: false,
        allowUnsafe: true,
        explicitCliTarget: true,
        scenarios: [{
          name: "wf",
          explicitDuration: true,
          explicitLoad: true,
          explicitRuns: false,
        }],
      }),
    (error: unknown) =>
      error instanceof UnsafeTargetError && /runs/.test(error.message),
  );
});

test("assertUnsafeOverrideAllowed - safe targets do not need unsafe metadata", () => {
  assert.doesNotThrow(() =>
    assertUnsafeOverrideAllowed({
      tier: "loopback",
      benchmarkMode: false,
      allowUnsafe: false,
      explicitCliTarget: false,
      scenarios: [],
    })
  );
});

test("assertTargetAllowed - dry-run bypasses the gate", () => {
  assert.doesNotThrow(() =>
    assertTargetAllowed({
      tier: "public",
      benchmarkMode: false,
      allowUnsafe: false,
      dryRun: true,
    })
  );
});

function destContext(
  overrides: Partial<Parameters<typeof assertInboxDestinationAllowed>[1]> = {},
) {
  return {
    targetOrigin: "http://127.0.0.1:3000",
    targetTier: "loopback" as const,
    destinationTier: "public" as const,
    targetBenchmarkMode: false,
    allowUnsafe: false,
    advertised: false,
    ...overrides,
  };
}

test("assertInboxDestinationAllowed - loopback inbox is allowed", () => {
  assert.doesNotThrow(() =>
    assertInboxDestinationAllowed(
      new URL("http://127.0.0.1:3000/inbox"),
      destContext(),
    )
  );
});

test("assertInboxDestinationAllowed - a public inbox off the target is refused", () => {
  // A loopback target with a public inbox (a public recipient, or an explicit
  // inbox URL) must not receive load without the unsafe flag.
  assert.throws(
    () =>
      assertInboxDestinationAllowed(
        new URL("https://prod.example/inbox"),
        destContext(),
      ),
    (error: unknown) =>
      error instanceof UnsafeTargetError && /public inbox/.test(error.message),
  );
});

test("assertInboxDestinationAllowed - the unsafe flag allows a public inbox", () => {
  assert.doesNotThrow(() =>
    assertInboxDestinationAllowed(
      new URL("https://prod.example/inbox"),
      destContext({ allowUnsafe: true, advertised: true }),
    )
  );
});

test("assertInboxDestinationAllowed - an inbox on the target origin inherits its gate", () => {
  // Same origin as the gated target, which advertises benchmark mode.
  assert.doesNotThrow(() =>
    assertInboxDestinationAllowed(
      new URL("https://staging.example/inbox"),
      destContext({
        targetOrigin: "https://staging.example",
        targetBenchmarkMode: true,
        advertised: true,
      }),
    )
  );
});

test("assertInboxDestinationAllowed - same-origin inbox uses the resolved target tier", () => {
  // The target hostname may be syntactically public but DNS-resolved private.
  // The discovered same-origin inbox should inherit that resolved tier instead
  // of being reclassified from the hostname string.
  assert.doesNotThrow(() =>
    assertInboxDestinationAllowed(
      new URL("https://staging.example/inbox"),
      destContext({
        targetOrigin: "https://staging.example",
        targetTier: "private",
        advertised: true,
      }),
    )
  );
});

test("assertInboxDestinationAllowed - off-origin inbox uses destination tier", () => {
  assert.doesNotThrow(() =>
    assertInboxDestinationAllowed(
      new URL("https://shared.staging.example/inbox"),
      destContext({
        destinationTier: "private",
        advertised: true,
      }),
    )
  );
});

test("assertInboxDestinationAllowed - same host, different scheme does not inherit", () => {
  // The target is https (its benchmark-mode probe covered port 443); an http
  // inbox on the same hostname is a different service (port 80), so it must not
  // inherit the target's gate.
  assert.throws(
    () =>
      assertInboxDestinationAllowed(
        new URL("http://prod.example/inbox"),
        destContext({
          targetOrigin: "https://prod.example",
          targetBenchmarkMode: true,
          advertised: true,
        }),
      ),
    (error: unknown) =>
      error instanceof UnsafeTargetError && /public inbox/.test(error.message),
  );
});

test("assertInboxDestinationAllowed - a non-loopback inbox needs an advertised host", () => {
  // Private inbox is not a safety problem, but the synthetic server is
  // unreachable from it unless a reachable host was advertised.
  assert.throws(
    () =>
      assertInboxDestinationAllowed(
        new URL("http://10.0.0.5:8000/inbox"),
        destContext({
          targetOrigin: "http://10.0.0.5:8000",
          targetTier: "private",
        }),
      ),
    (error: unknown) =>
      error instanceof UnsafeTargetError &&
      /advertise-host/.test(error.message),
  );
  assert.doesNotThrow(() =>
    assertInboxDestinationAllowed(
      new URL("http://10.0.0.5:8000/inbox"),
      destContext({
        targetOrigin: "http://10.0.0.5:8000",
        targetTier: "private",
        advertised: true,
      }),
    )
  );
});
