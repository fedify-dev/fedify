/**
 * Returns the value of the key in the object.
 */
export function getProp<T extends PropertyKey>(
  key: T,
): <S extends { [K in T]: S[T] }>(obj: S) => S[T];
export function getProp<T extends PropertyKey>(
  key: T,
): <S extends { [K in T]: S[T] }>(obj: S) => S[T] {
  return <S extends { [K in T]: S[T] }>(obj: S) => obj[key];
}

/**
 * Returns the value of the key in the object if it exists,
 * otherwise returns second argument as default value.
 */
export function getPropOr<T extends PropertyKey, V>(
  key: T,
  defaultValue?: V,
): <S extends unknown>(obj: S) => T extends keyof S ? S[T] : V {
  return <S extends unknown>(obj: S) =>
    ((obj as Record<T, unknown>)[key] ?? defaultValue) as //
    (T extends keyof S ? S[T] : V);
}

export const eq = <T, S extends T>(value: S) => (other: T): boolean =>
  value === other;

export const getArticle = (word: string): string =>
  /^[aeiou]/i.test(word) ? "an" : "a";

export const endsWith = (suffix: string) => (str: string): boolean =>
  str.endsWith(suffix);

export const replace: {
  (searchValue: string | RegExp, replaceValue: string): (str: string) => string;
  (
    searchValue: string | RegExp,
    replacer: (substring: string, ...args: unknown[]) => string,
  ): (str: string) => string;
} = (
  searchValue: string | RegExp,
  replaceValue: string | ((substring: string, ...args: unknown[]) => string),
): (str: string) => string =>
(str: string): string =>
  str.replace(
    searchValue,
    // @ts-ignore tsc cannot infer the type here
    replaceValue,
  );

export function cases<T1, T2, R1, R2>(
  pred: <T extends T1 | T2>(value: T) => value is T1 & T,
  ifTrue: (value: T1) => R1,
  ifFalse: (value: T2) => R2,
): <T extends T1 | T2>(value: T) => R1 | R2;
export function cases<T1, T2, R>(
  pred: <T extends T1 | T2>(value: T) => value is T1 & T,
  ifTrue: (value: T1) => R,
  ifFalse: (value: T2) => R,
): (value: unknown) => R | R;
export function cases<T, R>(
  pred: (value: T) => boolean,
  ifTrue: (value: T) => R,
  ifFalse: (value: T) => R,
): (value: T) => R;
export function cases<T, R>(
  pred: (value: T) => boolean,
  ifTrue: (value: T) => R,
  ifFalse: (value: T) => R,
): (value: T) => R {
  return (value: T): R => pred(value) ? ifTrue(value) : ifFalse(value);
}
