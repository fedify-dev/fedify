import { always, concat, pipe, tap, toArray, unless, when } from "@fxts/core";
import { notEmpty, runSubCommand, set } from "../../utils.ts";
import type { InitCommandData } from "../types.ts";
import {
  getAddDepsArgs,
  getDependencies,
  getDevDependencies,
  joinDepsVer,
} from "./deps.ts";
import { noticeErrorWhileAddDeps } from "./notice.ts";
import { isDeno } from "./utils.ts";

const installDependencies = (data: InitCommandData) =>
  pipe(
    data,
    tap(installDeps),
    unless(isDeno, tap(installDevDeps)),
  );

export default installDependencies;

type Deps = Record<string, string>;

const installDeps = (data: InitCommandData) =>
  pipe(
    data,
    set("dependencies", getDependencies),
    getAddDepsCommand,
    when(notEmpty, runAddDeps(data)),
  );

const installDevDeps = (data: InitCommandData) =>
  pipe(
    data,
    set("dependencies", getDevDependencies),
    set("dev", always(true)),
    getAddDepsCommand,
    when(notEmpty, runAddDeps(data)),
  );

const getAddDepsCommand = <
  T extends InitCommandData & {
    dependencies: Deps;
    dev?: boolean;
  },
>(data: T) =>
  pipe(
    data,
    joinDepsVer,
    when(notEmpty<string[]>, concat(getAddDepsArgs(data))),
    toArray,
  );

const runAddDeps =
  <T extends { dir: string }>({ dir }: T) => (command: string[]) =>
    runSubCommand(command, {
      cwd: dir,
      stdio: "inherit",
    }).catch(noticeErrorWhileAddDeps(command));
