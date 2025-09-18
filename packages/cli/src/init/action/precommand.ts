import { exit, runSubCommand } from "../../utils.ts";
import type { InitCommandData } from "../types.ts";

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

export default runPrecommand;
