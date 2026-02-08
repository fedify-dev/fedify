import { rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { printMessage } from "../utils.ts";

export const genRunId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const genTestDirPrefix = <T extends { runId: string }>({ runId }: T) =>
  join(tmpdir(), "fedify-init", runId);

export const emptyTestDir = <
  T extends { testDirPrefix: string },
>({ testDirPrefix }: T) =>
  rmdir(testDirPrefix, { recursive: true }).catch(() => {});

export const logTestDir = <
  T extends { runId: string; testDirPrefix: string },
>({ runId, testDirPrefix }: T) =>
  printMessage`Test run completed.
Run ID: ${runId}
Path: ${testDirPrefix}`;
