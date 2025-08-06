/**
 * The context passed to a {@link RetryPolicy} callback.
 * @since 0.12.0
 */
export interface RetryContext {
  /**
   * The elapsed time since the first attempt.
   */
  readonly elapsedTime: Temporal.Duration;

  /**
   * The number of attempts so far.
   */
  readonly attempts: number;
}

/**
 * A policy that determines the delay before the next retry.
 * @param context The retry context.
 * @returns The delay before the next retry, or `null` to stop retrying.
 *          It must not negative.
 * @since 0.12.0
 */
export type RetryPolicy = (context: RetryContext) => Temporal.Duration | null;

/**
 * Options for {@link createExponentialBackoffPolicy} function.
 * @since 0.12.0
 */
export interface CreateExponentialBackoffPolicyOptions {
  /**
   * The initial delay before the first retry.  Defaults to 1 second.
   */
  readonly initialDelay?: Temporal.DurationLike;

  /**
   * The maximum delay between retries.  Defaults to 12 hours.
   */
  readonly maxDelay?: Temporal.DurationLike;

  /**
   * The maximum number of attempts before giving up.
   * Defaults to 10.
   */
  readonly maxAttempts?: number;

  /**
   * The factor to multiply the previous delay by for each retry.
   * Defaults to 2.
   */
  readonly factor?: number;

  /**
   * Whether to add jitter to the delay to avoid synchronization.
   * Turned on by default.
   */
  readonly jitter?: boolean;
}

/**
 * Creates an exponential backoff retry policy.  The delay between retries
 * starts at the `initialDelay` and is multiplied by the `factor` for each
 * subsequent retry, up to the `maxDelay`.  The policy will give up after
 * `maxAttempts` attempts.  The actual delay is randomized to avoid
 * synchronization (jitter).
 * @param options The options for the policy.
 * @returns The retry policy.
 * @since 0.12.0
 */
export function createExponentialBackoffPolicy(
  options: CreateExponentialBackoffPolicyOptions = {},
): RetryPolicy {
  const initialDelay = Temporal.Duration.from(
    options.initialDelay ?? { seconds: 1 },
  );
  const maxDelay = Temporal.Duration.from(options.maxDelay ?? { hours: 12 });
  const maxAttempts = options.maxAttempts ?? 10;
  const factor = options.factor ?? 2;
  const jitter = options.jitter ?? true;
  return ({ attempts }) => {
    if (attempts >= maxAttempts) return null;
    let milliseconds = initialDelay.total("millisecond");
    milliseconds *= factor ** attempts;
    if (jitter) {
      milliseconds *= 1 + Math.random();
      milliseconds = Math.round(milliseconds);
    }
    const delay = Temporal.Duration.from({ milliseconds });
    return Temporal.Duration.compare(delay, maxDelay) > 0 ? maxDelay : delay;
  };
}
