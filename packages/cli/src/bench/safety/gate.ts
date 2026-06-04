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

import type { TargetTier } from "./tiers.ts";

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
