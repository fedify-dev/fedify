import { isObject } from "@fxts/core";
import { message } from "@optique/core";
import { print, printError } from "@optique/run";
import { Chalk } from "chalk";
import { flow, toMerged } from "es-toolkit";
import { spawn } from "node:child_process";
import process from "node:process";

export const colorEnabled: boolean = process.stdout.isTTY &&
  !("NO_COLOR" in process.env && process.env.NO_COLOR !== "");

export const colors = new Chalk(colorEnabled ? {} : { level: 0 });

export type RequiredNotNull<T> = {
  [P in keyof T]: NonNullable<T[P]>;
};

export const isPromise = <T>(value: unknown): value is Promise<T> =>
  value instanceof Promise;

export function set<K extends PropertyKey, T extends object, S>(
  key: K,
  f: (value: T) => S,
): (
  obj: T,
) => S extends Promise<infer U> ? Promise<T & { [P in K]: Awaited<U> }>
  : T & { [P in K]: S } {
  return ((obj) => {
    const result = f(obj);
    if (isPromise<S extends Promise<infer U> ? U : never>(result)) {
      return result.then((value) => ({ ...obj, [key]: value })) as S extends
        Promise<infer U> ? Promise<
          T & { [P in K]: Awaited<U> }
        >
        : never;
    }
    return ({ ...obj, [key]: result }) as S extends Promise<infer _> ? never
      : T & { [P in K]: S };
  });
}

export const merge =
  (source: Parameters<typeof toMerged>[1] = {}) =>
  (target: Parameters<typeof toMerged>[0] = {}) => toMerged(target, source);

export const replace = (
  pattern: string | RegExp,
  replacement: string | ((substring: string, ...args: unknown[]) => string),
) =>
(text: string): string => text.replace(pattern, replacement as string);

export const replaceAll = (
  pattern: string | RegExp,
  replacement: string | ((substring: string, ...args: unknown[]) => string),
) =>
(text: string): string => text.replaceAll(pattern, replacement as string);

export const formatJson = (obj: unknown) => JSON.stringify(obj, null, 2) + "\n";

export const notEmpty = <T extends string | { length: number }>(s: T) =>
  s.length > 0;

export const isNotFoundError = (e: unknown): e is { code: "ENOENT" } =>
  isObject(e) && "code" in e && e.code === "ENOENT";

export class CommandError extends Error {
  public commandLine: string;
  constructor(
    message: string,
    public stdout: string,
    public stderr: string,
    public code: number,
    public command: string[],
  ) {
    super(message);
    this.name = "CommandError";
    this.commandLine = command.join(" ");
  }
}

export const runSubCommand = async <Opt extends Parameters<typeof spawn>[2]>(
  command: string[],
  options: Opt,
): Promise<{
  stdout: string;
  stderr: string;
}> => {
  const commands = command.reduce<string[][]>((acc, cur) => {
    if (cur === "&&") {
      acc.push([]);
    } else {
      if (acc.length === 0) acc.push([]);
      acc[acc.length - 1].push(cur);
    }
    return acc;
  }, []);

  const results = { stdout: "", stderr: "" };

  for (const cmd of commands) {
    try {
      const result = await runSingularCommand(cmd, options);
      results.stdout += (results.stdout ? "\n" : "") + result.stdout;
      results.stderr += (results.stderr ? "\n" : "") + result.stderr;
    } catch (error) {
      if (error instanceof CommandError) {
        results.stdout += (results.stdout ? "\n" : "") + error.stdout;
        results.stderr += (results.stderr ? "\n" : "") + error.stderr;
      }
      throw error;
    }
  }
  return results;
};

const runSingularCommand = (
  command: string[],
  options: Parameters<typeof spawn>[2],
) =>
  new Promise<{
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command[0], command.slice(1), options);

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      } else {
        reject(
          new CommandError(
            `Command exited with code ${code ?? "unknown"}`,
            stdout.trim(),
            stderr.trim(),
            code ?? -1,
            command,
          ),
        );
      }
    });

    child.on("error", (error) => {
      reject(error);
    });
  });

export const getCwd = () => process.cwd();

export const getOsType = () => process.platform;

export const exit = (code: number) => process.exit(code);

export type ItersItems<T extends Iterable<unknown>[]> = T extends [] ? []
  : T extends [infer Head, ...infer Tail]
    ? Head extends Iterable<infer Item>
      ? Tail extends Iterable<unknown>[] ? [Item, ...ItersItems<Tail>]
      : [Item]
    : never
  : never;

export function* product<T extends Iterable<unknown>[]>(
  ...[head, ...tail]: T
): Generator<ItersItems<T>> {
  if (!head) yield [] as ItersItems<T>;
  else {
    for (const x of head) {
      for (const xs of product(...tail)) yield [x, ...xs] as ItersItems<T>;
    }
  }
}

export type GeneratedType<T extends Generator> = T extends
  Generator<unknown, infer R, unknown> ? R : never;

type PrintMessage = (...args: Parameters<typeof message>) => void;
export const printMessage: PrintMessage = flow(message, print);
export const printErrorMessage: PrintMessage = flow(message, printError);
