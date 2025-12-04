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

export const eq = <T, S extends T>(value: S) => (other: T): boolean =>
  value === other;

export const getArticle = (word: string): string =>
  /^[aeiou]/i.test(word) ? "an" : "a";

export const endsWith = (suffix: string) => (str: string): boolean =>
  str.endsWith(suffix);
