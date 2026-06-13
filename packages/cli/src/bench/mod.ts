import runBenchSuite from "./action.ts";
import { runBenchCompare } from "./compare.ts";
import type { BenchCommand } from "./command.ts";

export { benchCommand } from "./command.ts";

export function runBench(command: BenchCommand): Promise<void> {
  return command.mode === "compare"
    ? runBenchCompare(command)
    : runBenchSuite(command);
}
