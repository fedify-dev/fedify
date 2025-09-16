import { isObject } from "@fxts/core";
import { highlight } from "cli-highlight";
import { toMerged } from "es-toolkit";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import process from "node:process";

export const colorEnabled: boolean = Deno.stdout.isTerminal() &&
  !Deno.env.has("NO_COLOR");

export function formatObject(
  obj: unknown,
  colors?: boolean,
  json?: boolean,
): string {
  const enableColors = colors ?? colorEnabled;
  if (!json) return Deno.inspect(obj, { colors: enableColors });
  const formatted = JSON.stringify(obj, null, 2);
  if (enableColors) {
    return highlight(formatted, { language: "json" });
  }
  return formatted;
}

export function isPromise<T>(a: unknown): a is Promise<T> {
  return !!a &&
    typeof a === "object" &&
    "then" in a &&
    typeof a.then === "function";
}

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

export const isNotFoundError = (e: unknown): e is { code: "ENOENT" } =>
  isObject(e) &&
  "code" in e &&
  e.code === "ENOENT";

export const runSubCommand = <Opt extends Parameters<typeof spawn>[2]>(
  command: string[],
  options: Opt,
): Promise<{
  stdout: string;
  stderr: string;
}> =>
  new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), options);

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", () => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    child.on("error", (error) => {
      reject(error);
    });
  });

export type RequiredNotNull<T> = {
  [P in keyof T]: NonNullable<T[P]>;
};

export const getCwd = () => process.cwd();

export const replace = (
  pattern: string | RegExp,
  replacement: string | ((substring: string, ...args: unknown[]) => string),
) =>
(text: string): string => text.replace(pattern, replacement as string);

export const getOsType = () => process.platform;

export async function writeTextFile(
  path: string,
  content: string,
): Promise<void> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  return await writeFile(path, data);
}

export const resolveProps = async <T extends object>(obj: T): Promise<
  { [P in keyof T]: Awaited<T[P]> }
> =>
  Object.fromEntries(
    await Array.fromAsync(
      Object.entries(obj),
      async ([k, v]) => [k, await v],
    ),
  ) as Promise<{ [P in keyof T]: Awaited<T[P]> }>;

export const formatJson = (obj: unknown) => JSON.stringify(obj, null, 2) + "\n";

export const notEmpty = <T extends string | { length: number }>(s: T) =>
  s.length > 0;

export const notEmptyObj = <T extends Record<PropertyKey, never> | object>(
  obj: T,
): obj is Exclude<T, Record<PropertyKey, never>> => Object.keys(obj).length > 0;

export const exit = (code: number) => process.exit(code);
