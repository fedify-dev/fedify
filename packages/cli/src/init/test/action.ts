import { pipe, tap, when } from "@fxts/core";
import { set } from "../../utils.ts";
import type { TestInitCommand } from "../command.ts";
import { fillEmptyOptions } from "./fill.ts";
import { isDryRun, isHydRun, runTests } from "./run.ts";
import {
  emptyTestDir,
  genRunId,
  genTestDirPrefix,
  logTestDir,
} from "./utils.ts";

const runTestInit = (options: TestInitCommand) =>
  pipe(
    options,
    set("runId", genRunId),
    set("testDirPrefix", genTestDirPrefix),
    tap(emptyTestDir),
    fillEmptyOptions,
    tap(when(isHydRun, runTests(false))),
    tap(when(isDryRun, runTests(true))),
    tap(logTestDir),
  );

export default runTestInit;
