import { test } from "@fedify/fixture";
import { assertEquals } from "@std/assert";
import {
  CircuitBreaker,
  normalizeCircuitBreakerOptions,
  parseCircuitBreakerKvState,
} from "./circuit-breaker.ts";
import { type KvKey, type KvStoreSetOptions, MemoryKvStore } from "./kv.ts";

class AlwaysConflictingKvStore extends MemoryKvStore {
  attempts = 0;

  override cas(
    _key: KvKey,
    _expectedValue: unknown,
    _newValue: unknown,
    _options?: KvStoreSetOptions,
  ): Promise<boolean> {
    this.attempts++;
    if (this.attempts > 10) {
      throw new Error("beforeSend did not stop retrying CAS misses");
    }
    return Promise.resolve(false);
  }
}

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
  assertEquals(
    options.pruneFailures(
      [
        Temporal.Instant.from("2026-05-25T00:00:00Z"),
        Temporal.Instant.from("2026-05-25T00:09:00Z"),
        Temporal.Instant.from("2026-05-25T00:10:00Z"),
        Temporal.Instant.from("2026-05-25T00:11:00Z"),
        Temporal.Instant.from("2026-05-25T00:12:00Z"),
      ],
      Temporal.Instant.from("2026-05-25T00:12:00Z"),
    ).map((t) => t.toString()),
    [
      "2026-05-25T00:10:00Z",
      "2026-05-25T00:11:00Z",
      "2026-05-25T00:12:00Z",
    ],
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
    state: "open",
  });

  now = Temporal.Instant.from("2026-05-25T00:35:00Z");
  decision = await circuit.beforeSend("remote.example", {});
  assertEquals(decision, {
    type: "send",
    probe: true,
    stateChange: { previousState: "open", newState: "half-open" },
  });
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
  assertEquals(decision, { type: "send", probe: false });

  await kv.set(["_fedify", "circuit", "remote.example"], {
    state: "open",
    failures: [
      "2026-05-25T00:00:00Z",
      "2026-05-25T00:05:00Z",
    ],
    opened: "2026-05-25T00:05:00Z",
  });
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
      recoveryDelay: { seconds: 30 },
      releaseInterval: { seconds: 5 },
    },
  });

  await kv.set(["_fedify", "circuit", "remote.example"], {
    state: "half-open",
    failures: ["2026-05-24T23:00:00Z"],
    opened: "2026-05-24T23:00:00Z",
    halfOpened: "2026-05-24T23:59:54Z",
  });

  let decision = await circuit.beforeSend("remote.example", {});
  assertEquals(decision, {
    type: "hold",
    state: "half-open",
    delay: Temporal.Duration.from({ seconds: 5 }),
    heldSince: now,
  });
  assertEquals(await circuit.getState("remote.example"), {
    state: "half-open",
    failures: ["2026-05-24T23:00:00Z"],
    opened: "2026-05-24T23:00:00Z",
    halfOpened: "2026-05-24T23:59:54Z",
  });

  now = Temporal.Instant.from("2026-05-25T00:00:30Z");
  decision = await circuit.beforeSend("remote.example", {});
  assertEquals(decision, { type: "send", probe: true });
  assertEquals(await circuit.getState("remote.example"), {
    state: "half-open",
    failures: ["2026-05-24T23:00:00Z"],
    opened: "2026-05-24T23:00:00Z",
    halfOpened: "2026-05-25T00:00:30Z",
  });
});

test("CircuitBreaker caps held delays at activity TTL", async () => {
  const kv = new MemoryKvStore();
  const now = Temporal.Instant.from("2026-05-25T00:05:00Z");
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => now,
    options: {
      recoveryDelay: { minutes: 30 },
      heldActivityTtl: { minutes: 10 },
      releaseInterval: { minutes: 10 },
    },
  });

  await kv.set(["_fedify", "circuit", "new-open.example"], {
    state: "open",
    failures: ["2026-05-25T00:00:00Z"],
    opened: "2026-05-25T00:00:00Z",
  });
  let decision = await circuit.beforeSend("new-open.example", {});
  assertEquals(decision.type, "hold");
  if (decision.type === "hold") {
    assertEquals(decision.state, "open");
    assertEquals(decision.delay.total({ unit: "minute" }), 10);
    assertEquals(decision.heldSince.toString(), "2026-05-25T00:05:00Z");
  }

  await kv.set(["_fedify", "circuit", "open.example"], {
    state: "open",
    failures: ["2026-05-25T00:00:00Z"],
    opened: "2026-05-25T00:00:00Z",
  });
  decision = await circuit.beforeSend("open.example", {
    circuitHeldSince: "2026-05-25T00:00:00Z",
  });
  assertEquals(decision.type, "hold");
  if (decision.type === "hold") {
    assertEquals(decision.state, "open");
    assertEquals(decision.delay.total({ unit: "minute" }), 5);
    assertEquals(decision.heldSince.toString(), "2026-05-25T00:00:00Z");
  }

  await kv.set(["_fedify", "circuit", "half-open.example"], {
    state: "half-open",
    failures: ["2026-05-25T00:00:00Z"],
    opened: "2026-05-25T00:00:00Z",
    halfOpened: "2026-05-25T00:00:00Z",
  });
  decision = await circuit.beforeSend("half-open.example", {
    circuitHeldSince: "2026-05-25T00:00:00Z",
  });
  assertEquals(decision.type, "hold");
  if (decision.type === "hold") {
    assertEquals(decision.state, "half-open");
    assertEquals(decision.delay.total({ unit: "minute" }), 5);
    assertEquals(decision.heldSince.toString(), "2026-05-25T00:00:00Z");
  }
});

test("CircuitBreaker bounds beforeSend CAS retries", async () => {
  let kv = new AlwaysConflictingKvStore();
  const now = Temporal.Instant.from("2026-05-25T00:30:00Z");
  let circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => now,
    options: {
      recoveryDelay: { minutes: 30 },
      releaseInterval: { seconds: 5 },
    },
  });
  await kv.set(["_fedify", "circuit", "open.example"], {
    state: "open",
    failures: ["2026-05-25T00:00:00Z"],
    opened: "2026-05-25T00:00:00Z",
  });

  let decision = await circuit.beforeSend("open.example", {});
  assertEquals(kv.attempts, 10);
  assertEquals(decision, {
    type: "hold",
    state: "open",
    delay: Temporal.Duration.from({ seconds: 5 }),
    heldSince: now,
  });

  kv = new AlwaysConflictingKvStore();
  circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => now,
    options: {
      recoveryDelay: { minutes: 30 },
      releaseInterval: { seconds: 5 },
    },
  });
  await kv.set(["_fedify", "circuit", "half-open.example"], {
    state: "half-open",
    failures: ["2026-05-25T00:00:00Z"],
    opened: "2026-05-25T00:00:00Z",
    halfOpened: "2026-05-25T00:00:00Z",
  });

  decision = await circuit.beforeSend("half-open.example", {});
  assertEquals(kv.attempts, 10);
  assertEquals(decision, {
    type: "hold",
    state: "half-open",
    delay: Temporal.Duration.from({ seconds: 5 }),
    heldSince: now,
  });
});

test("CircuitBreaker prunes stale closed failure history", async () => {
  const kv = new MemoryKvStore();
  let now = Temporal.Instant.from("2026-05-25T00:00:00Z");
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => now,
    options: {
      failureThreshold: 2,
      failureWindow: { minutes: 10 },
    },
  });

  await circuit.recordFailure("sporadic.example");
  assertEquals(await circuit.getState("sporadic.example"), {
    state: "closed",
    failures: ["2026-05-25T00:00:00Z"],
  });

  now = Temporal.Instant.from("2026-05-25T00:20:00Z");
  await circuit.recordFailure("sporadic.example");
  assertEquals(await circuit.getState("sporadic.example"), {
    state: "closed",
    failures: ["2026-05-25T00:20:00Z"],
  });

  now = Temporal.Instant.from("2026-05-25T00:40:00Z");
  await circuit.recordFailure("sporadic.example");
  assertEquals(await circuit.getState("sporadic.example"), {
    state: "closed",
    failures: ["2026-05-25T00:40:00Z"],
  });
});
