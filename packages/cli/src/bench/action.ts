import type { BenchCommand } from "./command.ts";

/**
 * Runs the `fedify bench` command.
 *
 * This is a placeholder that is fleshed out in subsequent steps; the engine,
 * scenario runners, and reporting are wired in incrementally.
 * @param command The parsed `bench` command options.
 */
export default function runBench(_command: BenchCommand): Promise<void> {
  return Promise.reject(
    new Error("fedify bench is not implemented yet."),
  );
}
