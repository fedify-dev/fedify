import { highlight } from "cli-highlight";
import { toMerged } from "jsr:@es-toolkit/es-toolkit";
import * as colors from "@std/fmt/colors";
import { isObject, reduce } from "@fxts/core";

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

export function select<T extends string>(
  items: readonly T[],
  message?: string,
): T {
  const optionsMessage = items.map((item, i) =>
    i ? `  - ${item}` : `  - ${item}${colors.gray(" (default)")}`
  ).join("\n");
  const ask = () =>
    prompt(`${message}\n${optionsMessage}`, items[0]) ?? items[0];
  let selected = ask();
  while (!items.includes(selected as T)) {
    console.error(colors.red(`"${selected}" is not a option.`));
    selected = ask();
  }
  return selected as T;
}

export function raise(e: Error): never {
  throw e;
}

export const merge =
  (source: Parameters<typeof toMerged>[1] = {}) =>
  (target: Parameters<typeof toMerged>[0] = {}) => toMerged(target, source);

export function isEmptySync(path: string): boolean {
  for (const _ of Deno.readDirSync(path)) return false;
  return true;
}
export const fold =
  <T, Acc>(f: (acc: Acc, curr: T) => Acc, acc: Acc) => (iter: Iterable<T>) =>
    reduce(f, acc, iter);

export function bimap<T, S, E, F, U extends T | E>(
  pred: (a: U) => boolean,
  onTrue: (a: T) => S,
  onFalse: (a: E) => F,
): (a: U) => S | F {
  return (a: U) => pred(a) ? onTrue(a as T) : onFalse(a as E);
}
export function isPromise<T>(a: unknown): a is Promise<T> {
  return isObject(a) && "then" in a && typeof a.then === "function";
}

type SetResult<K extends PropertyKey, T extends object, S> = {
  [P in K | keyof T]: P extends K ? S : P extends keyof T ? T[P] : never;
};

export function set<K extends PropertyKey, T extends object, S>(
  key: K,
  f: (value: T) => S,
): (
  obj: T,
) => S extends Promise<unknown> ? Promise<SetResult<K, T, S>>
  : SetResult<K, T, S> {
  return ((obj) => {
    const result = f(obj);
    if (isPromise<S extends Promise<infer U> ? U : never>(result)) {
      return result.then((value) => ({ ...obj, [key]: value })) as S extends
        Promise<unknown> ? Promise<SetResult<K, T, S>>
        : never;
    }
    return ({ ...obj, [key]: result }) as S extends Promise<unknown> ? never
      : SetResult<K, T, S>;
  });
}
