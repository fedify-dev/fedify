import { Temporal } from "@js-temporal/polyfill";
import { strictEqual } from "node:assert";
import { test } from "node:test";
import { isTemporalDuration, isTemporalInstant } from "./temporal.ts";

test("isTemporalInstant() accepts polyfill instances", () => {
  strictEqual(
    isTemporalInstant(Temporal.Instant.from("2026-05-14T00:00:00Z")),
    true,
  );
});

test("isTemporalInstant() accepts spec-compliant non-polyfill objects", () => {
  // Mimics the shape of a native `Temporal.Instant` from a host that does
  // not share class identity with the bundled polyfill.
  const nativeLike = Object.create(null, {
    [Symbol.toStringTag]: { value: "Temporal.Instant" },
    epochNanoseconds: { value: 0n },
    toString: { value: () => "1970-01-01T00:00:00Z" },
  });
  strictEqual(isTemporalInstant(nativeLike), true);
});

test("isTemporalInstant() rejects unrelated values", () => {
  strictEqual(isTemporalInstant(null), false);
  strictEqual(isTemporalInstant(undefined), false);
  strictEqual(isTemporalInstant("2026-05-14T00:00:00Z"), false);
  strictEqual(isTemporalInstant(new Date()), false);
  strictEqual(
    isTemporalInstant(Temporal.Duration.from({ seconds: 1 })),
    false,
  );
});

test("isTemporalInstant() rejects bare objects tagged but missing shape", () => {
  const decoy = Object.create(null, {
    [Symbol.toStringTag]: { value: "Temporal.Instant" },
  });
  strictEqual(isTemporalInstant(decoy), false);
});

test("isTemporalInstant() rejects non-bigint epochNanoseconds", () => {
  const decoy = Object.create(null, {
    [Symbol.toStringTag]: { value: "Temporal.Instant" },
    epochNanoseconds: { value: 0 },
    toString: { value: () => "1970-01-01T00:00:00Z" },
  });
  strictEqual(isTemporalInstant(decoy), false);
});

test("isTemporalInstant() rejects default Object.prototype.toString", () => {
  // A plain object inherits `toString` from `Object.prototype`, so calling
  // it would produce `"[object Temporal.Instant]"` instead of an RFC 3339
  // timestamp.  The guard must reject these to keep the serializer honest.
  const decoy = {
    [Symbol.toStringTag]: "Temporal.Instant",
    epochNanoseconds: 0n,
  };
  strictEqual(isTemporalInstant(decoy), false);
});

test("isTemporalDuration() accepts polyfill instances", () => {
  strictEqual(
    isTemporalDuration(Temporal.Duration.from({ hours: 1 })),
    true,
  );
});

test("isTemporalDuration() accepts spec-compliant non-polyfill objects", () => {
  const nativeLike = Object.create(null, {
    [Symbol.toStringTag]: { value: "Temporal.Duration" },
    sign: { value: 0 },
    toString: { value: () => "PT0S" },
  });
  strictEqual(isTemporalDuration(nativeLike), true);
});

test("isTemporalDuration() rejects unrelated values", () => {
  strictEqual(isTemporalDuration(null), false);
  strictEqual(isTemporalDuration(undefined), false);
  strictEqual(isTemporalDuration("PT1H"), false);
  strictEqual(
    isTemporalDuration(Temporal.Instant.from("2026-05-14T00:00:00Z")),
    false,
  );
});

test("isTemporalDuration() rejects bare objects tagged but missing shape", () => {
  const decoy = Object.create(null, {
    [Symbol.toStringTag]: { value: "Temporal.Duration" },
  });
  strictEqual(isTemporalDuration(decoy), false);
});

test("isTemporalDuration() rejects non-number sign", () => {
  const decoy = Object.create(null, {
    [Symbol.toStringTag]: { value: "Temporal.Duration" },
    sign: { value: "0" },
    toString: { value: () => "PT0S" },
  });
  strictEqual(isTemporalDuration(decoy), false);
});

test("isTemporalDuration() rejects out-of-range sign values", () => {
  // Real Temporal.Duration#sign is `-1 | 0 | 1` per spec, so anything else
  // (here, 42) must be rejected even though it is a number.
  const decoy = Object.create(null, {
    [Symbol.toStringTag]: { value: "Temporal.Duration" },
    sign: { value: 42 },
    toString: { value: () => "PT42S" },
  });
  strictEqual(isTemporalDuration(decoy), false);
});

test("isTemporalDuration() rejects default Object.prototype.toString", () => {
  const decoy = {
    [Symbol.toStringTag]: "Temporal.Duration",
    sign: 0,
  };
  strictEqual(isTemporalDuration(decoy), false);
});
