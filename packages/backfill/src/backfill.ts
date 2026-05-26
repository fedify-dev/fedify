import type * as vocab from "@fedify/vocab";

import type {
  BackfillContext,
  BackfillItem,
  BackfillOptions,
} from "./types.ts";

/**
 * Backfills post-like objects related to a seed object.
 *
 * The seed object is not yielded by default, but its ID is treated as already
 * seen so it will not be yielded again if the collection contains it.
 */
export async function* backfill<
  TObject extends vocab.Object = vocab.Object,
>(
  context: BackfillContext,
  note: TObject,
  options: BackfillOptions<TObject> = {},
): AsyncGenerator<BackfillItem<TObject>, void, void> {
  void context;
  void note;
  void options;

  yield* [] satisfies BackfillItem<TObject>[];
}
