import { pipe, tap, unless, when } from "@fxts/core";
import { exit, runSubCommand } from "../../utils.ts";
import type { InitCommandData } from "../types.ts";
import { noticePrecommand } from "./notice.ts";
import { isDry } from "./utils.ts";

const runPrecommand = ({
  initializer: { command },
  dir,
}: InitCommandData) =>
  runSubCommand(command!, {
    cwd: dir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).catch(() => {
    console.error("Failed to initialize the project.");
    exit(1);
  });

const executePrecommand = (data: InitCommandData) =>
  pipe(
    data,
    when(isDry, tap(noticePrecommand)),
    unless(isDry, tap(runPrecommand)),
  );

export default executePrecommand;
