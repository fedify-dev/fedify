import { pipe } from "@fxts/core";
import type { InitCommand } from "../command.ts";
import type { InitCommandOptions } from "../types.ts";
import fillDir from "./dir.ts";
import fillKvStore from "./kv.ts";
import fillMessageQueue from "./mq.ts";
import fillPackageManager from "./pm.ts";
import fillWebFramework from "./wf.ts";

/**
 * Orchestrates all interactive prompts to fill in missing initialization options.
 * Prompts the user in sequence for: project directory, web framework,
 * package manager, message queue, and key-value store.
 * Returns a fully resolved {@link InitCommandOptions} with all fields guaranteed.
 */
const askOptions: (
  options: InitCommand & { testMode: boolean },
) => Promise<InitCommandOptions> = //
  (options) =>
    pipe(
      options,
      fillDir,
      fillWebFramework,
      fillPackageManager,
      fillMessageQueue,
      fillKvStore,
    );

export default askOptions;
