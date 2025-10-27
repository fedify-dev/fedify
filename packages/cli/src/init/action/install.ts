import { apply, pipe } from "@fxts/core";
import { runSubCommand } from "../../utils.ts";
import type { InitCommandData } from "../types.ts";

const installDependencies = (data: InitCommandData) =>
  pipe(
    data,
    ({ packageManager, dir }) =>
      [[packageManager, "install"], { cwd: dir }] as //
      Parameters<typeof runSubCommand>,
    apply(runSubCommand),
  );

export default installDependencies;
