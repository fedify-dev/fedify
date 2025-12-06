import { CommandError, exit, runSubCommand } from "../../utils.ts";
import type { InitCommandData } from "../types.ts";

/**
 * Runs the precommand specified in the initializer to set up the project.
 *
 * @param data - The initialization command data containing the initializer command and directory
 * @returns A promise that resolves when the precommand has been executed
 */
const runPrecommand = ({
  initializer: { command },
  dir,
}: InitCommandData) =>
  runSubCommand(command!, {
    cwd: dir,
    stdio: "inherit",
  }).catch((e) => {
    if (e instanceof CommandError) {
      console.error("Failed to run the precommand.");
      console.error("Command:", e.commandLine);
      if (e.stderr) console.error("Error:", e.stderr);
      if (e.stdout) console.error("Output:", e.stdout);
    } else {
      console.error("Failed to run the precommand:", e);
    }
    exit(1);
  });

export default runPrecommand;
