import { apply, pipe } from "@fxts/core";
import { CommandError, runSubCommand } from "../utils.ts";
import type { InitCommandData } from "../types.ts";

/**
 * Runs `<packageManager> install` in the project directory to install all
 * dependencies. Logs an error message if the installation fails.
 */
const installDependencies = (data: InitCommandData) =>
  pipe(
    data,
    ({ packageManager, dir }) =>
      [[packageManager, "install"], { cwd: dir }] as //
      Parameters<typeof runSubCommand>,
    apply(runSubCommand),
  ).catch((e) => {
    if (e instanceof CommandError) {
      console.error(
        `Failed to install dependencies using ${data.packageManager}.`,
      );
      console.error("Command:", e.commandLine);
      if (e.stderr) console.error("Error:", e.stderr);
      throw e;
    }
    throw e;
  });

export default installDependencies;
