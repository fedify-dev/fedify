import { test } from "@fedify/fixture";
import { assertEquals, assertThrows } from "@std/assert";
import {
  CircuitBreaker,
  normalizeCircuitBreakerOptions,
  parseCircuitBreakerKvState,
} from "./circuit-breaker.ts";
import {
  type KvKey,
  type KvStore,
  type KvStoreListEntry,
  type KvStoreSetOptions,
  MemoryKvStore,
} from "./kv.ts";
import { markCircuitBreakerLegacySweepDone } from "./circuit-breaker-test-utils.ts";

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

class CountingCasKvStore extends MemoryKvStore {
  attempts = 0;
  options: (KvStoreSetOptions | undefined)[] = [];

  override cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    this.attempts++;
    this.options.push(options);
    return super.cas(key, expectedValue, newValue, options);
  }
}

class CountingSetKvStore implements KvStore {
  #store = new MemoryKvStore();
  keys: KvKey[] = [];
  options: (KvStoreSetOptions | undefined)[] = [];

  get<T = unknown>(key: KvKey): Promise<T | undefined> {
    return this.#store.get(key);
  }

  set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    this.keys.push(key);
    this.options.push(options);
    return this.#store.set(key, value, options);
  }

  delete(key: KvKey): Promise<void> {
    return this.#store.delete(key);
  }

  list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    return this.#store.list(prefix);
  }
}

class CountingSweepKvStore extends MemoryKvStore {
  listCalls = 0;
  markerGetCalls = 0;
  casCalls: {
    key: KvKey;
    options: KvStoreSetOptions | undefined;
  }[] = [];
  deletedKeys: KvKey[] = [];

  override get<T = unknown>(key: KvKey): Promise<T | undefined> {
    if (
      key.length === 4 &&
      key[0] === "_fedify" &&
      key[1] === "circuit" &&
      key[2] === "__fedify_meta" &&
      key[3] === "circuit_breaker_state_ttl_sweep_v1"
    ) {
      this.markerGetCalls++;
    }
    return super.get(key);
  }

  override cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    this.casCalls.push({ key, options });
    return super.cas(key, expectedValue, newValue, options);
  }

  override async *list(prefix?: KvKey) {
    this.listCalls++;
    yield* super.list(prefix);
  }

  override delete(key: KvKey): Promise<void> {
    this.deletedKeys.push(key);
    return super.delete(key);
  }
}

class UpdatingDuringListKvStore extends MemoryKvStore {
  override async *list(prefix?: KvKey) {
    for await (const entry of super.list(prefix)) {
      if (
        entry.key.length === 3 &&
        entry.key[0] === "_fedify" &&
        entry.key[1] === "circuit" &&
        entry.key[2] === "racy.example"
      ) {
        await super.set(entry.key, {
          state: "closed",
          failures: ["2026-05-25T00:01:00Z"],
        });
      }
      yield entry;
    }
  }
}

class FailingOnceSweepKvStore extends MemoryKvStore {
  listCalls = 0;
  deletedKeys: KvKey[] = [];

  override async *list(prefix?: KvKey) {
    this.listCalls++;
    if (this.listCalls === 1) {
      throw new Error("transient list failure");
    }
    yield* super.list(prefix);
  }

  override delete(key: KvKey): Promise<void> {
    this.deletedKeys.push(key);
    return super.delete(key);
  }
}

test("normalizeCircuitBreakerOptions() uses numeric failure policy", () => {
  const options = normalizeCircuitBreakerOptions({
    failureThreshold: 3,
    failureWindow: { minutes: 10 },
    heldActivityTtl: { hours: 1 },
    recoveryDelay: { hours: 2 },
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
  assertEquals(
    options.stateTtl,
    Temporal.Duration.from({ hours: 2, minutes: 10 }),
  );
});

test("normalizeCircuitBreakerOptions() validates numeric failure policy", () => {
  assertThrows(
    () => normalizeCircuitBreakerOptions({ failureThreshold: 0 }),
    TypeError,
    "failureThreshold",
  );
  assertThrows(
    () => normalizeCircuitBreakerOptions({ failureThreshold: 1.5 }),
    TypeError,
    "failureThreshold",
  );
});

test("normalizeCircuitBreakerOptions() truncates sub-millisecond durations", () => {
  const options = normalizeCircuitBreakerOptions({
    recoveryDelay: { milliseconds: 1, nanoseconds: 500_000 },
  });
  assertEquals(
    options.recoveryDelay,
    Temporal.Duration.from({ milliseconds: 1 }),
  );
});

test("normalizeCircuitBreakerOptions() validates positive durations", () => {
  assertThrows(
    () => normalizeCircuitBreakerOptions({ recoveryDelay: { seconds: 0 } }),
    RangeError,
    "recoveryDelay",
  );
  assertThrows(
    () => normalizeCircuitBreakerOptions({ heldActivityTtl: { seconds: 0 } }),
    RangeError,
    "heldActivityTtl",
  );
  assertThrows(
    () => normalizeCircuitBreakerOptions({ failureWindow: { seconds: 0 } }),
    RangeError,
    "failureWindow",
  );
  assertThrows(
    () => normalizeCircuitBreakerOptions({ releaseInterval: { seconds: 0 } }),
    RangeError,
    "releaseInterval",
  );
  assertThrows(
    () =>
      normalizeCircuitBreakerOptions({
        releaseInterval: { nanoseconds: 500_000 },
      }),
    RangeError,
    "releaseInterval",
  );
});

test("normalizeCircuitBreakerOptions() accepts callback failure policy", () => {
  const options = normalizeCircuitBreakerOptions({
    failure: (timestamps) => timestamps.length >= 2,
  });
  const base = Temporal.Instant.from("2026-05-25T00:00:00Z");
  const failures = Array.from(
    { length: 105 },
    (_, i) => base.add({ minutes: i }),
  );
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
  assertEquals(
    options.pruneFailures(
      failures,
      base.add({ minutes: 105 }),
    ).map((t) => t.toString()),
    failures.slice(-100).map((t) => t.toString()),
  );
});

test("parseCircuitBreakerKvState() validates stored shape", () => {
  assertEquals(
    parseCircuitBreakerKvState({
      state: "open",
      failures: ["2026-05-25T00:00:00Z"],
      opened: "2026-05-25T00:00:00Z",
      halfOpened: "2026-05-25T00:00:00Z",
      __fedifyCircuitBreakerStateVersion: 1,
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
  assertEquals(
    parseCircuitBreakerKvState({
      state: "open",
      failures: ["not an instant"],
    }),
    undefined,
  );
  assertEquals(
    parseCircuitBreakerKvState({
      state: "open",
      failures: [],
      halfOpened: "not an instant",
    }),
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
  assertEquals(decision, {
    type: "drop",
    heldSince: Temporal.Instant.from("2026-05-17T00:00:00Z"),
  });

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
  await markCircuitBreakerLegacySweepDone(kv);
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
  await markCircuitBreakerLegacySweepDone(kv);
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

test("CircuitBreaker ignores malformed held timestamps", async () => {
  const kv = new MemoryKvStore();
  await markCircuitBreakerLegacySweepDone(kv);
  const now = Temporal.Instant.from("2026-05-25T00:05:00Z");
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => now,
    options: { recoveryDelay: { minutes: 30 } },
  });

  await kv.set(["_fedify", "circuit", "malformed-held.example"], {
    state: "open",
    failures: ["2026-05-25T00:00:00Z"],
    opened: "2026-05-25T00:00:00Z",
  });

  const decision = await circuit.beforeSend("malformed-held.example", {
    circuitHeldSince: "not an instant",
  });

  assertEquals(decision, {
    type: "hold",
    state: "open",
    delay: Temporal.Duration.from({ minutes: 25 }),
    heldSince: now,
  });
});

test("CircuitBreaker bounds beforeSend CAS retries", async () => {
  let kv = new AlwaysConflictingKvStore();
  await markCircuitBreakerLegacySweepDone(kv);
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
  await markCircuitBreakerLegacySweepDone(kv);
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

test("CircuitBreaker skips recording failures for open circuits", async () => {
  const kv = new CountingCasKvStore();
  await markCircuitBreakerLegacySweepDone(kv);
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => Temporal.Instant.from("2026-05-25T00:01:00Z"),
  });
  await kv.set(["_fedify", "circuit", "open.example"], {
    state: "open",
    failures: ["2026-05-25T00:00:00Z"],
    opened: "2026-05-25T00:00:00Z",
  });

  assertEquals(await circuit.recordFailure("open.example"), undefined);
  assertEquals(kv.attempts, 0);
  assertEquals(
    await kv.get(["_fedify", "circuit", "open.example"]),
    {
      state: "open",
      failures: ["2026-05-25T00:00:00Z"],
      opened: "2026-05-25T00:00:00Z",
    },
  );
});

test("CircuitBreaker writes stored states with a TTL", async () => {
  const kv = new CountingCasKvStore();
  await markCircuitBreakerLegacySweepDone(kv);
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => Temporal.Instant.from("2026-05-25T00:00:00Z"),
    options: {
      failureThreshold: 2,
      failureWindow: { hours: 3 },
      recoveryDelay: { hours: 1 },
      heldActivityTtl: { days: 2 },
    },
  });

  await circuit.recordFailure("remote.example");

  assertEquals(kv.options.at(-1), {
    ttl: Temporal.Duration.from({ days: 2 }),
  });
});

test("CircuitBreaker writes stored states with a TTL without CAS", async () => {
  const kv = new CountingSetKvStore();
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => Temporal.Instant.from("2026-05-25T00:00:00Z"),
    options: {
      failureThreshold: 2,
      failureWindow: { hours: 3 },
      recoveryDelay: { hours: 1 },
      heldActivityTtl: { days: 2 },
    },
  });

  await circuit.recordFailure("remote.example");

  assertEquals(kv.keys, [["_fedify", "circuit", "remote.example"]]);
  assertEquals(kv.options.at(-1), {
    ttl: Temporal.Duration.from({ days: 2 }),
  });
});

test("CircuitBreaker preserves custom failure history by default", async () => {
  const kv = new CountingCasKvStore();
  await markCircuitBreakerLegacySweepDone(kv);
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => Temporal.Instant.from("2026-05-25T00:00:00Z"),
    options: {
      failure: (timestamps) => timestamps.length >= 2,
    },
  });

  await circuit.recordFailure("remote.example");

  assertEquals(kv.options.at(-1), undefined);
});

test("CircuitBreaker accepts an explicit TTL with custom failure policies", async () => {
  const kv = new CountingCasKvStore();
  await markCircuitBreakerLegacySweepDone(kv);
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => Temporal.Instant.from("2026-05-25T00:00:00Z"),
    options: {
      failure: (timestamps) => timestamps.length >= 2,
      stateTtl: { days: 14 },
    },
  });

  await circuit.recordFailure("remote.example");

  assertEquals(kv.options.at(-1), {
    ttl: Temporal.Duration.from({ days: 14 }),
  });
});

test("CircuitBreaker migrates legacy states without TTL once", async () => {
  const kv = new CountingSweepKvStore();
  await kv.set(["_fedify", "circuit", "stale-a.example"], {
    state: "closed",
    failures: ["2026-05-25T00:00:00Z"],
  });
  await kv.set(["_fedify", "circuit", "stale-b.example"], {
    state: "open",
    failures: ["2026-05-25T00:00:00Z"],
    opened: "2026-05-25T00:00:00Z",
  });
  await kv.set(["_fedify", "circuit", "malformed.example"], "stale");
  await kv.set(["_fedify", "other", "untouched.example"], "keep");
  await kv.set(["_fedify", "circuit", "__fedify_meta", "future"], {
    state: "closed",
    failures: ["2026-05-25T00:00:00Z"],
  });
  let now = Temporal.Instant.from("2026-05-25T00:00:00Z");
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => now,
    options: { failureThreshold: 2 },
  });

  assertEquals(await circuit.beforeSend("stale-b.example", {}), {
    type: "hold",
    state: "open",
    delay: Temporal.Duration.from({ minutes: 30 }),
    heldSince: Temporal.Instant.from("2026-05-25T00:00:00Z"),
  });
  await circuit.pendingSweep;

  assertEquals(
    await kv.get(["_fedify", "circuit", "stale-a.example"]),
    {
      state: "closed",
      failures: ["2026-05-25T00:00:00Z"],
      __fedifyCircuitBreakerStateVersion: 1,
    },
  );
  assertEquals(
    await kv.get(["_fedify", "circuit", "stale-b.example"]),
    {
      state: "open",
      failures: ["2026-05-25T00:00:00Z"],
      opened: "2026-05-25T00:00:00Z",
      __fedifyCircuitBreakerStateVersion: 1,
    },
  );
  assertEquals(
    await kv.get(["_fedify", "circuit", "malformed.example"]),
    undefined,
  );
  assertEquals(
    await kv.get(["_fedify", "other", "untouched.example"]),
    "keep",
  );
  assertEquals(
    await kv.get(["_fedify", "circuit", "__fedify_meta", "future"]),
    {
      state: "closed",
      failures: ["2026-05-25T00:00:00Z"],
    },
  );
  await circuit.recordFailure("remote.example");
  assertEquals(await circuit.getState("remote.example"), {
    state: "closed",
    failures: ["2026-05-25T00:00:00Z"],
  });
  assertEquals(kv.listCalls, 1);
  assertEquals(
    kv.casCalls.find(({ key }) =>
      key.length === 3 &&
      key[0] === "_fedify" &&
      key[1] === "circuit" &&
      key[2] === "stale-a.example"
    )?.options,
    { ttl: Temporal.Duration.from({ days: 7 }) },
  );
  assertEquals(kv.deletedKeys, [
    ["_fedify", "circuit", "malformed.example"],
  ]);
  assertEquals(
    await kv.get([
      "_fedify",
      "circuit",
      "__fedify_meta",
      "circuit_breaker_state_ttl_sweep_v1",
    ]),
    { state: "done", retryUntil: "2026-06-01T00:00:00Z" },
  );

  await kv.set(["_fedify", "circuit", "late-stale.example"], {
    state: "closed",
    failures: ["2026-05-25T00:00:00Z"],
  });
  await circuit.recordFailure("another.example");

  assertEquals(await kv.get(["_fedify", "circuit", "late-stale.example"]), {
    state: "closed",
    failures: ["2026-05-25T00:00:00Z"],
  });
  assertEquals(kv.listCalls, 1);

  now = Temporal.Instant.from("2026-06-02T00:00:00Z");
  await circuit.recordFailure("final.example");
  await circuit.pendingSweep;

  assertEquals(
    await kv.get(["_fedify", "circuit", "late-stale.example"]),
    {
      state: "closed",
      failures: ["2026-05-25T00:00:00Z"],
      __fedifyCircuitBreakerStateVersion: 1,
    },
  );
  assertEquals(await circuit.getState("another.example"), {
    state: "closed",
    failures: ["2026-05-25T00:00:00Z"],
  });
  assertEquals(kv.listCalls, 2);
  assertEquals(
    await kv.get([
      "_fedify",
      "circuit",
      "__fedify_meta",
      "circuit_breaker_state_ttl_sweep_v1",
    ]),
    { state: "final" },
  );
});

test("CircuitBreaker does not sweep state changed after listing", async () => {
  const kv = new UpdatingDuringListKvStore();
  await kv.set(["_fedify", "circuit", "racy.example"], {
    state: "closed",
    failures: ["2026-05-25T00:00:00Z"],
  });
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => Temporal.Instant.from("2026-05-25T00:02:00Z"),
    options: { failureThreshold: 2 },
  });

  await circuit.recordFailure("remote.example");
  await circuit.pendingSweep;

  assertEquals(await kv.get(["_fedify", "circuit", "racy.example"]), {
    state: "closed",
    failures: ["2026-05-25T00:01:00Z"],
  });
});

test("CircuitBreaker skips legacy sweep already running elsewhere", async () => {
  const kv = new CountingSweepKvStore();
  await kv.set([
    "_fedify",
    "circuit",
    "__fedify_meta",
    "circuit_breaker_state_ttl_sweep_v1",
  ], {
    state: "sweeping",
    started: "2026-05-25T00:00:00Z",
    retryUntil: "2026-06-01T00:00:00Z",
  });
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => Temporal.Instant.from("2026-05-25T00:00:00Z"),
    options: { failureThreshold: 2 },
  });

  await circuit.recordFailure("remote.example");

  assertEquals(kv.listCalls, 0);
  assertEquals(await circuit.getState("remote.example"), {
    state: "closed",
    failures: ["2026-05-25T00:00:00Z"],
  });
});

test("CircuitBreaker caches completed legacy sweep markers", async () => {
  const doneKv = new CountingSweepKvStore();
  await doneKv.set([
    "_fedify",
    "circuit",
    "__fedify_meta",
    "circuit_breaker_state_ttl_sweep_v1",
  ], {
    state: "done",
    retryUntil: "2026-06-01T00:00:00Z",
  });
  let now = Temporal.Instant.from("2026-05-25T00:00:00Z");
  const doneCircuit = new CircuitBreaker({
    kv: doneKv,
    prefix: ["_fedify", "circuit"],
    now: () => now,
    options: { failureThreshold: 2 },
  });

  await doneCircuit.recordFailure("remote.example");
  await doneCircuit.pendingSweep;
  await doneCircuit.recordFailure("another.example");
  await doneCircuit.pendingSweep;

  assertEquals(doneKv.markerGetCalls, 1);

  now = Temporal.Instant.from("2026-06-02T00:00:00Z");
  await doneCircuit.recordFailure("final.example");
  await doneCircuit.pendingSweep;

  assertEquals(doneKv.markerGetCalls, 2);

  const finalKv = new CountingSweepKvStore();
  await markCircuitBreakerLegacySweepDone(finalKv);
  const finalCircuit = new CircuitBreaker({
    kv: finalKv,
    prefix: ["_fedify", "circuit"],
    now: () => Temporal.Instant.from("2026-05-25T00:00:00Z"),
    options: { failureThreshold: 2 },
  });

  await finalCircuit.recordFailure("remote.example");
  await finalCircuit.pendingSweep;
  await finalCircuit.recordFailure("another.example");
  await finalCircuit.pendingSweep;

  assertEquals(finalKv.markerGetCalls, 1);
});

test("CircuitBreaker ignores malformed legacy sweep retry markers", async () => {
  const kv = new CountingSweepKvStore();
  await kv.set([
    "_fedify",
    "circuit",
    "__fedify_meta",
    "circuit_breaker_state_ttl_sweep_v1",
  ], {
    state: "done",
    retryUntil: "not an instant",
  });
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => Temporal.Instant.from("2026-05-25T00:00:00Z"),
    options: { failureThreshold: 2 },
  });

  await circuit.recordFailure("remote.example");
  await circuit.pendingSweep;

  assertEquals(kv.listCalls, 0);
  assertEquals(await circuit.getState("remote.example"), {
    state: "closed",
    failures: ["2026-05-25T00:00:00Z"],
  });
});

test("CircuitBreaker retries legacy sweep after transient failures", async () => {
  const kv = new FailingOnceSweepKvStore();
  const circuit = new CircuitBreaker({
    kv,
    prefix: ["_fedify", "circuit"],
    now: () => Temporal.Instant.from("2026-05-25T00:00:00Z"),
    options: { failureThreshold: 2 },
  });

  await circuit.recordFailure("remote.example");
  await circuit.pendingSweep;
  assertEquals(
    await kv.get([
      "_fedify",
      "circuit",
      "__fedify_meta",
      "circuit_breaker_state_ttl_sweep_v1",
    ]),
    undefined,
  );
  assertEquals(kv.deletedKeys, [[
    "_fedify",
    "circuit",
    "__fedify_meta",
    "circuit_breaker_state_ttl_sweep_v1",
  ]]);
  assertEquals(await circuit.getState("remote.example"), {
    state: "closed",
    failures: ["2026-05-25T00:00:00Z"],
  });

  await circuit.recordFailure("another.example");
  await circuit.pendingSweep;
  assertEquals(kv.listCalls, 2);
  assertEquals(await circuit.getState("another.example"), {
    state: "closed",
    failures: ["2026-05-25T00:00:00Z"],
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
