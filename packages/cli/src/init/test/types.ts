import type { TestInitCommand } from "../command.ts";

export interface InitTestData extends DefineAllOptions<TestInitCommand> {
  runId: string;
  testDirPrefix: string;
}

export type MultipleOption =
  | "webFramework"
  | "packageManager"
  | "kvStore"
  | "messageQueue";

export type DefineOption<T extends TestInitCommand, K extends MultipleOption> =
  & Omit<T, K>
  & {
    [Key in MultipleOption]: Key extends K ? TestInitCommand[Key] & string[]
      : T[Key];
  };

type NoRunMode = "noHydRun" | "noDryRun";
type RunMode = "hydRun" | "dryRun";

export type DefineAllOptions<T extends TestInitCommand> =
  & Omit<T, MultipleOption | NoRunMode>
  & { [K in MultipleOption]: (TestInitCommand[K][number] & string)[] }
  & { [R in RunMode]: boolean };
