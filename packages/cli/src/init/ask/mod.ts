import { pipe } from "@fxts/core";
import type { InitCommand } from "../command.ts";
import type { InitCommandOptions } from "../types.ts";
import fillDir from "./dir.ts";
import fillKvStore from "./kv.ts";
import fillMessageQueue from "./mq.ts";
import fillPackageManager from "./pm.ts";
import fillWebFramework from "./wf.ts";

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
