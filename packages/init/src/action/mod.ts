import { pipe, tap, unless, when } from "@fxts/core";
import process from "node:process";
import askOptions from "../ask/mod.ts";
import type { InitCommand } from "../command.ts";
import type { InitCommandData } from "../types.ts";
import { set } from "../utils.ts";
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
 * Execution flow of the `runInit` function:
 *
 * 1. Receives options of type `InitCommand`.
 * 2. Prints a dinosaur ASCII art via `drawDinosaur`.
 * 3. Prompts the user for options via `askOptions`,
 *    converting `InitCommand` into `InitCommandOptions`.
 * 4. Displays the selected options via `noticeOptions`.
 * 5. Converts `InitCommandOptions` into `InitCommandData` via `setData`.
 * 6. Branches based on `isDry`:
 *    - If dry run, executes `handleDryRun`.
 *    - Otherwise, executes `handleHydRun`.
 * 7. Recommends configuration environment via `recommendConfigEnv`.
 * 8. Shows how to run the project via `noticeHowToRun`.
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
