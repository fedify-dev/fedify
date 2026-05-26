import { test } from "@fedify/fixture";
import { assertEquals } from "@std/assert";
import {
  CircuitBreaker,
  normalizeCircuitBreakerOptions,
  parseCircuitBreakerKvState,
} from "./circuit-breaker.ts";
import { MemoryKvStore } from "./kv.ts";

test("normalizeCircuitBreakerOptions() uses numeric failure policy", () => {
  const options = normalizeCircuitBreakerOptions({
    failureThreshold: 3,
    failureWindow: { minutes: 10 },
  });
  const failures = [
    Temporal.Instant.from("2026-05-25T00:00:00Z"),
    Temporal.Instant.from("2026-05-25T00:05:00Z"),
    Temporal.Instant.from("2026-05-25T00:10:00Z"),
  ];
  assertEquals(options.failure(failures.slice(0, 2)), false);
  assertEquals(options.failure(failures), true);
  assertEquals(
    options.failure([
      Temporal.Instant.from("2026-05-25T00:00:00Z"),
      Temporal.Instant.from("2026-05-25T00:11:00Z"),
      Temporal.Instant.from("2026-05-25T00:12:00Z"),
    ]),
    false,
  );
});

test("normalizeCircuitBreakerOptions() accepts callback failure policy", () => {
  const options = normalizeCircuitBreakerOptions({
    failure: (timestamps) => timestamps.length >= 2,
  });
  assertEquals(
    options.failure([Temporal.Instant.from("2026-05-25T00:00:00Z")]),
    false,
  );
  assertEquals(
    options.failure([
      Temporal.Instant.from("2026-05-25T00:00:00Z"),
      Temporal.Instant.from("2026-05-25T00:01:00Z"),
    ]),
    true,
  );
});

test("parseCircuitBreakerKvState() validates stored shape", () => {
  assertEquals(
    parseCircuitBreakerKvState({
      state: "open",
      failures: ["2026-05-25T00:00:00Z"],
      opened: "2026-05-25T00:00:00Z",
      halfOpened: "2026-05-25T00:00:00Z",
    }),
    {
      state: "open",
      failures: ["2026-05-25T00:00:00Z"],
      opened: "2026-05-25T00:00:00Z",
      halfOpened: "2026-05-25T00:00:00Z",
    },
  );
  assertEquals(parseCircuitBreakerKvState({ state: "open" }), undefined);
  assertEquals(
    parseCircuitBreakerKvState({ state: "other", failures: [] }),
    undefined,
  );
  assertEquals(
    parseCircuitBreakerKvState({ state: "open", failures: [], opened: 1 }),
    undefined,
  );
});

test("CircuitBreaker opens, probes, closes, and drops held activities", async () => {
  const kv = new MemoryKvStore();
  let now = Temporal.Instant.from("2026-05-25T00:00:00Z");
  const transitions: string[] = [];
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => now,
    options: {
      failureThreshold: 2,
      failureWindow: { minutes: 10 },
      recoveryDelay: { minutes: 30 },
      heldActivityTtl: { days: 7 },
      onStateChange(host, previousState, newState) {
        transitions.push(`${host}:${previousState}->${newState}`);
      },
    },
  });

  await circuit.recordFailure("remote.example");
  assertEquals(await circuit.getState("remote.example"), {
    state: "closed",
    failures: ["2026-05-25T00:00:00Z"],
  });

  now = Temporal.Instant.from("2026-05-25T00:05:00Z");
  await circuit.recordFailure("remote.example");
  assertEquals(await circuit.getState("remote.example"), {
    state: "open",
    failures: [
      "2026-05-25T00:00:00Z",
      "2026-05-25T00:05:00Z",
    ],
    opened: "2026-05-25T00:05:00Z",
  });
  assertEquals(transitions, ["remote.example:closed->open"]);

  let decision = await circuit.beforeSend("remote.example", {});
  assertEquals(decision, {
    type: "hold",
    delay: Temporal.Duration.from({ minutes: 30 }),
    heldSince: now,
  });

  now = Temporal.Instant.from("2026-05-25T00:35:00Z");
  decision = await circuit.beforeSend("remote.example", {});
  assertEquals(decision, { type: "send", probe: true });
  assertEquals(await circuit.getState("remote.example"), {
    state: "half-open",
    failures: [
      "2026-05-25T00:00:00Z",
      "2026-05-25T00:05:00Z",
    ],
    opened: "2026-05-25T00:05:00Z",
    halfOpened: "2026-05-25T00:35:00Z",
  });

  await circuit.recordSuccess("remote.example");
  assertEquals(await circuit.getState("remote.example"), undefined);
  assertEquals(transitions, [
    "remote.example:closed->open",
    "remote.example:open->half-open",
    "remote.example:half-open->closed",
  ]);

  decision = await circuit.beforeSend("remote.example", {
    circuitHeldSince: "2026-05-17T00:00:00Z",
  });
  assertEquals(decision, {
    type: "drop",
    heldSince: Temporal.Instant.from("2026-05-17T00:00:00Z"),
  });
});

test("CircuitBreaker recovers stale half-open probes", async () => {
  const kv = new MemoryKvStore();
  let now = Temporal.Instant.from("2026-05-25T00:00:00Z");
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => now,
    options: {
      releaseInterval: { seconds: 5 },
    },
  });

  await kv.set(["_fedify", "circuit", "remote.example"], {
    state: "half-open",
    failures: ["2026-05-24T23:00:00Z"],
    opened: "2026-05-24T23:00:00Z",
    halfOpened: "2026-05-24T23:59:56Z",
  });

  let decision = await circuit.beforeSend("remote.example", {});
  assertEquals(decision, {
    type: "hold",
    delay: Temporal.Duration.from({ seconds: 1 }),
    heldSince: now,
  });

  now = Temporal.Instant.from("2026-05-25T00:00:01Z");
  decision = await circuit.beforeSend("remote.example", {});
  assertEquals(decision, { type: "send", probe: true });
  assertEquals(await circuit.getState("remote.example"), {
    state: "half-open",
    failures: ["2026-05-24T23:00:00Z"],
    opened: "2026-05-24T23:00:00Z",
    halfOpened: "2026-05-25T00:00:01Z",
  });
});
