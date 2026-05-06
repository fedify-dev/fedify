export interface PrioritizedRouteEntry {
  readonly index: number;
  readonly initialLiteralPrefix: string;
  readonly literalLength: number;
  readonly variableCount: number;
}

export const compareRouteEntries = (
  left: PrioritizedRouteEntry,
  right: PrioritizedRouteEntry,
): number =>
  right.literalLength - left.literalLength ||
  right.initialLiteralPrefix.length - left.initialLiteralPrefix.length ||
  left.variableCount - right.variableCount ||
  left.index - right.index;

export const mergeRouteEntries = <TEntry extends PrioritizedRouteEntry>(
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
