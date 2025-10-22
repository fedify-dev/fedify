import { isObject } from "@fxts/core";
import { Chalk } from "chalk";
import { highlight } from "cli-highlight";
import { toMerged } from "es-toolkit";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import process from "node:process";
import util from "node:util";

export const colorEnabled: boolean = process.stdout.isTTY &&
  !("NO_COLOR" in process.env && process.env.NO_COLOR !== "");

export const colors = new Chalk(colorEnabled ? {} : { level: 0 });

export function formatObject(
  obj: unknown,
  colors?: boolean,
  json?: boolean,
): string {
  const enableColors = colors ?? colorEnabled;
  if (!json) return util.inspect(obj, { colors: enableColors });
  const formatted = JSON.stringify(obj, null, 2);
  if (enableColors) {
    return highlight(formatted, { language: "json" });
  }
  return formatted;
}

export const isPromise = <T>(a: unknown): a is Promise<T> =>
  a instanceof Promise;

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

/**
 * Generic type to represent the types of the items in iterables.
 */
export type ItersItems<T extends Iterable<unknown>[]> = T extends [] ? []
  : T extends [infer Head, ...infer Tail]
    ? Head extends Iterable<infer Item>
      ? Tail extends Iterable<unknown>[] ? [Item, ...ItersItems<Tail>]
      : [Item]
    : never
  : never;

/**
 * ```haskell
 * product::[[a], [b], ...] -> [[a, b, ...]]
 * ```
 *
 * Cartesian product of the input iterables.
 * Inspired by Python's `itertools.product`.
 *
 * @param {...Iterable<unknown>} iters - The input iterables to compute the Cartesian product.
 * @returns {Generator<ItersItems<T>>} A generator that yields arrays containing one element from each iterable.
 *
 * @example
 * ```ts
 * const iter1 = [1, 2];
 * const iter2 = ['a', 'b'];
 * const iter3 = [true, false];
 * const productIter = product(iter1, iter2, iter3);
 * console.log(Array.from(productIter)); // Output: [[1, 'a', true], [1, 'a', false], [
 */
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
