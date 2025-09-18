import { pipe, tap, unless, when } from "@fxts/core";
import askOptions from "../ask/mod.ts";
import type { InitCommand } from "../command.ts";
import type { InitCommandData } from "../types.ts";
import { makeDirIfHyd } from "./dir.ts";
import recommendConfigEnv from "./env.ts";
import installDependencies from "./install.ts";
import {
  drawDinosaur,
  noticeHowToRun,
  noticeOptions,
  noticePrecommand,
} from "./notice.ts";
import { patchFiles, recommendPatchFiles } from "./patch.ts";
import runPrecommand from "./precommand.ts";
import recommendDependencies from "./recommend.ts";
import setData from "./set.ts";
import { hasCommand, isDry } from "./utils.ts";

const runInit = (options: InitCommand) =>
  pipe(
    options,
    tap(drawDinosaur),
    askOptions,
    tap(noticeOptions),
    setData,
    when(isDry, handleDryRun),
    unless(isDry, handleHydRun),
    tap(recommendConfigEnv),
    tap(noticeHowToRun),
  );

export default runInit;

const handleDryRun = (data: InitCommandData) =>
  pipe(
    data,
    tap(when(hasCommand, noticePrecommand)),
    tap(recommendPatchFiles),
    tap(recommendDependencies),
    tap(recommendConfigEnv),
  );

const handleHydRun = (data: InitCommandData) =>
  pipe(
    data,
    tap(makeDirIfHyd),
    tap(when(hasCommand, runPrecommand)),
    tap(patchFiles),
    tap(installDependencies),
  );
