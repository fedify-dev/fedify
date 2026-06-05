/**
 * The client-side safety gate.
 *
 * A run is allowed without friction when the target is loopback/private or
 * advertises benchmark mode (the operator's "not production" assertion).  Only
 * a public target that does not advertise benchmark mode is gated, behind an
 * explicit `--allow-unsafe-target`.  There is no interactive prompt, so the
 * flag is mandatory in CI and any non-TTY context.  A `--dry-run` only inspects
 * (discovery reads), so it bypasses the gate.
 * @since 2.3.0
 * @module
 */

import { classifyTarget, type TargetTier } from "./tiers.ts";

/** An error raised when a target is refused by the safety gate. */
export class UnsafeTargetError extends Error {}

/** The inputs to the safety gate decision. */
export interface GateContext {
  /** The target's risk tier. */
  readonly tier: TargetTier;
  /** Whether the target advertises benchmark mode (the `stats` probe). */
  readonly benchmarkMode: boolean;
  /** Whether `--allow-unsafe-target` was given. */
  readonly allowUnsafe: boolean;
  /** Whether this is a `--dry-run` (inspection only). */
  readonly dryRun: boolean;
}

/**
 * Asserts that a target may be benchmarked, throwing otherwise.
 * @param context The gate decision inputs.
 * @throws {UnsafeTargetError} If the target is public, does not advertise
 *         benchmark mode, and `--allow-unsafe-target` was not given.
 */
export function assertTargetAllowed(context: GateContext): void {
  if (context.dryRun) return;
  if (context.tier !== "public") return;
  if (context.benchmarkMode) return;
  if (context.allowUnsafe) return;
  throw new UnsafeTargetError(
    "Refusing to benchmark a public target that does not advertise benchmark " +
      "mode.  If you control this target, pass --allow-unsafe-target " +
      "(mandatory in CI and any non-interactive context).",
  );
}

/** The inputs to gating a resolved inbox load destination. */
export interface InboxDestinationGateContext {
  /**
   * The gated benchmark target's origin (scheme, host, and effective port).
   * Compared by origin, not bare host, so a destination only inherits the
   * target's gate when it is the very service the benchmark-mode probe covered
   * (e.g. an `http://host` inbox does not inherit an `https://host` target).
   */
  readonly targetOrigin: string;
  /** Whether the gated target advertises benchmark mode. */
  readonly targetBenchmarkMode: boolean;
  /** Whether `--allow-unsafe-target` was given. */
  readonly allowUnsafe: boolean;
  /** Whether a reachable synthetic host was advertised (`--advertise-host`). */
  readonly advertised: boolean;
}

/**
 * Asserts that a resolved inbox URL — the actual destination of signed
 * benchmark load — may be sent to.  The suite's `target` is gated separately by
 * {@link assertTargetAllowed}; this catches a destination that differs from it
 * (a public `recipient`, or an explicit `inbox:` URL), so production cannot be
 * benchmarked through the back door.
 *
 * A destination is allowed when it is loopback or private, or shares the gated
 * target's host while the target advertises benchmark mode (inheriting its
 * gate), or `--allow-unsafe-target` is given.  Because the destination's server
 * dereferences the synthetic actor while verifying signatures, a non-loopback
 * destination additionally requires an advertised, reachable synthetic host.
 * @param url The resolved inbox URL.
 * @param context The destination gate inputs.
 * @throws {UnsafeTargetError} If the destination is refused.
 */
export function assertInboxDestinationAllowed(
  url: URL,
  context: InboxDestinationGateContext,
): void {
  const tier = classifyTarget(url);
  const inheritsTargetGate = url.origin === context.targetOrigin &&
    context.targetBenchmarkMode;
  if (tier === "public" && !inheritsTargetGate && !context.allowUnsafe) {
    throw new UnsafeTargetError(
      `Refusing to send benchmark load to ${url.href}: it is a public inbox ` +
        "that is neither part of the benchmarked target nor covered by " +
        "benchmark mode.  Pass --allow-unsafe-target to override.",
    );
  }
  if (tier !== "loopback" && !context.advertised) {
    throw new UnsafeTargetError(
      `Refusing to send signed benchmark load to ${url.href}: the synthetic ` +
        "actor server is unreachable from a non-loopback inbox.  Pass " +
        "--advertise-host with an address it can reach.",
    );
  }
}
