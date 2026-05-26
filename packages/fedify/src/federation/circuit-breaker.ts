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
   * How long other held activities wait while a half-open probe is in flight.
   * @default `{ seconds: 1 }`
   */
  readonly releaseInterval?: Temporal.Duration | Temporal.DurationLike;

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
  readonly onStateChange?: CircuitBreakerOptions["onStateChange"];
  readonly onActivityDrop?: CircuitBreakerOptions["onActivityDrop"];
}

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
  | { readonly type: "send"; readonly probe: boolean }
  | {
    readonly type: "hold";
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

  async beforeSend(
    remoteHost: string,
    message: { readonly circuitHeldSince?: string },
  ): Promise<CircuitBreakerBeforeSendDecision> {
    const heldSince = message.circuitHeldSince == null
      ? undefined
      : Temporal.Instant.from(message.circuitHeldSince);
    const now = this.#now();

    while (true) {
      const oldState = await this.#get(remoteHost);
      if (oldState == null || oldState.state === "closed") {
        return { type: "send", probe: false };
      }
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
      if (oldState.state === "half-open") {
        const halfOpened = oldState.halfOpened == null
          ? undefined
          : Temporal.Instant.from(oldState.halfOpened);
        if (halfOpened != null) {
          const retryAt = halfOpened.add(this.#options.releaseInterval);
          if (Temporal.Instant.compare(now, retryAt) < 0) {
            return {
              type: "hold",
              delay: now.until(retryAt),
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
        continue;
      }

      const opened = oldState.opened == null
        ? now
        : Temporal.Instant.from(oldState.opened);
      const probeAt = opened.add(this.#options.recoveryDelay);
      if (Temporal.Instant.compare(now, probeAt) < 0) {
        return {
          type: "hold",
          delay: now.until(probeAt),
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
        return { type: "send", probe: true };
      }
    }
  }

  async recordSuccess(
    remoteHost: string,
  ): Promise<CircuitBreakerStateChange | undefined> {
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
    const now = this.#now();
    for (let attempt = 0; attempt < 10; attempt++) {
      const oldState = await this.#get(remoteHost);
      const oldFailures = oldState?.failures.map(Temporal.Instant.from) ?? [];
      const failures = this.#options.pruneFailures(
        [...oldFailures, now],
        now,
      );
      let newState: CircuitBreakerKvState;
      let transition: [CircuitBreakerState, CircuitBreakerState] | undefined;
      if (oldState?.state === "open") {
        newState = oldState;
      } else if (
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
    return await this.#get(remoteHost);
  }

  #key(remoteHost: string): KvKey {
    return [...this.#prefix, remoteHost] as KvKey;
  }

  async #get(remoteHost: string): Promise<CircuitBreakerKvState | undefined> {
    return parseCircuitBreakerKvState(
      await this.#kv.get(this.#key(remoteHost)),
    );
  }

  async #replace(
    remoteHost: string,
    oldState: CircuitBreakerKvState | undefined,
    newState: CircuitBreakerKvState | undefined,
  ): Promise<boolean> {
    const key = this.#key(remoteHost);
    if (this.#kv.cas == null) {
      if (newState == null) {
        await this.#kv.delete(key);
      } else {
        await this.#kv.set(key, newState);
      }
      return true;
    }
    return await this.#kv.cas(key, oldState, newState);
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
  let failure: (timestamps: readonly Temporal.Instant[]) => boolean;
  let pruneFailures: (
    timestamps: readonly Temporal.Instant[],
    now: Temporal.Instant,
  ) => readonly Temporal.Instant[];
  if (options.failure == null) {
    const failureThreshold = options.failureThreshold ?? 5;
    const failureWindow = toInstantDuration(
      options.failureWindow ?? { minutes: 10 },
    );
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
  } else {
    failure = options.failure;
    pruneFailures = (timestamps) => timestamps;
  }
  return {
    failure,
    pruneFailures,
    recoveryDelay,
    heldActivityTtl,
    releaseInterval,
    onStateChange: options.onStateChange,
    onActivityDrop: options.onActivityDrop,
  };
}

function toInstantDuration(
  duration: Temporal.Duration | Temporal.DurationLike,
): Temporal.Duration {
  const parsed = Temporal.Duration.from(duration);
  return Temporal.Duration.from({
    milliseconds: parsed.total({
      unit: "millisecond",
      relativeTo: Temporal.PlainDateTime.from("2026-01-01T00:00:00"),
    }),
  });
}

export function parseCircuitBreakerKvState(
  value: unknown,
): CircuitBreakerKvState | undefined {
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
    !record.failures.every((failure) => typeof failure === "string")
  ) {
    return undefined;
  }
  if (record.opened != null && typeof record.opened !== "string") {
    return undefined;
  }
  if (record.halfOpened != null && typeof record.halfOpened !== "string") {
    return undefined;
  }
  return {
    state: record.state,
    failures: record.failures,
    ...(record.opened == null ? {} : { opened: record.opened }),
    ...(record.halfOpened == null ? {} : { halfOpened: record.halfOpened }),
  };
}
