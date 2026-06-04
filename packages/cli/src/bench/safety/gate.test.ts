import assert from "node:assert/strict";
import test from "node:test";
import { assertTargetAllowed, UnsafeTargetError } from "./gate.ts";

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
