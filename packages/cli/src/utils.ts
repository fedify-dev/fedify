import { highlight } from "cli-highlight";
import { toMerged } from "jsr:@es-toolkit/es-toolkit";

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
