import { pipe, tap, unless, when } from "@fxts/core";
import askOptions from "../ask/mod.ts";
import type { InitCommand } from "../command.ts";
import { makeDirIfHyd } from "./dir.ts";
import recommendConfigEnv from "./env.ts";
import installDependencies from "./install.ts";
import {
  drawDinosaur,
  noticeDry,
  noticeHowToRun,
  noticeOptions,
} from "./notice.ts";
import runPrecommand from "./precommand.ts";
import rewriteJsonFiles from "./rewrite.ts";
import setData from "./set.ts";
import { hasCommand, isDry } from "./utils.ts";

const runInit = (options: InitCommand) =>
  pipe(
    options,
    tap(drawDinosaur),
    askOptions,
    tap(noticeOptions),
    setData,
    when(isDry, tap(noticeDry)),
    unless(isDry, tap(makeDirIfHyd)),
    when(hasCommand, runPrecommand),
    tap(rewriteJsonFiles),
    tap(installDependencies),
    tap(recommendConfigEnv),
    tap(noticeHowToRun),
  );

export default runInit;
