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
import patchFiles from "./patch.ts";
import runPrecommand from "./precommand.ts";
import { recommendDependencies } from "./recommend.ts";
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
    tap(patchFiles),
    when(isDry, tap(recommendDependencies)),
    unless(isDry, tap(installDependencies)),
    tap(recommendConfigEnv),
    tap(noticeHowToRun),
  );

export default runInit;
