import { pipe } from "@fxts/core";
import type { RequiredNotNull } from "../../utils.ts";
import type { InitCommand } from "../command.ts";
import fillDir from "./dir.ts";
import fillKvStore from "./kv.ts";
import fillMessageQueue from "./mq.ts";
import fillPackageManager from "./pm.ts";
import fillWebFramework from "./wf.ts";

const askOptions: (
  options: InitCommand,
) => Promise<RequiredNotNull<InitCommand>> = //
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
