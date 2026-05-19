import { compareRouteEntries, type RouteEntry } from "./priority.ts";

/**
 * Base trie node storing entries sorted by route priority.
 */
export default class Node<TEntry extends RouteEntry> {
  readonly #entries: TEntry[] = [];

  get entries(): readonly TEntry[] {
    return this.#entries;
  }

  insert = (entry: TEntry): void => {
    this.#entries.splice(this.#insertionIndex(entry), 0, entry);
  };

  remove = (entry: TEntry): void => {
    const index = this.#entries.indexOf(entry);
    if (index < 0) return;
    this.#entries.splice(index, 1);
  };

  #insertionIndex(entry: TEntry): number {
    let low = 0;
    let high = this.#entries.length;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (compareRouteEntries(this.#entries[middle], entry) <= 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  }
}
