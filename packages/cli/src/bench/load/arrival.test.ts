import assert from "node:assert/strict";
import test from "node:test";
import { createSeededRng, scheduleArrivals } from "./arrival.ts";

test("scheduleArrivals - constant spacing equals 1/rate", () => {
  const offsets = [
    ...scheduleArrivals({
      ratePerSec: 100,
      durationMs: 100,
      arrival: "constant",
    }),
  ];
  assert.strictEqual(offsets.length, 10);
  assert.strictEqual(offsets[0], 0);
  for (let i = 1; i < offsets.length; i++) {
    assert.ok(Math.abs(offsets[i] - offsets[i - 1] - 10) < 1e-9);
  }
});

test("scheduleArrivals - empty for non-positive rate or duration", () => {
  assert.deepEqual(
    [...scheduleArrivals({
      ratePerSec: 0,
      durationMs: 100,
      arrival: "constant",
    })],
    [],
  );
  assert.deepEqual(
    [...scheduleArrivals({
      ratePerSec: 100,
      durationMs: 0,
      arrival: "constant",
    })],
    [],
  );
});

test("scheduleArrivals - poisson mean spacing approximates 1/rate", () => {
  const offsets = [
    ...scheduleArrivals({
      ratePerSec: 100, // mean gap 10ms
      durationMs: 100_000,
      arrival: "poisson",
      rng: createSeededRng(42),
    }),
  ];
  assert.ok(offsets.length > 8000, `got ${offsets.length} arrivals`);
  const meanGap = offsets[offsets.length - 1] / (offsets.length - 1);
  assert.ok(Math.abs(meanGap - 10) < 1, `mean gap ${meanGap} ≈ 10`);
  for (let i = 1; i < offsets.length; i++) {
    assert.ok(offsets[i] > offsets[i - 1]);
  }
});

test("scheduleArrivals - poisson is reproducible for a given seed", () => {
  const make = () => [...scheduleArrivals({
    ratePerSec: 50,
    durationMs: 1000,
    arrival: "poisson",
    rng: createSeededRng(7),
  })];
  assert.deepEqual(make(), make());
});
