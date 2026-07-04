import { getLogger } from "@logtape/logtape";
import type { Activity } from "@fedify/vocab";
import type { KvKey, KvStore } from "./kv.ts";

/**
 * The state of a remote host circuit breaker.
 * @since 2.3.0
 */
export type CircuitBreakerState = "closed" | "open" | "half-open";

/**
 * The JSON-serializable state stored in the configured {@link KvStore}.
 * @since 2.3.0
 */
export interface CircuitBreakerKvState {
  readonly state: CircuitBreakerState;
  readonly failures: readonly string[];
  readonly opened?: string;
  readonly halfOpened?: string;
}

type StoredCircuitBreakerKvState = CircuitBreakerKvState & {
  readonly __fedifyCircuitBreakerStateVersion?: 1;
};

/**
 * Details passed to {@link CircuitBreakerOptions.onActivityDrop} when a held
 * activity expires before the remote host recovers.
 * @since 2.3.0
 */
export interface CircuitBreakerActivityDrop {
  /** The inbox URL that would have received the activity. */
  readonly inbox: URL;
  /** The activity that was dropped. */
  readonly activity: Activity;
  /** The activity ID, when known. */
  readonly activityId?: string;
  /** The activity type. */
  readonly activityType: string;
  /** The actor IDs represented by this inbox. */
  readonly actorIds: readonly URL[];
  /** The time when Fedify first held this activity. */
  readonly heldSince: Temporal.Instant;
}

/**
 * Configures how a remote host circuit opens after repeated delivery
 * failures.
 * @since 2.3.0
 */
export type CircuitBreakerFailurePolicy =
  | {
    failure(timestamps: readonly Temporal.Instant[]): boolean;
    readonly failureThreshold?: never;
    readonly failureWindow?: never;
  }
  | {
    readonly failure?: never;
    readonly failureThreshold?: number;
    readonly failureWindow?: Temporal.Duration | Temporal.DurationLike;
  };

/**
 * Options for Fedify's outbound activity circuit breaker.
 * @since 2.3.0
 */
export type CircuitBreakerOptions = CircuitBreakerFailurePolicy & {
  /**
   * How long an open circuit waits before allowing a half-open recovery probe.
   * @default `{ minutes: 30 }`
   */
  readonly recoveryDelay?: Temporal.Duration | Temporal.DurationLike;

  /**
   * How long Fedify keeps requeueing activities held by an open circuit before
   * dropping them.
   * @default `{ days: 7 }`
   */
  readonly heldActivityTtl?: Temporal.Duration | Temporal.DurationLike;

  /**
   * How often other held activities retry while a half-open probe is in
   * flight.  The probe is treated as stale after the recovery delay.
   * @default `{ seconds: 1 }`
   */
  readonly releaseInterval?: Temporal.Duration | Temporal.DurationLike;

  /**
   * How long Fedify keeps circuit breaker state in the configured key-value
   * store.
   *
   * When omitted, Fedify derives this from `failureWindow`, `recoveryDelay`, and
   * `heldActivityTtl` for the default numeric failure policy.  Custom `failure`
   * callbacks do not have an inspectable time window, so custom policies do not
   * expire their stored state unless this option is provided.
   */
  readonly stateTtl?: Temporal.Duration | Temporal.DurationLike;

  /**
   * Called whenever the circuit state changes.
   */
  readonly onStateChange?: (
    remoteHost: string,
    previousState: CircuitBreakerState,
    newState: CircuitBreakerState,
  ) => void | Promise<void>;

  /**
   * Called when an activity held by the circuit breaker expires.
   */
  readonly onActivityDrop?: (
    remoteHost: string,
    details: CircuitBreakerActivityDrop,
  ) => void | Promise<void>;
};

/**
 * Normalized circuit breaker options used internally by Fedify.
 * @internal
 */
export interface NormalizedCircuitBreakerOptions {
  readonly failure: (timestamps: readonly Temporal.Instant[]) => boolean;
  readonly pruneFailures: (
    timestamps: readonly Temporal.Instant[],
    now: Temporal.Instant,
  ) => readonly Temporal.Instant[];
  readonly recoveryDelay: Temporal.Duration;
  readonly heldActivityTtl: Temporal.Duration;
  readonly releaseInterval: Temporal.Duration;
  readonly stateTtl: Temporal.Duration | undefined;
  readonly onStateChange?: CircuitBreakerOptions["onStateChange"];
  readonly onActivityDrop?: CircuitBreakerOptions["onActivityDrop"];
}

const MAX_CUSTOM_FAILURE_HISTORY = 100;
// Fedify 2.3.0 and 2.3.1 wrote circuit breaker state without a TTL, so those
// soft-state entries could live forever for hosts that never recovered.  Keep a
// marker under the circuit prefix to clear old state on CAS-backed stores after
// upgrade, then retry once after a grace window in case old workers wrote more
// no-TTL state during a rolling deployment.  See:
// https://github.com/fedify-dev/fedify/issues/916
const LEGACY_SWEEP_MARKER = [
  "__fedify_meta",
  "circuit_breaker_state_ttl_sweep_v1",
] as const;
const LEGACY_SWEEP_DELETING_MARKER = {
  __fedifyDeletingCircuitBreakerLegacyState: true,
};
const CIRCUIT_BREAKER_STATE_VERSION = 1;
const LEGACY_SWEEP_LOCK_TTL = Temporal.Duration.from({ minutes: 5 });
const LEGACY_SWEEP_RETRY_WINDOW = Temporal.Duration.from({ hours: 24 * 7 });
const LEGACY_SWEEP_WAIT_INTERVAL = 10;

type LegacySweepMarker =
  | {
    readonly state: "sweeping";
    readonly started: string;
    readonly retryUntil: string;
  }
  | { readonly state: "done"; readonly retryUntil: string }
  | { readonly state: "final" };

/**
 * Constructor options for {@link CircuitBreaker}.
 * @internal
 */
export interface CircuitBreakerCreateOptions {
  readonly kv: KvStore;
  readonly prefix: KvKey;
  readonly options?: CircuitBreakerOptions;
  readonly now?: () => Temporal.Instant;
  /**
   * Observes state changes after user callbacks have run.
   * @internal
   */
  readonly stateChangeObserver?: (
    remoteHost: string,
    previousState: CircuitBreakerState,
    newState: CircuitBreakerState,
  ) => void | Promise<void>;
}

/**
 * The delivery decision returned by {@link CircuitBreaker.beforeSend}.
 * @internal
 */
export type CircuitBreakerBeforeSendDecision =
  | {
    readonly type: "send";
    readonly probe: boolean;
    readonly stateChange?: CircuitBreakerStateChange;
  }
  | {
    readonly type: "hold";
    readonly state: "open" | "half-open";
    readonly delay: Temporal.Duration;
    readonly heldSince: Temporal.Instant;
  }
  | { readonly type: "drop"; readonly heldSince: Temporal.Instant };

/**
 * A circuit breaker state transition.
 * @since 2.3.0
 */
export interface CircuitBreakerStateChange {
  readonly previousState: CircuitBreakerState;
  readonly newState: CircuitBreakerState;
}

/**
 * Tracks reachability state for remote outbox delivery hosts.
 * @since 2.3.0
 */
export class CircuitBreaker {
  readonly #kv: KvStore;
  readonly #prefix: KvKey;
  readonly #options: NormalizedCircuitBreakerOptions;
  readonly #now: () => Temporal.Instant;
  #legacySweep: Promise<void> | undefined;
  readonly #stateChangeObserver:
    | CircuitBreakerCreateOptions["stateChangeObserver"]
    | undefined;

  constructor(options: CircuitBreakerCreateOptions) {
    this.#kv = options.kv;
    this.#prefix = options.prefix;
    this.#options = normalizeCircuitBreakerOptions(options.options ?? {});
    this.#now = options.now ?? (() => Temporal.Now.instant());
    this.#stateChangeObserver = options.stateChangeObserver;
  }

  get options(): NormalizedCircuitBreakerOptions {
    return this.#options;
  }

  capHeldDelay(
    heldSince: Temporal.Instant,
    delay: Temporal.Duration,
  ): Temporal.Duration {
    const now = this.#now();
    return now.until(
      this.#capHeldRetryAt(now, heldSince, now.add(delay)),
    );
  }

  async beforeSend(
    remoteHost: string,
    message: { readonly circuitHeldSince?: string },
  ): Promise<CircuitBreakerBeforeSendDecision> {
    this.#sweepLegacyStates();
    const heldSince = parseHeldSince(message.circuitHeldSince);
    const now = this.#now();
    if (
      heldSince != null &&
      Temporal.Instant.compare(
          heldSince.add(this.#options.heldActivityTtl),
          now,
        ) <=
        0
    ) {
      return { type: "drop", heldSince };
    }
    let lastConflictingState: "open" | "half-open" | undefined;

    for (let attempt = 0; attempt < 10; attempt++) {
      const oldState = await this.#get(remoteHost);
      if (oldState == null || oldState.state === "closed") {
        return { type: "send", probe: false };
      }
      if (oldState.state === "half-open") {
        const halfOpened = oldState.halfOpened == null
          ? undefined
          : Temporal.Instant.from(oldState.halfOpened);
        if (halfOpened != null) {
          const staleAt = halfOpened.add(this.#options.recoveryDelay);
          if (Temporal.Instant.compare(now, staleAt) < 0) {
            const releaseAt = now.add(this.#options.releaseInterval);
            const retryAt = Temporal.Instant.compare(releaseAt, staleAt) < 0
              ? releaseAt
              : staleAt;
            const cappedRetryAt = this.#capHeldRetryAt(
              now,
              heldSince,
              retryAt,
            );
            return {
              type: "hold",
              state: "half-open",
              delay: now.until(cappedRetryAt),
              heldSince: heldSince ?? now,
            };
          }
        }
        const newState = {
          ...oldState,
          state: "half-open",
          halfOpened: now.toString(),
        } satisfies CircuitBreakerKvState;
        if (await this.#replace(remoteHost, oldState, newState)) {
          return { type: "send", probe: true };
        }
        lastConflictingState = "half-open";
        continue;
      }

      const opened = oldState.opened == null
        ? now
        : Temporal.Instant.from(oldState.opened);
      const probeAt = opened.add(this.#options.recoveryDelay);
      if (Temporal.Instant.compare(now, probeAt) < 0) {
        const retryAt = this.#capHeldRetryAt(now, heldSince, probeAt);
        return {
          type: "hold",
          state: "open",
          delay: now.until(retryAt),
          heldSince: heldSince ?? now,
        };
      }

      const newState = {
        ...oldState,
        state: "half-open",
        halfOpened: now.toString(),
      } satisfies CircuitBreakerKvState;
      if (await this.#replace(remoteHost, oldState, newState)) {
        await this.#notifyStateChange(remoteHost, "open", "half-open");
        return {
          type: "send",
          probe: true,
          stateChange: { previousState: "open", newState: "half-open" },
        };
      }
      lastConflictingState = "open";
    }
    if (lastConflictingState != null) {
      const retryAt = this.#capHeldRetryAt(
        now,
        heldSince,
        now.add(this.#options.releaseInterval),
      );
      return {
        type: "hold",
        state: lastConflictingState,
        delay: now.until(retryAt),
        heldSince: heldSince ?? now,
      };
    }
    throw new Error(`Failed to update circuit breaker state for ${remoteHost}`);
  }

  async recordSuccess(
    remoteHost: string,
  ): Promise<CircuitBreakerStateChange | undefined> {
    this.#sweepLegacyStates();
    for (let attempt = 0; attempt < 10; attempt++) {
      const oldState = await this.#get(remoteHost);
      if (oldState == null) return undefined;
      if (await this.#replace(remoteHost, oldState, undefined)) {
        if (oldState.state !== "closed") {
          await this.#notifyStateChange(remoteHost, oldState.state, "closed");
          return {
            previousState: oldState.state,
            newState: "closed",
          };
        }
        return undefined;
      }
    }
    throw new Error(`Failed to update circuit breaker state for ${remoteHost}`);
  }

  async recordReachableFailure(
    remoteHost: string,
  ): Promise<CircuitBreakerStateChange | undefined> {
    return await this.recordSuccess(remoteHost);
  }

  async recordFailure(
    remoteHost: string,
  ): Promise<CircuitBreakerStateChange | undefined> {
    this.#sweepLegacyStates();
    const now = this.#now();
    for (let attempt = 0; attempt < 10; attempt++) {
      const oldState = await this.#get(remoteHost);
      if (oldState?.state === "open") return undefined;
      const oldFailures = oldState?.failures.map(Temporal.Instant.from) ?? [];
      const failures = this.#options.pruneFailures(
        [...oldFailures, now],
        now,
      );
      let newState: CircuitBreakerKvState;
      let transition: [CircuitBreakerState, CircuitBreakerState] | undefined;
      if (
        oldState?.state === "half-open" || this.#options.failure(failures)
      ) {
        newState = {
          state: "open",
          failures: failures.map((t) => t.toString()),
          opened: now.toString(),
        };
        transition = [oldState?.state ?? "closed", "open"];
      } else {
        newState = {
          state: "closed",
          failures: failures.map((t) => t.toString()),
        };
      }
      if (await this.#replace(remoteHost, oldState, newState)) {
        if (transition != null) {
          await this.#notifyStateChange(
            remoteHost,
            transition[0],
            transition[1],
          );
          return {
            previousState: transition[0],
            newState: transition[1],
          };
        }
        return undefined;
      }
    }
    throw new Error(`Failed to update circuit breaker state for ${remoteHost}`);
  }

  async dropActivity(
    remoteHost: string,
    details: CircuitBreakerActivityDrop,
  ): Promise<void> {
    try {
      await this.#options.onActivityDrop?.(remoteHost, details);
    } catch (error) {
      getLogger(["fedify", "federation", "circuit"]).error(
        "An unexpected error occurred in circuit breaker activity drop " +
          "handler:\n{error}",
        { remoteHost, error },
      );
    }
  }

  async getState(
    remoteHost: string,
  ): Promise<CircuitBreakerKvState | undefined> {
    this.#sweepLegacyStates();
    return stripStoredCircuitBreakerState(await this.#get(remoteHost));
  }

  /**
   * The currently running background legacy sweep, if any.
   * @internal
   */
  get pendingSweep(): Promise<void> | undefined {
    return this.#legacySweep;
  }

  #key(remoteHost: string): KvKey {
    return [...this.#prefix, remoteHost] as KvKey;
  }

  #legacySweepMarkerKey(): KvKey {
    return [...this.#prefix, ...LEGACY_SWEEP_MARKER] as KvKey;
  }

  #sweepLegacyStates(): void {
    if (this.#kv.cas == null) return;
    if (this.#legacySweep != null) return;
    this.#legacySweep = this.#sweepLegacyStatesImpl()
      .catch((error) => {
        getLogger(["fedify", "federation", "circuit"]).warn(
          "Failed to sweep legacy circuit breaker state:\n{error}",
          { error },
        );
      })
      .finally(() => {
        this.#legacySweep = undefined;
      });
  }

  async #sweepLegacyStatesImpl(): Promise<void> {
    const markerKey = this.#legacySweepMarkerKey();
    const marker = await this.#acquireLegacySweep(markerKey);
    if (marker === "done") return;
    try {
      for await (const { key, value } of this.#kv.list(this.#prefix)) {
        if (isEqualKvKey(key, markerKey)) continue;
        await this.#migrateLegacyState(key, value);
      }
    } catch (error) {
      await this.#deleteIfUnchanged(markerKey, marker);
      throw error;
    }
    await this.#kv.set(
      markerKey,
      this.#finishLegacySweepMarker(marker),
    );
  }

  #finishLegacySweepMarker(marker: LegacySweepMarker): LegacySweepMarker {
    if (
      "retryUntil" in marker &&
      Temporal.Instant.compare(
          this.#now(),
          Temporal.Instant.from(marker.retryUntil),
        ) <
        0
    ) {
      return { state: "done", retryUntil: marker.retryUntil };
    }
    return { state: "final" };
  }

  async #migrateLegacyState(key: KvKey, value: unknown): Promise<void> {
    if (isCurrentCircuitBreakerState(value)) return;
    const state = parseCircuitBreakerKvState(value);
    if (state != null) {
      await this.#kv.cas?.(
        key,
        value,
        markCircuitBreakerState(state),
        this.#setOptions(),
      );
      return;
    }
    await this.#deleteIfUnchanged(key, value);
  }

  async #deleteIfUnchanged(key: KvKey, value: unknown): Promise<void> {
    if (
      await this.#kv.cas?.(key, value, LEGACY_SWEEP_DELETING_MARKER, {
        ttl: LEGACY_SWEEP_LOCK_TTL,
      })
    ) {
      await this.#kv.delete(key);
    }
  }

  async #acquireLegacySweep(
    markerKey: KvKey,
  ): Promise<LegacySweepMarker | "done"> {
    while (true) {
      const marker = await this.#kv.get(markerKey);
      if (isLegacySweepDone(marker, this.#now())) return "done";
      if (isLegacySweepInProgress(marker)) {
        return "done";
      }
      if (marker != null && !isLegacySweepRetryDue(marker, this.#now())) {
        return "done";
      }
      const retryUntil = isLegacySweepRetryDue(marker, this.#now())
        ? marker.retryUntil
        : this.#now().add(LEGACY_SWEEP_RETRY_WINDOW).toString();
      const sweeping = {
        state: "sweeping",
        started: this.#now().toString(),
        retryUntil,
      } satisfies LegacySweepMarker;
      if (
        await this.#kv.cas?.(markerKey, marker ?? undefined, sweeping, {
          ttl: LEGACY_SWEEP_LOCK_TTL,
        })
      ) {
        return sweeping;
      }
      await delay(LEGACY_SWEEP_WAIT_INTERVAL);
    }
  }

  #capHeldRetryAt(
    now: Temporal.Instant,
    heldSince: Temporal.Instant | undefined,
    retryAt: Temporal.Instant,
  ): Temporal.Instant {
    const heldFrom = heldSince ?? now;
    const expiresAt = heldFrom.add(this.#options.heldActivityTtl);
    return Temporal.Instant.compare(expiresAt, retryAt) < 0
      ? expiresAt
      : retryAt;
  }

  async #get(
    remoteHost: string,
  ): Promise<StoredCircuitBreakerKvState | undefined> {
    return parseStoredCircuitBreakerKvState(
      await this.#kv.get(this.#key(remoteHost)),
    );
  }

  async #replace(
    remoteHost: string,
    oldState: StoredCircuitBreakerKvState | undefined,
    newState: CircuitBreakerKvState | undefined,
  ): Promise<boolean> {
    const key = this.#key(remoteHost);
    const storedState = newState == null ? undefined : markCircuitBreakerState(
      newState,
    );
    if (this.#kv.cas == null) {
      if (storedState == null) {
        await this.#kv.delete(key);
      } else {
        await this.#kv.set(key, storedState, this.#setOptions());
      }
      return true;
    }
    return await this.#kv.cas(
      key,
      oldState,
      storedState,
      storedState == null ? undefined : this.#setOptions(),
    );
  }

  #setOptions(): { ttl: Temporal.Duration } | undefined {
    return this.#options.stateTtl == null
      ? undefined
      : { ttl: this.#options.stateTtl };
  }

  async #notifyStateChange(
    remoteHost: string,
    previousState: CircuitBreakerState,
    newState: CircuitBreakerState,
  ): Promise<void> {
    try {
      await this.#options.onStateChange?.(remoteHost, previousState, newState);
    } catch (error) {
      getLogger(["fedify", "federation", "circuit"]).error(
        "An unexpected error occurred in circuit breaker state change " +
          "handler:\n{error}",
        { remoteHost, previousState, newState, error },
      );
    }
    try {
      await this.#stateChangeObserver?.(remoteHost, previousState, newState);
    } catch (error) {
      getLogger(["fedify", "federation", "circuit"]).error(
        "An unexpected error occurred in circuit breaker state change " +
          "observer:\n{error}",
        { remoteHost, previousState, newState, error },
      );
    }
  }
}

/**
 * Normalizes user-provided circuit breaker options into the internal policy
 * shape used while processing queued outbox deliveries.
 *
 * @param options The public circuit breaker options supplied to Fedify.
 * @returns The normalized failure predicate, failure pruning function,
 * duration values, and optional callbacks with defaults applied.
 * @throws {RangeError} If any configured duration is not positive.
 * @throws {TypeError} If `failureThreshold` is not a positive integer.
 */
export function normalizeCircuitBreakerOptions(
  options: CircuitBreakerOptions,
): NormalizedCircuitBreakerOptions {
  const recoveryDelay = toInstantDuration(
    options.recoveryDelay ?? { minutes: 30 },
  );
  const heldActivityTtl = toInstantDuration(
    options.heldActivityTtl ?? { hours: 24 * 7 },
  );
  const releaseInterval = toInstantDuration(
    options.releaseInterval ?? { seconds: 1 },
  );
  const configuredStateTtl = options.stateTtl == null
    ? undefined
    : toInstantDuration(options.stateTtl);
  assertPositiveDuration(recoveryDelay, "recoveryDelay");
  assertPositiveDuration(heldActivityTtl, "heldActivityTtl");
  assertPositiveDuration(releaseInterval, "releaseInterval");
  if (configuredStateTtl != null) {
    assertPositiveDuration(configuredStateTtl, "stateTtl");
  }
  let failure: (timestamps: readonly Temporal.Instant[]) => boolean;
  let pruneFailures: (
    timestamps: readonly Temporal.Instant[],
    now: Temporal.Instant,
  ) => readonly Temporal.Instant[];
  let stateTtl: Temporal.Duration | undefined;
  if (options.failure == null) {
    const failureThreshold = options.failureThreshold ?? 5;
    if (!Number.isInteger(failureThreshold) || failureThreshold <= 0) {
      throw new TypeError("failureThreshold must be a positive integer.");
    }
    const failureWindow = toInstantDuration(
      options.failureWindow ?? { minutes: 10 },
    );
    assertPositiveDuration(failureWindow, "failureWindow");
    pruneFailures = (timestamps, now) => {
      const earliest = now.subtract(failureWindow);
      return timestamps
        .filter((timestamp) =>
          Temporal.Instant.compare(timestamp, earliest) >= 0
        )
        .slice(-failureThreshold);
    };
    failure = (timestamps) => {
      if (timestamps.length < failureThreshold) return false;
      const first = timestamps[timestamps.length - failureThreshold];
      const last = timestamps[timestamps.length - 1];
      return Temporal.Duration.compare(first.until(last), failureWindow) <= 0;
    };
    stateTtl = configuredStateTtl ??
      maxDuration(recoveryDelay, heldActivityTtl, failureWindow);
  } else {
    failure = options.failure;
    pruneFailures = (timestamps) =>
      timestamps.slice(-MAX_CUSTOM_FAILURE_HISTORY);
    stateTtl = configuredStateTtl;
  }
  return {
    failure,
    pruneFailures,
    recoveryDelay,
    heldActivityTtl,
    releaseInterval,
    stateTtl,
    onStateChange: options.onStateChange,
    onActivityDrop: options.onActivityDrop,
  };
}

function maxDuration(
  duration: Temporal.Duration,
  ...durations: Temporal.Duration[]
): Temporal.Duration {
  return durations.reduce(
    (max, candidate) =>
      Temporal.Duration.compare(candidate, max) > 0 ? candidate : max,
    duration,
  );
}

function isEqualKvKey(left: KvKey, right: KvKey): boolean {
  return left.length === right.length &&
    left.every((part, index) => part === right[index]);
}

function isLegacySweepDone(
  value: unknown,
  now: Temporal.Instant,
): value is LegacySweepMarker {
  if (typeof value !== "object" || value == null || !("state" in value)) {
    return false;
  }
  if (value.state === "final") return true;
  if (
    value.state === "done" && "retryUntil" in value &&
    typeof value.retryUntil === "string"
  ) {
    return Temporal.Instant.compare(
      now,
      Temporal.Instant.from(value.retryUntil),
    ) <
      0;
  }
  return false;
}

function isLegacySweepRetryDue(
  value: unknown,
  now: Temporal.Instant,
): value is Extract<LegacySweepMarker, { state: "done" }> {
  return typeof value === "object" && value != null &&
    "state" in value && value.state === "done" &&
    "retryUntil" in value && typeof value.retryUntil === "string" &&
    Temporal.Instant.compare(now, Temporal.Instant.from(value.retryUntil)) >= 0;
}

function isLegacySweepInProgress(value: unknown): boolean {
  return typeof value === "object" && value != null &&
    "state" in value && value.state === "sweeping";
}

function isCurrentCircuitBreakerState(value: unknown): boolean {
  return typeof value === "object" && value != null &&
    "__fedifyCircuitBreakerStateVersion" in value &&
    value.__fedifyCircuitBreakerStateVersion === CIRCUIT_BREAKER_STATE_VERSION;
}

function markCircuitBreakerState(
  state: CircuitBreakerKvState,
): StoredCircuitBreakerKvState {
  return {
    ...state,
    __fedifyCircuitBreakerStateVersion: CIRCUIT_BREAKER_STATE_VERSION,
  };
}

function stripStoredCircuitBreakerState(
  state: StoredCircuitBreakerKvState | undefined,
): CircuitBreakerKvState | undefined {
  if (state == null) return undefined;
  const { __fedifyCircuitBreakerStateVersion: _, ...publicState } = state;
  return publicState;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function toInstantDuration(
  duration: Temporal.Duration | Temporal.DurationLike,
): Temporal.Duration {
  const parsed = Temporal.Duration.from(duration);
  return Temporal.Duration.from({
    milliseconds: Math.trunc(
      parsed.total({
        unit: "millisecond",
        relativeTo: Temporal.PlainDateTime.from("2026-01-01T00:00:00"),
      }),
    ),
  });
}

function assertPositiveDuration(
  duration: Temporal.Duration,
  name: string,
): void {
  if (Temporal.Duration.compare(duration, { seconds: 0 }) <= 0) {
    throw new RangeError(`${name} must be a positive duration.`);
  }
}

function parseHeldSince(
  value: string | undefined,
): Temporal.Instant | undefined {
  if (value == null) return undefined;
  try {
    return Temporal.Instant.from(value);
  } catch (error) {
    getLogger(["fedify", "federation", "circuit"]).warn(
      "Invalid circuitHeldSince value in queued outbox message: {value}",
      { value, error },
    );
    return undefined;
  }
}

/**
 * Parses a value loaded from the circuit breaker KV store.
 *
 * @param value The raw KV value to validate.
 * @returns A circuit breaker state when `value` has a recognized state and
 * valid instant strings, or `undefined` when the stored value is malformed.
 */
export function parseCircuitBreakerKvState(
  value: unknown,
): CircuitBreakerKvState | undefined {
  return stripStoredCircuitBreakerState(
    parseStoredCircuitBreakerKvState(value),
  );
}

function parseStoredCircuitBreakerKvState(
  value: unknown,
): StoredCircuitBreakerKvState | undefined {
  const isInstantString = (v: unknown): v is string => {
    if (typeof v !== "string") return false;
    try {
      Temporal.Instant.from(v);
      return true;
    } catch {
      return false;
    }
  };
  if (typeof value !== "object" || value == null) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.state !== "closed" &&
    record.state !== "open" &&
    record.state !== "half-open"
  ) {
    return undefined;
  }
  if (
    !Array.isArray(record.failures) ||
    !record.failures.every((failure) => isInstantString(failure))
  ) {
    return undefined;
  }
  if (record.opened != null && !isInstantString(record.opened)) {
    return undefined;
  }
  if (record.halfOpened != null && !isInstantString(record.halfOpened)) {
    return undefined;
  }
  return {
    state: record.state,
    failures: record.failures,
    ...(record.opened == null ? {} : { opened: record.opened }),
    ...(record.halfOpened == null ? {} : { halfOpened: record.halfOpened }),
    ...(record.__fedifyCircuitBreakerStateVersion ===
        CIRCUIT_BREAKER_STATE_VERSION
      ? { __fedifyCircuitBreakerStateVersion: CIRCUIT_BREAKER_STATE_VERSION }
      : {}),
  };
}
