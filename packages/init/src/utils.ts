import { isObject } from "@fxts/core";
import { message } from "@optique/core";
import { print, printError } from "@optique/run";
import { Chalk } from "chalk";
import { flow, toMerged } from "es-toolkit";
import { spawn } from "node:child_process";
import process from "node:process";

/**
 * Whether terminal color output is enabled.
 * `true` when stdout is a TTY and the `NO_COLOR` environment variable is not set.
 */
export const colorEnabled: boolean = process.stdout.isTTY &&
  !("NO_COLOR" in process.env && process.env.NO_COLOR !== "");

/** Chalk instance configured based on {@link colorEnabled}. */
export const colors = new Chalk(colorEnabled ? {} : { level: 0 });

/** Makes all properties of `T` required and non-nullable. */
export type RequiredNotNull<T> = {
  [P in keyof T]: NonNullable<T[P]>;
};

/** Type guard that checks whether a value is a `Promise`. */
export const isPromise = <T>(value: unknown): value is Promise<T> =>
  value instanceof Promise;

/**
 * Functional composition helper that adds a computed property to an object.
 * Returns a function that takes an object, computes a value using `f`, and
 * returns a new object with the additional property `key` set to the result.
 * Handles both synchronous and asynchronous computations.
 *
 * @param key - The property key to add
 * @param f - A function that computes the value from the input object
 * @returns A function that augments the input object with the computed property
 */
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

/**
 * Curried deep merge helper. Returns a function that merges `source` into the
 * given `target` object using `es-toolkit`'s `toMerged`.
 */
export const merge =
  (source: Parameters<typeof toMerged>[1] = {}) =>
  (target: Parameters<typeof toMerged>[0] = {}) => toMerged(target, source);

/**
 * Curried `String.prototype.replace`. Returns a function that performs the
 * replacement on the given text.
 */
export const replace = (
  pattern: string | RegExp,
  replacement: string | ((substring: string, ...args: unknown[]) => string),
) =>
(text: string): string => text.replace(pattern, replacement as string);

/**
 * Curried `String.prototype.replaceAll`. Returns a function that replaces all
 * occurrences of the pattern in the given text.
 */
export const replaceAll = (
  pattern: string | RegExp,
  replacement: string | ((substring: string, ...args: unknown[]) => string),
) =>
(text: string): string => text.replaceAll(pattern, replacement as string);

/** Serializes a value to a pretty-printed JSON string with a trailing newline. */
export const formatJson = (obj: unknown) => JSON.stringify(obj, null, 2) + "\n";

/** Checks whether a string or array-like value has a length greater than zero. */
export const notEmpty = <T extends string | { length: number }>(s: T) =>
  s.length > 0;

/** Type guard that checks whether an error is a "file not found" (`ENOENT`) error. */
export const isNotFoundError = (e: unknown): e is { code: "ENOENT" } =>
  isObject(e) && "code" in e && e.code === "ENOENT";

/**
 * Error thrown when a spawned shell command exits with a non-zero code.
 * Captures stdout, stderr, exit code, and the original command array.
 */
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

/**
 * Executes a shell command (or a chain of commands joined by `"&&"`) as child
 * processes and returns the combined stdout/stderr output.
 * Throws a {@link CommandError} if any command in the chain exits with a
 * non-zero code.
 *
 * @param command - The command as an array of strings; use `"&&"` to chain
 * @param options - Options forwarded to `node:child_process.spawn`
 * @returns A promise resolving to `{ stdout, stderr }`
 */
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

/** Returns the current working directory. */
export const getCwd = () => process.cwd();

/** Returns the current OS platform (e.g., `"darwin"`, `"win32"`, `"linux"`). */
export const getOsType = () => process.platform;

/** Exits the process with the given exit code. */
export const exit = (code: number) => process.exit(code);

/**
 * Recursively extracts the item types from a tuple of iterables.
 * Used to infer the element type of the cartesian product.
 */
export type ItersItems<T extends Iterable<unknown>[]> = T extends [] ? []
  : T extends [infer Head, ...infer Tail]
    ? Head extends Iterable<infer Item>
      ? Tail extends Iterable<unknown>[] ? [Item, ...ItersItems<Tail>]
      : [Item]
    : never
  : never;

/**
 * Generates the cartesian product of multiple iterables.
 * Used by the test suite to enumerate all option combinations.
 *
 * @example
 * ```ts
 * [...product(["a", "b"], [1, 2])]
 * // [["a", 1], ["a", 2], ["b", 1], ["b", 2]]
 * ```
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

/** Extracts the yielded type from a `Generator`. */
export type GeneratedType<T extends Generator> = T extends
  Generator<infer R, unknown, unknown> ? R : never;

type PrintMessage = (...args: Parameters<typeof message>) => void;

/** Prints a formatted message to stdout using `@optique/run`'s `print`. */
export const printMessage: PrintMessage = flow(message, print);

/** Prints a formatted error message to stderr using `@optique/run`'s `printError`. */
export const printErrorMessage: PrintMessage = flow(message, printError);
