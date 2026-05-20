import type { Token } from "../../types.ts";

export interface RouteEntry {
  readonly index: number;
  readonly initialLiteralPrefix: string;
  readonly literalLength: number;
  readonly tokens: readonly Token[];
  readonly variableCount: number;
}

export const compareRouteEntries = (
  left: RouteEntry,
  right: RouteEntry,
): number =>
  right.literalLength - left.literalLength ||
  right.initialLiteralPrefix.length - left.initialLiteralPrefix.length ||
  left.variableCount - right.variableCount ||
  left.index - right.index;

export const mergeRouteEntries = <TEntry extends RouteEntry>(
  left: readonly TEntry[],
  right: readonly TEntry[],
): readonly TEntry[] => {
  if (left.length < 1) return right;
  if (right.length < 1) return left;

  const merged: TEntry[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (compareRouteEntries(left[leftIndex], right[rightIndex]) <= 0) {
      merged.push(left[leftIndex++]);
    } else {
      merged.push(right[rightIndex++]);
    }
  }

  while (leftIndex < left.length) merged.push(left[leftIndex++]);
  while (rightIndex < right.length) merged.push(right[rightIndex++]);

  return merged;
};
