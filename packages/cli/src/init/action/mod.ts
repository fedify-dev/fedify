import { pipe, tap, unless, when } from "@fxts/core";
import process from "node:process";
import { set } from "../../utils.ts";
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

/**
 *             options: InitCommand
 *                ├ drawDinosaur
 *          ┌─────┴──────┐
 *          │ askOptions │ InitCommand -> InitCommandOptions
 *          └─────┬──────┘
 *                ├ noticeOptions
 *           ┌────┴────┐
 *           │ setData │ InitCommandOptions -> InitCommandData
 *           └────┬────┘
 *              ┌─┴─┐ isDry
 * handleDryRun ┤   ├ handleHydRun
 *              └─┬─┘
 *                ├ recommendConfigEnv
 *                ├ noticeHowToRun
 */
const runInit = (options: InitCommand) =>
  pipe(
    options,
    tap(drawDinosaur),
    setTestMode,
    askOptions,
    tap(noticeOptions),
    setData,
    when(isDry, handleDryRun),
    unless(isDry, handleHydRun),
    tap(recommendConfigEnv),
    tap(noticeHowToRun),
  );

export default runInit;

const setTestMode: <T>(obj: T) => T & { testMode: boolean } = set(
  "testMode",
  () => Boolean(process.env["FEDIFY_TEST_MODE"]),
) as <T>(obj: T) => T & { testMode: boolean };
const handleDryRun = (data: InitCommandData) =>
  pipe(
    data,
    tap(when(hasCommand, noticePrecommand)),
    tap(recommendPatchFiles),
    tap(recommendDependencies),
  );

const handleHydRun = (data: InitCommandData) =>
  pipe(
    data,
    tap(makeDirIfHyd),
    tap(when(hasCommand, runPrecommand)),
    tap(patchFiles),
    tap(installDependencies),
  );
