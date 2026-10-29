import type { TestInitCommand } from "../command.ts";
import { checkRequiredDbs } from "./db.ts";
import { fillEmptyOptions } from "./fill.ts";
import runTests from "./run.ts";
import {
  emptyTestDir,
  genRunId,
  genTestDirPrefix,
  logTestDir,
} from "./utils.ts";

export default async function runTestInit(
  options: TestInitCommand,
): Promise<boolean> {
  const runId = genRunId();
  const data = fillEmptyOptions({
    ...options,
    runId,
    testDirPrefix: genTestDirPrefix({ runId }),
  });
  await emptyTestDir(data);
  await checkRequiredDbs(data);
  logTestDir(data);
  let success = true;
  if (data.dryRun) success = await runTests(true)(data) && success;
  if (data.hydRun) success = await runTests(false)(data) && success;
  return success;
}
