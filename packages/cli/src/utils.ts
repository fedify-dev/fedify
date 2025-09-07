import { isObject } from "@fxts/core";
import { highlight } from "cli-highlight";
import { toMerged } from "es-toolkit";
import { spawn } from "node:child_process";

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
) => S extends Promise<infer U> ? Promise<
    {
      [P in K | keyof T]: P extends K ? U : P extends keyof T ? T[P] : never;
    }
  >
  : {
    [P in K | keyof T]: P extends K ? S : P extends keyof T ? T[P] : never;
  } {
  return ((obj) => {
    const result = f(obj);
    if (isPromise<S extends Promise<infer U> ? U : never>(result)) {
      return result.then((value) => ({ ...obj, [key]: value })) as S extends
        Promise<infer U> ? Promise<
          {
            [P in K | keyof T]: P extends K ? U
              : P extends keyof T ? T[P]
              : never;
          }
        >
        : never;
    }
    return ({ ...obj, [key]: result }) as S extends Promise<infer _> ? never
      : {
        [P in K | keyof T]: P extends K ? S : P extends keyof T ? T[P] : never;
      };
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
