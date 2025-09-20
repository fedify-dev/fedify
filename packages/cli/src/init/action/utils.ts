import { join as joinPath } from "@std/path";
import type { InitCommandData } from "../types.ts";

export const isDry = ({ dryRun }: InitCommandData) => dryRun;

export const hasCommand = (data: InitCommandData) => !!data.initializer.command;

export const isDeno = (
  { packageManager }: InitCommandData,
) => packageManager === "deno";

export const joinDir =
  (dir: string) => ([filename, content]: readonly [string, string | object]) =>
    [joinPath(dir, ...filename.split("/")), content] as [
      string,
      string | object,
    ];
