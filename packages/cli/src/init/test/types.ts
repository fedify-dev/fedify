import type { TestInitCommand } from "../command.ts";

export interface InitTestData extends AllDefinedTestInitCommand {
  runId: string;
  testDirPrefix: string;
}

export interface AllDefinedTestInitCommand extends TestInitCommand {
  webFramework: (TestInitCommand["webFramework"][number] & string)[];
  packageManager: (TestInitCommand["packageManager"][number] & string)[];
  kvStore: (TestInitCommand["kvStore"][number] & string)[];
  messageQueue: (TestInitCommand["messageQueue"][number] & string)[];
}

export type MultipleOption =
  | "webFramework"
  | "packageManager"
  | "kvStore"
  | "messageQueue";

export type DefineOption<T extends TestInitCommand, K extends MultipleOption> =
  & Omit<T, K>
  & {
    [Key in MultipleOption]: Key extends K ? AllDefinedTestInitCommand[Key]
      : T[Key];
  };

export type DefineAllOptions<T extends TestInitCommand> =
  & Omit<T, MultipleOption>
  & {
    [K in MultipleOption]: TestInitCommand[K] extends readonly unknown[]
      ? AllDefinedTestInitCommand[K]
      : never;
  };
